import { test } from "node:test";
import assert from "node:assert/strict";
import { validateKit } from "../src/schemas.js";
import { allocateSchedule, coverage } from "../src/pipeline.js";
import { saveEdit, mergeGenerated } from "../src/editing.js";
import { allocate, cardOrder, summary } from "../src/study-plan.js";
import { practiceCommand, commandSchema } from "../src/practice.js";
import { publicAddress } from "../src/research.js";
import { settings, originAllowed } from "../src/config.js";
import { kit, course, lessonFixture } from "./fixture.js";
test("origin allowlist matches exact entries and single-segment wildcards", () => {
  const saved = settings.origins;
  settings.origins = [
    "https://app.example.com",
    "https://*-team.vercel.app",
  ];
  try {
    assert.equal(originAllowed("https://app.example.com"), true);
    assert.equal(originAllowed("https://frontend-team.vercel.app"), true);
    assert.equal(originAllowed("https://frontend-abc123-team.vercel.app"), true);
    assert.equal(originAllowed("https://evil.com"), false);
    assert.equal(originAllowed("https://team.vercel.app.evil.com"), false);
    assert.equal(originAllowed(undefined), false);
    assert.equal(originAllowed(""), false);
  } finally {
    settings.origins = saved;
  }
});
test("valid Appendix A contract, stable references and coverage", () =>
  assert.equal(validateKit(kit()).questions.length, 2));
for (const kind of [
  "duplicate",
  "unknown",
  "coverage",
  "days",
  "float",
  "missing-must",
])
  test("reject invalid " + kind, () => {
    const k = kit();
    if (kind === "duplicate") k.questions.push(k.questions[0]);
    if (kind === "unknown") k.questions[0].requirement_ids = ["absent"];
    if (kind === "coverage") k.coverage.uncovered_requirement_ids = ["r1"];
    if (kind === "days") k.schedule.days.pop();
    if (kind === "float") k.schedule.days[0].minutes = 1.5;
    if (kind === "missing-must") {
      k.questions.shift();
      k.schedule.days.forEach((d) => (d.question_ids = ["q2"]));
      k.coverage.uncovered_requirement_ids = ["r1"];
    }
    assert.throws(() => validateKit(k));
  });
for (const days of [1, 14, 60])
  test("deterministic schedule has exactly " + days + " days", () => {
    const k = kit(),
      s = allocateSchedule(
        { days, daily_minutes: 120 },
        k.role.requirements,
        k.questions,
      );
    assert.equal(s.days.length, days);
    assert.equal(s.days[0].question_ids[0], "q1");
    assert.ok(
      s.days.every((d) => Number.isInteger(d.minutes) && d.minutes <= 120),
    );
    k.schedule = s;
    validateKit(k);
  });
test("schedule refuses to drop required work when capacity is insufficient", () =>
  assert.throws(
    () =>
      allocateSchedule(
        { days: 1, daily_minutes: 15 },
        kit().role.requirements,
        kit().questions,
      ),
    /does not fit/,
  ));
test("coverage reports only missing requirement IDs", () =>
  assert.deepEqual(coverage(kit().role.requirements, [kit().questions[0]]), [
    "r2",
  ]));
test("edited and pinned content survives replacement generation", () => {
  const c = course(),
    k = kit();
  k.questions[0].answer_outline = "My detailed explanation";
  Object.assign(
    c,
    saveEdit(c, { revision: 1, kit: k, pins: ["questions:q1"] }),
  );
  const next = kit();
  next.questions[0].answer_outline = "Replacement";
  assert.equal(
    mergeGenerated(c, { questions: next.questions }, "questions_technical").kit
      .questions[0].answer_outline,
    "My detailed explanation",
  );
});
test("deletion reconciles schedule and cannot be resurrected by matching content", () => {
  const c = course(),
    k = kit();
  k.questions.shift();
  Object.assign(c, saveEdit(c, { revision: 1, kit: k, pins: [] }));
  assert.deepEqual(c.kit.schedule.days[0].question_ids, ["q2"]);
  const incoming = kit().questions.map((q) => ({ ...q, id: "new-" + q.id }));
  assert.equal(
    mergeGenerated(
      c,
      { questions: incoming },
      "questions_technical",
    ).kit.questions.some((q) => q.prompt === kit().questions[0].prompt),
    false,
  );
});
test("stale editor revisions are rejected", () =>
  assert.throws(
    () => saveEdit(course(), { revision: 99, kit: kit(), pins: [] }),
    /another tab/,
  ));
test("regeneration cannot merge against changed role requirements", () => {
  const c = course();
  c.kit.role.title = "Changed";
  assert.throws(
    () =>
      mergeGenerated(
        c,
        { questions: kit().questions },
        "questions_technical",
        kit(),
      ),
    /Role requirements changed/,
  );
});
test("flashcard review is persisted, idempotent and invalidated when content changes", () => {
  let c: any = course();
  const command = commandSchema.parse({
    revision: 1,
    request_key: "review",
    action: "review",
    item_id: "fc1",
    confidence: 1,
  });
  c = practiceCommand(c, command, []);
  assert.equal(summary(c).coverage, 100);
  assert.equal(practiceCommand(c, command, []).practice_revision, 2);
  c.kit.flashcards[0].back = "New answer";
  assert.equal(summary(c).coverage, 0);
  assert.equal(cardOrder(c)[0].id, "fc1");
});
test("shared allocation honours peer load and exposes a backlog", () => {
  const c: any = course();
  c.learning = { lessons: [lessonFixture("r1", true)] };
  c.practice = {
    settings: { days: 1, daily_minutes: 15, end_date: "2026-09-09" },
  };
  const peer = {
    ...course(),
    id: "peer",
    practice: { plan: { activities: [{ date: "2026-09-09", minutes: 15 }] } },
  };
  const p = allocate(c, [peer], "2026-09-09");
  assert.equal(p.activities.length, 0);
  assert.ok(p.shortfall_minutes > 0);
});
for (const address of [
  "127.0.0.1",
  "10.0.0.1",
  "169.254.169.254",
  "::1",
  "::ffff:127.0.0.1",
  "192.168.1.1",
  "0.0.0.0",
])
  test("SSRF rejects " + address, () =>
    assert.equal(publicAddress(address), false),
  );
test("public addresses are accepted", () =>
  assert.equal(publicAddress("8.8.8.8"), true));
