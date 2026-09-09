import { randomUUID } from "node:crypto";
import type { ClientSession } from "mongodb";
import { collection, transaction } from "./db.js";
import { settings } from "./config.js";
import {
  steps,
  categories,
  generateBrief,
  generateQuestions,
  allocateSchedule,
  type Context,
  type Step,
} from "./pipeline.js";
import { AppError } from "./errors.js";
import { practiceSteps, preparePractice } from "./practice.js";
export const pipelineVersion = "typescript-1";
export const active = ["queued", "running", "retry_wait"];
export function event(
  job: any,
  message: string,
  step: string | null = null,
  level = "info",
) {
  job.events ||= [];
  job.events.push({
    id: (job.events.at(-1)?.id || 0) + 1,
    message,
    step_key: step,
    level,
    created_at: new Date().toISOString(),
  });
}
export function definitions(snapshot: any): Step[] {
  if (snapshot._practice) return practiceSteps(snapshot);
  if (snapshot._section)
    return [
      {
        key: "regenerate_section",
        label: "Generate replacement section",
        run: async (c: Context) => {
          const section = snapshot._section;
          if (section === "schedule")
            return {
              schedule: allocateSchedule(
                c.input,
                snapshot._base_kit.role.requirements,
                snapshot._base_kit.questions,
              ),
            };
          if (section === "company_brief")
            return { company_brief: await generateBrief(c) };
          return generateQuestions(c, section.slice(10));
        },
      },
      {
        key: "merge_section",
        label: "Merge with your latest edits",
        run: (c) => c.outputs.regenerate_section,
      },
    ];
  return steps;
}
export async function ownedCourse(
  id: string,
  userId: string,
  session?: ClientSession,
) {
  const c = await collection("courses").findOne(
    { _id: id, user_id: userId },
    { session },
  );
  if (!c) throw new AppError(404, "COURSE_NOT_FOUND", "Course not found.");
  return c;
}
export async function enqueue(
  courseId: string,
  userId: string,
  data: any = {},
  kind = "generate",
) {
  return transaction(async (session) => {
    const c = await ownedCourse(courseId, userId, session);
    const requestKey = data.request_key || randomUUID();
    const existing = await collection("jobs").findOne(
      { course_id: courseId, request_key: requestKey },
      { session },
    );
    if (existing) {
      if (
        (kind === "regenerate" &&
          existing.input_snapshot._section !== data.section) ||
        (kind === "practice" &&
          JSON.stringify(existing.input_snapshot._practice) !==
            JSON.stringify(data))
      )
        throw new AppError(
          409,
          "REQUEST_KEY_REUSED",
          "Use a new request key for a different action.",
        );
      return { job: existing, created: false };
    }
    const running = await collection("jobs").findOne(
      { active_key: courseId },
      { session },
    );
    if (running) {
      if (kind === "generate") return { job: running, created: false };
      throw new AppError(
        409,
        "JOB_ACTIVE",
        "A generation is already running for this course.",
      );
    }
    const last = await collection("jobs")
      .find({ course_id: courseId }, { session })
      .sort({ created_at: -1 })
      .limit(1)
      .next();
    if (
      kind === "generate" &&
      !data.force &&
      last &&
      last.course_revision === c.revision &&
      !last.input_snapshot._section &&
      !last.input_snapshot._practice &&
      last.pipeline_version === pipelineVersion
    )
      return { job: last, created: false };
    const snapshot: any = Object.fromEntries(
      [
        "title",
        "company_name",
        "company_url",
        "jd",
        "days",
        "daily_minutes",
        "availability_scope",
      ].map((k) => [k, c[k]]),
    );
    let checkpoint: any = {};
    if (kind === "regenerate") {
      if (
        ![
          "company_brief",
          "schedule",
          ...categories.map((k) => "questions_" + k),
        ].includes(data.section)
      )
        throw new AppError(
          422,
          "INVALID_SECTION",
          "Choose a company brief, schedule or question category.",
        );
      if (!c.kit || c.kit_revision !== data.revision)
        throw new AppError(
          409,
          "KIT_CONFLICT",
          "Save or reload the latest kit before regenerating.",
        );
      snapshot._section = data.section;
      snapshot._base_kit = structuredClone(c.kit);
      checkpoint = {
        ...Object.fromEntries(
          Object.entries(last?.checkpoint || {}).filter(([k]) =>
            ["research_company", "search_interviews"].includes(k),
          ),
        ),
        extract_job: {
          ...c.kit.role,
          warnings: [
            "Regeneration uses your saved role and requirements, including edits.",
          ],
          title: { text: c.kit.role.title },
          seniority: { text: c.kit.role.seniority },
          responsibilities: c.kit.role.responsibilities.map((text: string) => ({
            text,
          })),
        },
      };
    }
    if (kind === "practice") Object.assign(snapshot, preparePractice(c, data));
    const now = new Date(),
      id = randomUUID();
    const job: any = {
      _id: id,
      id,
      course_id: courseId,
      user_id: userId,
      course_revision: c.revision,
      request_key: requestKey,
      active_key: courseId,
      status: "queued",
      input_snapshot: snapshot,
      checkpoint,
      pipeline_version: pipelineVersion,
      retry_count: 0,
      created_at: now.toISOString(),
      available_at: now,
      deadline_at: new Date(now.getTime() + settings.jobTimeout * 1000),
      lease_expires_at: new Date(0),
      steps: definitions(snapshot).map((s, i) => ({
        key: s.key,
        label: s.label,
        position: i,
        status: "pending",
        attempts: 0,
        started_at: null,
        finished_at: null,
      })),
      events: [],
      error_code: null,
      error_message: null,
      finished_at: null,
    };
    event(job, "Generation queued. Waiting for a worker.");
    await collection("jobs").insertOne(job, { session });
    await collection("courses").updateOne(
      { _id: courseId },
      {
        $set: {
          status: kind === "practice" ? c.status : "generating",
          updated_at: now.toISOString(),
        },
        $inc: { _write_revision: 1 },
      },
      { session },
    );
    return { job, created: true };
  });
}
export function jobView(j: any) {
  return {
    id: j.id,
    course_id: j.course_id,
    course_revision: j.course_revision,
    status: j.status,
    current_step:
      j.steps.find((s: any) => s.status !== "completed")?.key ||
      j.steps.at(-1)?.key,
    completed_steps: j.steps.filter((s: any) => s.status === "completed")
      .length,
    total_steps: j.steps.length,
    created_at: j.created_at,
    available_at: j.available_at,
    deadline_at: j.deadline_at,
    finished_at: j.finished_at,
    error: j.error_code
      ? { code: j.error_code, message: j.error_message }
      : null,
    can_retry:
      j.pipeline_version === pipelineVersion &&
      ["failed", "blocked"].includes(j.status) &&
      j.retry_count < 3,
    research: Object.fromEntries(
      Object.entries(j.checkpoint).filter(([k]) =>
        ["extract_job", "research_company", "search_interviews"].includes(k),
      ),
    ),
    steps: j.steps.map(
      ({ key, label, status, attempts, started_at, finished_at }: any) => ({
        key,
        label,
        status,
        attempts,
        started_at,
        finished_at,
      }),
    ),
  };
}
export async function retryJob(id: string, userId: string) {
  return transaction(async (session) => {
    const j = await collection("jobs").findOne(
      { _id: id, user_id: userId },
      { session },
    );
    if (!j)
      throw new AppError(404, "JOB_NOT_FOUND", "Generation run not found.");
    const c = await ownedCourse(j.course_id, userId, session);
    if (active.includes(j.status) || j.status === "completed") return j;
    const last = await collection("jobs")
      .find({ course_id: c.id }, { session })
      .sort({ created_at: -1 })
      .limit(1)
      .next();
    if (
      last?.id !== id ||
      j.course_revision !== c.revision ||
      j.pipeline_version !== pipelineVersion ||
      j.retry_count >= 3
    )
      throw new AppError(
        409,
        "NEW_RUN_REQUIRED",
        "This run cannot be resumed. Start a new generation.",
      );
    if (await collection("jobs").findOne({ active_key: c.id }, { session }))
      throw new AppError(409, "JOB_ACTIVE", "Another run is already active.");
    Object.assign(j, {
      status: "queued",
      active_key: c.id,
      available_at: new Date(),
      deadline_at: new Date(Date.now() + settings.jobTimeout * 1000),
      error_code: null,
      error_message: null,
      finished_at: null,
      lease_token: null,
      retry_count: j.retry_count + 1,
    });
    for (const step of j.steps)
      if (step.status !== "completed")
        Object.assign(step, {
          status: "pending",
          attempts: 0,
          started_at: null,
          finished_at: null,
        });
    event(j, "Run resumed. Completed steps will be reused.");
    await collection("jobs").replaceOne({ _id: id }, j, { session });
    await collection("courses").updateOne(
      { _id: c.id },
      {
        $set: { status: j.input_snapshot._practice ? c.status : "generating" },
        $inc: { _write_revision: 1 },
      },
      { session },
    );
    return j;
  });
}
