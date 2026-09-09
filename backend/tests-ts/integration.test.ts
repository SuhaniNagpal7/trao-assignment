import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { randomUUID } from "node:crypto";
process.env.MONGODB_DATABASE = "ahead_test_" + randomUUID().replaceAll("-", "");
const { default: app } = await import("../src/app.js");
const { connect, client, collection, db } = await import("../src/db.js");
const { workOne } = await import("../src/worker.js");
const { settings } = await import("../src/config.js");
const { kit } = await import("./fixture.js");
before(async () => {
  await connect();
});
after(async () => {
  assert.match(db().databaseName, /^ahead_test_/);
  await db().dropDatabase();
  await client.close();
});
const origin = "http://localhost:3000";
let cookie = "",
  csrf = "",
  courseId = "",
  userId = "";
const send = (method: "get" | "post" | "put", path: string, body?: unknown) => {
  const req = request(app)
    [method](path)
    .set("Origin", origin)
    .set("Cookie", cookie)
    .set("X-CSRF-Token", csrf);
  return body === undefined ? req : req.send(body);
};
test("registration uses protected session and CSRF, login survives session recreation", async () => {
  const r = await request(app)
    .post("/api/auth/register")
    .set("Origin", origin)
    .send({
      name: "Test",
      email: "test@example.com",
      password: "test-password-123",
    });
  assert.equal(r.status, 201);
  cookie = r.headers["set-cookie"][0].split(";")[0];
  assert.match(r.headers["set-cookie"][0], /HttpOnly/);
  csrf = r.body.csrf_token;
  userId = r.body.user.id;
  assert.equal(
    (await send("get", "/api/auth/me")).body.user.email,
    "test@example.com",
  );
  assert.equal(
    (
      await request(app)
        .post("/api/auth/logout")
        .set("Origin", origin)
        .set("Cookie", cookie)
    ).status,
    403,
  );
  assert.equal(
    (
      await request(app)
        .post("/api/auth/login")
        .set("Origin", "https://evil.example")
        .send({})
    ).status,
    403,
  );
});
test("course deduplication, owner isolation, validation and stale revision", async () => {
  const input = {
    title: "Integration",
    jd: "JavaScript required.",
    company_url: "https://example.com/",
    days: 3,
    daily_minutes: 120,
  };
  const r = await send("post", "/api/courses", input);
  assert.equal(r.status, 201);
  courseId = r.body.course.id;
  const duplicate = await send("post", "/api/courses", input);
  assert.equal(duplicate.body.created, false);
  assert.equal(duplicate.body.course.id, courseId);
  assert.equal(
    (await request(app).get("/api/courses/" + courseId)).status,
    401,
  );
  assert.equal(
    (await send("put", "/api/courses/" + courseId, { ...input, revision: 99 }))
      .status,
    409,
  );
  const invalid = await send("post", "/api/courses/batch", {
    cases: [
      { id: "a", jd: "a", company_url: "https://example.com", days: 2 },
      { id: "b", jd: "", company_url: "https://example.com", days: 0 },
    ],
  });
  assert.equal(invalid.status, 422);
  assert.equal(await collection("courses").countDocuments(), 1);
});
test("atomic active-job deduplication across concurrent requests", async () => {
  const responses = await Promise.all([
    send("post", `/api/courses/${courseId}/generate`, { request_key: "one" }),
    send("post", `/api/courses/${courseId}/generate`, { request_key: "two" }),
  ]);
  assert.ok(responses.every((r) => r.status === 202));
  assert.equal(responses[0].body.job.id, responses[1].body.job.id);
  assert.equal(await collection("jobs").countDocuments(), 1);
});
test("worker checkpoints missing provider and retries without losing logs", async () => {
  const key = settings.geminiKey;
  settings.geminiKey = "";
  try {
    await workOne();
    const j = (await collection("jobs").findOne({ course_id: courseId }))!;
    assert.equal(j.status, "blocked");
    assert.equal(
      j.steps.filter((s: any) => s.status === "completed").length,
      2,
    );
    assert.equal(j.error_code, "CONFIGURATION_REQUIRED");
    const first = await send("get", "/api/jobs/" + j.id + "?limit=2");
    assert.equal(first.body.events.length, 2);
    assert.equal(first.body.has_more, true);
    const next = await send(
      "get",
      `/api/jobs/${j.id}?after_event_id=${first.body.next_cursor}`,
    );
    assert.ok(
      next.body.events.every((e: any) => e.id > first.body.next_cursor),
    );
    const retry = await send("post", "/api/jobs/" + j.id + "/retry", {});
    assert.equal(retry.status, 202);
    assert.equal(retry.body.job.completed_steps, 2);
    await workOne();
    assert.equal(
      (await collection("jobs").findOne({ _id: j.id }))!.retry_count,
      1,
    );
  } finally {
    settings.geminiKey = key;
  }
});
test("MongoDB edit transaction rejects concurrent stale writes", async () => {
  const base = kit();
  await collection("courses").updateOne(
    { _id: courseId },
    { $set: { kit: base, kit_revision: 1, status: "ready" } },
  );
  const a = structuredClone(base),
    b = structuredClone(base);
  a.company_brief.summary = "First";
  b.company_brief.summary = "Second";
  const result = await Promise.all([
    send("put", `/api/courses/${courseId}/kit`, {
      revision: 1,
      kit: a,
      pins: [],
    }),
    send("put", `/api/courses/${courseId}/kit`, {
      revision: 1,
      kit: b,
      pins: [],
    }),
  ]);
  assert.deepEqual(result.map((r) => r.status).sort(), [200, 409]);
});
test("practice history, sessions and confidence persist; stale commands fail", async () => {
  let p = (await send("get", `/api/courses/${courseId}/practice`)).body;
  const command = {
    revision: p.revision,
    request_key: "session",
    action: "session",
  };
  const r = await send("post", `/api/courses/${courseId}/practice`, command);
  assert.equal(r.status, 200);
  assert.equal(r.body.state.session.current, "fc1");
  assert.equal(
    (await send("post", `/api/courses/${courseId}/practice`, command)).body
      .revision,
    r.body.revision,
  );
  assert.equal(
    (
      await send("post", `/api/courses/${courseId}/practice`, {
        ...command,
        request_key: "stale",
      })
    ).status,
    409,
  );
  p = (
    await send("post", `/api/courses/${courseId}/practice`, {
      revision: r.body.revision,
      request_key: "review",
      action: "review",
      item_id: "fc1",
      confidence: 1,
    })
  ).body;
  assert.equal(p.summary.coverage, 100);
  assert.equal(p.history.length, 1);
});
test("expired worker lease is reclaimed without rerunning completed steps", async () => {
  const c = (await collection("courses").findOne({ _id: courseId }))!;
  const r = await send("post", `/api/courses/${courseId}/regenerate`, {
    revision: c.kit_revision,
    request_key: "schedule",
    section: "schedule",
  });
  assert.equal(r.status, 202);
  await collection("jobs").updateOne(
    { _id: r.body.job.id },
    {
      $set: {
        status: "running",
        lease_token: "dead-worker",
        lease_expires_at: new Date(0),
      },
    },
  );
  await workOne();
  const j = (await collection("jobs").findOne({ _id: r.body.job.id }))!;
  assert.equal(j.status, "completed");
  assert.equal(
    (await collection("courses").findOne({ _id: courseId }))!.kit.company_brief
      .summary,
    c.kit.company_brief.summary,
  );
});
test("durable lessons, feedback and interactive interview turns persist", async () => {
  const { lessonFixture } = await import("./fixture.js");
  const fake: any = {
    json: async (schema: any, instructions: string, data: any) =>
      schema.parse(
        instructions.startsWith("Teach")
          ? lessonFixture(data.requirement_id, data.requirement_id === "r1")
          : instructions.startsWith("Coach")
            ? {
                verdict: "developing",
                explanation:
                  "Explain the missing mechanism and show where your reasoning needs work.",
                correct_approach:
                  "Start with a small input, trace each step, then discuss the complexity.",
                revision_tasks: ["Practise the example again."],
              }
            : {
                question: instructions.includes("ended")
                  ? ""
                  : "How would you debug this failure?",
                feedback:
                  "Your answer is saved. Explain how you would narrow down the failure with a reproducible input.",
                revision_tasks: ["Use a concrete example."],
              },
      ),
  };
  async function run(data: any) {
    const current = (
      await send("get", "/api/courses/" + courseId + "/practice")
    ).body;
    const response = await send(
      "post",
      "/api/courses/" + courseId + "/practice/generate",
      { revision: current.revision, request_key: randomUUID(), ...data },
    );
    assert.equal(response.status, 202);
    await workOne(fake);
    const job = await collection("jobs").findOne({ _id: response.body.job.id });
    assert.equal(job!.status, "completed", job!.error_message);
    return (await send("get", "/api/courses/" + courseId + "/practice")).body;
  }
  let p = await run({ kind: "lessons" });
  assert.equal(p.learning.lessons.length, 2);
  assert.equal(p.missing_lesson_ids.length, 0);
  assert.ok(p.state.plan);
  p = await run({ kind: "feedback", item_id: "code:r1", text: "return {}" });
  assert.equal(p.state.feedback["code:r1"].feedback.verdict, "developing");
  assert.equal(p.state.feedback["code:r1"].answer, "return {}");
  assert.ok(p.history.some((e: any) => e.kind === "feedback"));
  p = await run({ kind: "interview", mode: "teaching", minutes: 15 });
  let interview = p.interviews[0];
  assert.equal(interview.messages.length, 1);
  p = await run({
    kind: "interview",
    interview_id: interview.id,
    interview_revision: interview.revision,
    text: "I would reproduce it first.",
  });
  interview = p.interviews[0];
  assert.equal(interview.messages.length, 3);
  assert.equal(interview.messages[1].role, "user");
  p = await run({
    kind: "interview",
    interview_id: interview.id,
    interview_revision: interview.revision,
    finish: true,
  });
  assert.equal(p.interviews[0].status, "completed");
});
test("one-click creation is deduplicated and resumes chapters without regenerating completed lessons", async () => {
  const input = { title: "Automatic chapters", company_url: "https://example.com", jd: "JavaScript and communication required for automatic chapter check.", days: 3, daily_minutes: 120 };
  const results = await Promise.all([send("post", "/api/courses/create-and-generate", input), send("post", "/api/courses/create-and-generate", input)]);
  assert.ok(results.every(r => r.status === 201), JSON.stringify(results.map(r => r.body)));
  assert.equal(results[0].body.course.id, results[1].body.course.id);
  assert.equal(results[0].body.job.id, results[1].body.job.id);
  const id = results[0].body.course.id;
  const jobId = results[0].body.job.id;
  const job = (await collection("jobs").findOne({ _id: jobId }))!;
  assert.equal(job.input_snapshot._include_lessons, true);
  const { definitions } = await import("../src/jobs.js");
  await definitions(job.input_snapshot)[0].run({ input: job.input_snapshot, outputs: {}, deadline: Date.now() + 1000, llm: {} as any });
  await collection("jobs").updateOne({ _id: jobId }, { $set: { checkpoint: { generate_content: { kit: kit() } }, steps: job.steps.map((s: any) => ({ ...s, status: "completed" })) } });
  const { lessonFixture } = await import("./fixture.js");
  const { AppError } = await import("../src/errors.js");
  const calls: Record<string, number> = {};
  let fail = true;
  const model: any = { json: async (schema: any, _instructions: string, data: any) => {
    calls[data.requirement_id] = (calls[data.requirement_id] || 0) + 1;
    if (fail && data.requirement_id === "r2") throw new AppError(422, "TEST_CHAPTER_FAILURE", "Test chapter failure");
    return schema.parse(lessonFixture(data.requirement_id, data.requirement_id === "r1"));
  }};
  await workOne(model);
  const failed = (await collection("jobs").findOne({ _id: jobId }))!;
  assert.equal(failed.status, "failed");
  assert.equal(failed.checkpoint.lesson_0.requirement_id, "r1");
  assert.equal((await send("post", "/api/jobs/" + jobId + "/retry", {})).status, 202);
  fail = false;
  await workOne(model);
  const saved = (await collection("courses").findOne({ _id: id }))!;
  assert.equal(saved.status, "ready");
  assert.equal(saved.learning.lessons.length, 2);
  assert.ok(saved.practice.plan.activities.length > 0);
  assert.deepEqual(calls, { r1: 1, r2: 2 });
  const p = (await send("get", "/api/courses/" + id + "/practice")).body;
  assert.equal(p.missing_lesson_ids.length, 0);
  assert.equal(p.learning_stale, false);
});

test("logout invalidates token and second account cannot see first account courses", async () => {
  assert.equal((await send("post", "/api/auth/logout", {})).status, 204);
  assert.equal((await send("get", "/api/auth/me")).status, 401);
  const r = await request(app)
    .post("/api/auth/register")
    .set("Origin", origin)
    .send({
      name: "Other",
      email: "other@example.com",
      password: "another-password-123",
    });
  cookie = r.headers["set-cookie"][0].split(";")[0];
  csrf = r.body.csrf_token;
  assert.equal((await send("get", "/api/courses/" + courseId)).status, 404);
  assert.equal((await send("get", "/api/courses")).body.courses.length, 0);
});
