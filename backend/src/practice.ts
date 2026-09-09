import { randomUUID } from "node:crypto";
import { z } from "zod";
import { type Context, type Step } from "./pipeline.js";
import { AppError } from "./errors.js";
import { equal } from "./editing.js";
import {
  allocate,
  cardOrder,
  reviewed,
  summary,
  weakSpots,
  tasks,
  today,
  addDays,
  projection,
} from "./study-plan.js";
import { resourceSteps } from "./resources.js";
export const commandSchema = z
  .object({
    revision: z.number().int().min(1),
    request_key: z.string().min(1).max(128),
    action: z.enum([
      "session",
      "review",
      "draft",
      "complete",
      "replan",
      "move",
    ]),
    item_id: z.string().max(100).default(""),
    confidence: z.number().int().min(1).max(3).default(1),
    text: z.string().max(12000).default(""),
    days: z.number().int().min(1).max(60).default(14),
    daily_minutes: z.number().int().min(15).max(480).default(120),
    day: z.string().max(10).default(""),
  })
  .strict();
export const generateSchema = z
  .object({
    revision: z.number().int().min(1),
    request_key: z.string().min(1).max(128),
    kind: z.enum(["lessons", "feedback", "interview", "resources"]),
    item_id: z.string().max(100).default(""),
    text: z.string().max(12000).default(""),
    mode: z.enum(["teaching", "simulation"]).default("teaching"),
    minutes: z.number().int().min(5).max(60).default(15),
    interview_id: z.string().max(36).default(""),
    interview_revision: z.number().int().min(1).default(1),
    finish: z.boolean().default(false),
  })
  .strict();
const fail = (
  message = "Practice changed in another tab. Reload the saved practice before trying again.",
) => {
  throw new AppError(409, "PRACTICE_CONFLICT", message);
};
export function needKit(c: any) {
  if (!c.kit) fail("Generate a course before starting practice.");
}
export function practiceView(c: any) {
  needKit(c);
  const state = structuredClone(c.practice || {}),
    cards = cardOrder(c),
    ids = new Set(cards.map((f) => f.id));
  state.session ||= {};
  state.session.queue = (state.session.queue || []).filter((id: string) =>
    ids.has(id),
  );
  if (!ids.has(state.session.current))
    state.session.current = state.session.queue[0] || null;
  const req = c.kit.role.requirements,
    lessons = c.learning?.lessons || [],
    reviews = reviewed(c);
  return {
    revision: c.practice_revision,
    state,
    learning: c.learning || {},
    summary: summary(c),
    learning_stale: !!lessons.length && !equal(c.learning?.role, c.kit.role),
    missing_lesson_ids: req
      .filter((r: any) => !lessons.some((l: any) => l.requirement_id === r.id))
      .map((r: any) => r.id),
    ordered_card_ids: cards.map((f) => f.id),
    weak_spots: weakSpots(c),
    weak_topics: req.filter((r: any) =>
      cards.some(
        (f) =>
          f.requirement_ids.includes(r.id) &&
          (reviews[f.id]?.confidence || 0) < 3,
      ),
    ),
    interviews: [...(c.interviews || [])].reverse().slice(0, 30),
    history: [...(c.practice_history || [])]
      .reverse()
      .filter((e: any) => ["review", "feedback"].includes(e.kind))
      .slice(0, 50),
    schedule: state.plan ? projection(c, state.plan) : null,
  };
}
export function practiceCommand(
  c: any,
  data: z.infer<typeof commandSchema>,
  peers: any[],
) {
  needKit(c);
  const existing = c.practice_history?.find(
    (e: any) => e.request_key === data.request_key,
  );
  if (existing) {
    if (!equal(existing.payload.command, data))
      fail("This request key was used for a different action.");
    return c;
  }
  if (c.practice_revision !== data.revision) fail();
  const state = structuredClone(c.practice || {}),
    available = tasks(c);
  const now = new Date().toISOString();
  switch (data.action) {
    case "session": {
      if (data.item_id && !c.kit.role.requirements.some((r: any) => r.id === data.item_id)) fail("This topic was removed. Reload your practice.");
      const queue = cardOrder(c).filter(f => !data.item_id || f.requirement_ids.includes(data.item_id)).map((f) => f.id);
      state.session = { queue, current: queue[0] || null, started_at: now };
      break;
    }
    case "review": {
      const card = c.kit.flashcards.find((f: any) => f.id === data.item_id);
      if (!card) fail("This flashcard was removed.");
      state.reviews ||= {};
      state.reviews[card.id] = {
        confidence: data.confidence,
        reviewed_at: now,
        content: [card.front, card.back],
      };
      const queue = (state.session?.queue || []).filter(
        (id: string) =>
          id !== card.id && c.kit.flashcards.some((f: any) => f.id === id),
      );
      state.session = {
        ...(state.session || {}),
        queue,
        current: queue[0] || null,
      };
      if (state.plan) state.plan = allocate({ ...c, practice: state }, peers);
      break;
    }
    case "draft":
      if (
        !available.some(
          (t) =>
            t.id === data.item_id && ["coding", "assignment"].includes(t.kind),
        )
      )
        fail("This exercise is no longer available.");
      state.drafts ||= {};
      state.drafts[data.item_id] = data.text;
      break;
    case "complete":
      if (
        !available.some((t) => t.id === data.item_id) &&
        !(
          data.item_id.startsWith("repeat:") &&
          c.kit.flashcards.some((f: any) => data.item_id === "repeat:" + f.id)
        )
      )
        fail("This activity is no longer available.");
      state.completed ||= {};
      state.completed[data.item_id] = now;
      break;
    case "replan":
      state.settings = {
        days: data.days,
        daily_minutes: data.daily_minutes,
        end_date: addDays(today(), data.days - 1),
      };
      state.plan = allocate({ ...c, practice: state }, peers);
      break;
    case "move": {
      const p = state.plan;
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(data.day) ||
        !p ||
        data.day < p.start_date ||
        data.day > addDays(p.start_date, p.days - 1)
      )
        fail("Choose a date within the plan.");
      const task = p.activities.find((a: any) => a.id === data.item_id);
      if (!task || state.completed?.[data.item_id])
        fail("Completed activities cannot be moved.");
      task.date = data.day;
      task.pinned = true;
      state.plan = allocate({ ...c, practice: state }, peers);
      break;
    }
  }
  return {
    ...c,
    practice: state,
    practice_revision: c.practice_revision + 1,
    practice_history: [
      ...(c.practice_history || []),
      {
        id: randomUUID(),
        request_key: data.request_key,
        kind: data.action,
        payload: { command: data },
        created_at: now,
      },
    ],
  };
}
const coding = z
  .object({
    title: z.string().min(5),
    language: z.string().min(1),
    problem: z.string().min(30),
    starter_code: z.string(),
    hints: z.array(z.string()).min(1).max(4),
    solution: z.string().min(20),
    explanation: z.string().min(40),
    complexity: z.string().min(5),
  })
  .strict();
export const lesson = z
  .object({
    requirement_id: z.string(),
    title: z.string().min(5),
    concepts: z.string().min(500).max(3500),
    example: z.string().min(150).max(1800),
    mistakes: z.array(z.string()).min(1).max(5),
    readiness: z.array(z.string()).min(2).max(5),
    minutes: z.number().int().min(5).max(20),
    coding: coding.nullable(),
  })
  .strict();
const feedback = z
  .object({
    verdict: z.enum(["strong", "developing", "needs_work"]),
    explanation: z.string().min(30).max(2400),
    correct_approach: z.string().min(30).max(3000),
    revision_tasks: z.array(z.string()).min(1).max(5),
  })
  .strict();
const turn = z
  .object({
    question: z.string().max(1000),
    feedback: z.string().max(2400),
    revision_tasks: z.array(z.string()).max(5),
  })
  .strict();
export function practiceSteps(snapshot: any): Step[] {
  const data = snapshot._practice,
    kit = snapshot._base_kit;
  if (data.kind === "lessons")
    return [
      ...kit.role.requirements.map((r: any, i: number) => ({
        key: "lesson_" + i,
        label: "Write reading lesson " + (i + 1),
        run: async (c: Context) => {
          const l = await c.llm.json(
            lesson,
            "Teach every aspect of exactly this requirement in a concise self-contained lesson. Explain mechanisms and practical decisions, a worked example with inputs, steps and result, common mistakes and readiness checks. For programming, database or framework topics include a coding exercise with commented solution, line-by-line reasoning and complexity; otherwise coding may be null. Never claim execution. Use the exact requirement_id.",
            {
              requirement_id: r.id,
              requirement: r,
              role: kit.role.title,
              company: kit.company_brief,
            },
            c.deadline,
            5000,
          );
          if (l.requirement_id !== r.id)
            throw new AppError(
              502,
              "INVALID_LESSON",
              "Lesson references another topic.",
            );
          return l;
        },
      })),
      {
        key: "save_lessons",
        label: "Validate topic coverage and plan learning",
        run: (c: Context) => ({
          lessons: kit.role.requirements.map(
            (_: any, i: number) => c.outputs["lesson_" + i],
          ),
        }),
      },
    ];
  if (data.kind === "resources") return resourceSteps(snapshot);
  if (data.kind === "feedback")
    return [
      {
        key: "practice_feedback",
        label: "Explain your answer and next steps",
        run: (c) =>
          c.llm.json(
            feedback,
            "Coach this attempt. Explain specific mistakes, the correct answer and why it works even for a blank answer. Give actionable revision tasks. Never claim code execution or passed tests.",
            { exercise: snapshot._exercise, answer: data.text },
            c.deadline,
            3000,
          ),
      },
    ];
  return [
    {
      key: "interview_turn",
      label: "Prepare the interviewer response",
      run: async (c) => {
        const finished = snapshot._finish;
        const result = await c.llm.json(
          turn,
          finished
            ? 'The candidate ended the interview. Return question="" and meaningful final feedback with actionable revision tasks. Assess only supplied answers and acknowledge topics not assessed.'
            : `Act as a live coach. Ask ONE adaptive question and never write candidate answers. Answer cross-questions naturally. ${snapshot._interview.mode === "simulation" ? "Simulation mode: feedback and revision_tasks must be empty." : "Teaching mode: explain mistakes and a better approach, then ask one question."}`,
          {
            role: kit.role,
            company: kit.company_brief,
            conversation: snapshot._interview.messages,
          },
          c.deadline,
          2200,
        );
        if (!finished && !result.question.trim())
          throw new AppError(
            502,
            "INVALID_INTERVIEW_TURN",
            "The interviewer did not provide a question.",
          );
        if (!finished && snapshot._interview.mode === "simulation") {
          result.feedback = "";
          result.revision_tasks = [];
        }
        return result;
      },
    },
  ];
}
export function preparePractice(c: any, data: z.infer<typeof generateSchema>) {
  needKit(c);
  if (c.practice_revision !== data.revision) fail();
  const snapshot: any = { _practice: data, _base_kit: structuredClone(c.kit) };
  if (data.kind === "feedback") {
    const task = tasks(c).find(
      (t) => t.id === data.item_id && ["coding", "assignment"].includes(t.kind),
    );
    if (!task) fail("This exercise no longer exists.");
    snapshot._exercise = data.item_id.startsWith("code:")
      ? c.learning.lessons.find(
          (l: any) => "code:" + l.requirement_id === data.item_id,
        ).coding
      : c.kit.questions.find((q: any) => "answer:" + q.id === data.item_id);
  }
  if (data.kind === "interview") {
    let interview = data.interview_id
      ? c.interviews?.find((i: any) => i.id === data.interview_id)
      : null;
    if (
      data.interview_id &&
      (!interview ||
        interview.revision !== data.interview_revision ||
        interview.status !== "active")
    )
      fail("The interview changed. Reload before replying.");
    interview = structuredClone(
      interview || {
        id: randomUUID(),
        mode: data.mode,
        minutes: data.minutes,
        status: "active",
        revision: 1,
        messages: [],
        feedback: null,
        created_at: new Date().toISOString(),
      },
    );
    if (data.text) interview.messages.push({ role: "user", text: data.text });
    snapshot._finish =
      data.finish ||
      interview.messages.filter((m: any) => m.role === "user").length >=
        Math.max(1, Math.ceil(interview.minutes / 3));
    snapshot._interview = interview;
  }
  return snapshot;
}
export function finishPractice(
  c: any,
  snapshot: any,
  outputs: any,
  peers: any[],
) {
  if (!equal(c.kit.role, snapshot._base_kit.role))
    fail("Role requirements changed while generating practice.");
  const data = snapshot._practice;
  const next = structuredClone(c);
  next.practice ||= {};
  next.practice_history ||= [];
  const now = new Date().toISOString();
  if (data.kind === "lessons") {
    next.learning = {
      ...(next.learning || {}),
      role: structuredClone(c.kit.role),
      lessons: outputs.save_lessons.lessons,
    };
    next.practice.plan = allocate(next, peers);
  }
  if (data.kind === "resources")
    next.learning = { ...(next.learning || {}), ...outputs.save_resources };
  if (data.kind === "feedback") {
    const current = preparePractice(
      { ...c, practice_revision: data.revision },
      data,
    )._exercise;
    if (!equal(current, snapshot._exercise))
      fail("The exercise changed during feedback generation.");
    next.practice.drafts ||= {};
    next.practice.drafts[data.item_id] = data.text;
    next.practice.feedback ||= {};
    next.practice.feedback[data.item_id] = outputs.practice_feedback;
    next.practice_history.push({
      id: randomUUID(),
      request_key: data.request_key,
      kind: "feedback",
      created_at: now,
      payload: {
        item_id: data.item_id,
        answer: data.text,
        feedback: outputs.practice_feedback,
      },
    });
  }
  if (data.kind === "interview") {
    const existing = next.interviews?.find(
      (i: any) => i.id === data.interview_id,
    );
    if (data.interview_id && existing?.revision !== data.interview_revision)
      fail();
    const interview = structuredClone(snapshot._interview),
      result = outputs.interview_turn;
    interview.messages.push({
      role: "assistant",
      text: result.question,
      feedback: result.feedback,
      revision_tasks: result.revision_tasks,
    });
    interview.revision++;
    if (snapshot._finish) {
      interview.status = "completed";
      interview.feedback = result.feedback;
    }
    next.interviews = [
      ...(next.interviews || []).filter((i: any) => i.id !== interview.id),
      interview,
    ];
  }
  next.practice_revision++;
  return next;
}
