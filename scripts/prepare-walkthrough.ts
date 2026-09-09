import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { connect, client, collection, transaction } from "../backend/src/db.js";
import { OpenAI } from "../backend/src/provider.js";
import { steps, type Context } from "../backend/src/pipeline.js";
import { metadata } from "../backend/src/editing.js";
import { validateKit } from "../backend/src/schemas.js";
import { event } from "../backend/src/jobs.js";
const id = process.argv[2];
const batch = JSON.parse(
  await readFile("output/stack-migration-benchmark/kits.json", "utf8"),
);
const kit = validateKit(
  batch.kits.find(
    (r: any) => r.id === "frontend-fourteen-days" && r.status === "ok",
  )?.kit,
);
await connect();
try {
  const c = await collection("courses").findOne({ _id: id }),
    u = c && (await collection("users").findOne({ _id: c.user_id }));
  if (!c || !u?.email.startsWith("walkthrough-"))
    throw new Error("Use a new walkthrough-owned course.");
  const rid = kit.role.requirements.find((r) => r.priority === "must")!.id;
  const initial = kit.questions.filter((q) => !q.requirement_ids.includes(rid));
  const ctx: Context = {
    input: c as any,
    deadline: Date.now() + 180000,
    llm: new OpenAI(),
    outputs: {
      extract_job: {
        ...kit.role,
        title: { text: kit.role.title },
        seniority: { text: kit.role.seniority },
        responsibilities: kit.role.responsibilities.map((text) => ({ text })),
        warnings: [
          "Controlled demonstration: one required topic was deliberately withheld before the real coverage repair.",
        ],
      },
      company_brief: kit.company_brief,
      coverage_initial: { questions: initial, passes: 1 },
    },
  };
  for (const key of ["repair_1", "repair_2", "check_coverage"])
    ctx.outputs[key] = await steps.find((s) => s.key === key)!.run(ctx);
  kit.questions = ctx.outputs.repair_2.questions;
  kit.coverage = ctx.outputs.check_coverage;
  kit.schedule = await steps.find((s) => s.key === "schedule")!.run(ctx);
  validateKit(kit);
  await transaction(async (session) => {
    const jobId = randomUUID();
    const job: any = {
      _id: jobId,
      id: jobId,
      user_id: c.user_id,
      course_id: id,
      course_revision: c.revision,
      request_key: jobId,
      pipeline_version: "typescript-1",
      status: "completed",
      active_key: null,
      retry_count: 0,
      input_snapshot: {},
      checkpoint: { ...ctx.outputs },
      steps: ["coverage_initial", "repair_1", "check_coverage"].map((key) => ({
        key,
        label: key,
        status: "completed",
        attempts: 1,
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
      })),
      created_at: new Date().toISOString(),
      available_at: new Date(),
      deadline_at: new Date(),
      finished_at: new Date().toISOString(),
      events: [],
    };
    event(
      job,
      "Controlled coverage demonstration: one topic was deliberately withheld, then repaired by OpenAI.",
    );
    await collection("jobs").insertOne(job, { session });
    await collection("courses").updateOne(
      { _id: id },
      {
        $set: {
          kit,
          kit_meta: metadata(kit),
          kit_revision: 1,
          status: "ready",
        },
      },
      { session },
    );
  });
} finally {
  await client.close();
}
