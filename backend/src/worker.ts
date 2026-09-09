import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { collection, connect, client, transaction } from "./db.js";
import { settings } from "./config.js";
import { OpenAI, type Llm } from "./provider.js";
import { AppError, deadlineCheck, sleep } from "./errors.js";
import { definitions, event, pipelineVersion } from "./jobs.js";
import { mergeGenerated } from "./editing.js";
import { finishPractice } from "./practice.js";
async function reserve(tokens: number, deadline: number) {
  if (tokens > settings.tpm)
    throw new AppError(
      422,
      "TOKEN_BUDGET_EXCEEDED",
      "Request exceeds the configured OpenAI token limit.",
    );
  for (;;) {
    deadlineCheck(deadline);
    const bucket = Math.floor(Date.now() / 60000);
    const key = "openai:" + settings.model + ":" + bucket;
    try {
      await collection("rate_limits").updateOne(
        { _id: key },
        {
          $setOnInsert: {
            requests: 0,
            tokens: 0,
            expires_at: new Date((bucket + 2) * 60000),
          },
        },
        { upsert: true },
      );
    } catch (e: any) {
      if (e.code !== 11000) throw e;
    }
    const result = await collection("rate_limits").findOneAndUpdate(
      {
        _id: key,
        requests: { $lt: settings.rpm },
        tokens: { $lte: settings.tpm - tokens },
      },
      { $inc: { requests: 1, tokens } },
      { returnDocument: "after" },
    );
    if (result) return;
    const wait = (bucket + 1) * 60000 - Date.now();
    if (Date.now() + wait >= deadline)
      throw new AppError(
        429,
        "RATE_LIMITED",
        "OpenAI quota is busy. Retry after the current quota window.",
        wait,
      );
    await sleep(Math.min(wait, 1000));
  }
}
export async function workOne(llm: Llm = new OpenAI(reserve)) {
  const token = randomUUID(),
    now = new Date();
  let job = await collection("jobs").findOneAndUpdate(
    {
      $or: [
        {
          status: { $in: ["queued", "retry_wait"] },
          available_at: { $lte: now },
        },
        { status: "running", lease_expires_at: { $lte: now } },
      ],
    },
    {
      $set: {
        status: "running",
        lease_token: token,
        lease_expires_at: new Date(Date.now() + 30000),
      },
    },
    { sort: { created_at: 1 }, returnDocument: "after" },
  );
  if (!job) return false;
  let lost = false;
  const heartbeat = setInterval(() => {
    void collection("jobs")
      .updateOne(
        { _id: job!._id, lease_token: token, status: "running" },
        { $set: { lease_expires_at: new Date(Date.now() + 30000) } },
      )
      .then((r) => {
        if (!r.matchedCount) lost = true;
      })
      .catch(() => {
        lost = true;
      });
  }, 8000);
  const persist = async () => {
    if (lost)
      throw new AppError(
        409,
        "LEASE_LOST",
        "Another worker has resumed this job.",
      );
    const r = await collection("jobs").updateOne(
      { _id: job!._id, lease_token: token, status: "running" },
      {
        $set: {
          checkpoint: job!.checkpoint,
          steps: job!.steps,
          events: job!.events,
        },
      },
    );
    if (!r.matchedCount) {
      lost = true;
      throw new AppError(
        409,
        "LEASE_LOST",
        "Another worker has resumed this job.",
      );
    }
  };
  try {
    if (job.pipeline_version !== pipelineVersion)
      throw new AppError(
        409,
        "PIPELINE_VERSION_CHANGED",
        "Start a new run for the current backend.",
      );
    for (const def of definitions(job.input_snapshot)) {
      const step = job.steps.find((s: any) => s.key === def.key);
      if (step.status === "completed") continue;
      deadlineCheck(new Date(job.deadline_at).getTime());
      if (lost) throw new AppError(409, "LEASE_LOST", "Worker lease expired.");
      Object.assign(step, {
        status: "running",
        attempts: step.attempts + 1,
        started_at: new Date().toISOString(),
      });
      event(job, def.label + ".", def.key);
      await persist();
      const output = await def.run({
        input: job.input_snapshot,
        outputs: job.checkpoint,
        deadline: new Date(job.deadline_at).getTime(),
        llm,
      });
      job.checkpoint[def.key] = output;
      Object.assign(step, {
        status: "completed",
        finished_at: new Date().toISOString(),
      });
      event(job, def.label + " completed.", def.key);
      await persist();
    }
    await transaction(async (session) => {
      const current = await collection("jobs").findOne(
        { _id: job!._id, lease_token: token, status: "running" },
        { session },
      );
      if (!current || lost)
        throw new AppError(409, "LEASE_LOST", "Worker lease expired.");
      const c = await collection("courses").findOne(
        { _id: job!.course_id },
        { session },
      );
      if (!c || c.revision !== job!.course_revision)
        throw new AppError(
          409,
          "INPUTS_CHANGED",
          "Course inputs changed during generation.",
        );
      let changes: any;
      if (job!.input_snapshot._practice) {
        await collection("users").updateOne(
          { _id: c.user_id },
          { $inc: { planning_revision: 1 } },
          { session },
        );
        const peers = await collection("courses")
          .find({ user_id: c.user_id }, { session })
          .toArray();
        changes = finishPractice(
          c,
          job!.input_snapshot,
          job!.checkpoint,
          peers,
        );
      } else {
        const section = job!.input_snapshot._section;
        changes = mergeGenerated(
          c,
          section
            ? job!.checkpoint.merge_section
            : job!.checkpoint.generate_content.kit,
          section || "all",
          job!.input_snapshot._base_kit,
        );
        changes.status = "ready";
      }
      delete changes._id;
      delete changes._write_revision;
      await collection("courses").updateOne(
        { _id: c.id },
        {
          $set: { ...changes, updated_at: new Date().toISOString() },
          $inc: { _write_revision: 1 },
        },
        { session },
      );
      event(job!, "Generation completed. Your work is saved.");
      await collection("jobs").updateOne(
        { _id: job!._id, lease_token: token },
        {
          $set: {
            status: "completed",
            active_key: null,
            finished_at: new Date().toISOString(),
            events: job!.events,
          },
        },
        { session },
      );
    });
  } catch (error) {
    if (!lost) {
      const e =
        error instanceof AppError
          ? error
          : new AppError(
              500,
              "GENERATION_FAILED",
              "Generation could not finish. Completed steps are saved.",
            );
      if (e.code !== "LEASE_LOST")
        await transaction(async (session) => {
          const current = await collection("jobs").findOne(
            { _id: job!._id, lease_token: token, status: "running" },
            { session },
          );
          if (!current) return;
          const auto =
            (e.status === 429 || e.status === 502 || e.code === "PROVIDER_UNAVAILABLE") &&
            (job!.automatic_retries || 0) < 2 &&
            Date.now() + Math.max(e.retryAfter, 15000) <
              new Date(job!.deadline_at).getTime();
          const status = auto
            ? "retry_wait"
            : e.code === "CONFIGURATION_REQUIRED"
              ? "blocked"
              : "failed";
          const step = job!.steps.find((s: any) => s.status === "running");
          if (step) step.status = auto ? "pending" : "failed";
          event(job!, e.message, step?.key || null, auto ? "warning" : "error");
          await collection("jobs").updateOne(
            { _id: job!._id, lease_token: token },
            {
              $set: {
                status,
                active_key: auto ? job!.course_id : null,
                available_at: new Date(
                  Date.now() + Math.max(e.retryAfter, 15000),
                ),
                automatic_retries: (job!.automatic_retries || 0) + 1,
                error_code: e.code,
                error_message: e.message,
                steps: job!.steps,
                events: job!.events,
                finished_at: auto ? null : new Date().toISOString(),
              },
            },
            { session },
          );
          if (!job!.input_snapshot._practice)
            await collection("courses").updateOne(
              { _id: job!.course_id },
              { $set: { status: auto ? "generating" : status } },
              { session },
            );
        });
    }
  } finally {
    clearInterval(heartbeat);
  }
  return true;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await connect();
  let stop = false;
  process.on("SIGINT", () => {
    stop = true;
  });
  process.on("SIGTERM", () => {
    stop = true;
  });
  console.log("MongoDB worker started.");
  while (!stop) {
    try {
      if (!(await workOne())) await sleep(1000);
    } catch {
      console.error("Worker database operation failed; retrying.");
      await sleep(1000);
    }
  }
  await client.close();
}
