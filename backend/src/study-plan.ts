import { needsFoundation } from "./learner.js";
import { type Kit } from "./schemas.js";
import { equal } from "./editing.js";
export const today = () => new Date().toISOString().slice(0, 10);
export const addDays = (date: string, n: number) =>
  new Date(Date.parse(date + "T00:00:00Z") + n * 86400000)
    .toISOString()
    .slice(0, 10);
export function reviewed(c: any) {
  return Object.fromEntries(
    (c.kit?.flashcards || [])
      .filter((f: any) =>
        equal(c.practice?.reviews?.[f.id]?.content, [f.front, f.back]),
      )
      .map((f: any) => [f.id, c.practice.reviews[f.id]]),
  );
}
export function summary(c: any) {
  const cards = c.kit?.flashcards || [],
    r = reviewed(c);
  return {
    reviewed: Object.keys(r).length,
    total: cards.length,
    coverage: cards.length
      ? Math.round((Object.keys(r).length / cards.length) * 100)
      : 0,
    confident: Object.values(r).filter((v: any) => v.confidence === 3).length,
    questions_attempted: (c.kit?.questions || []).filter((q: any) => c.practice?.feedback?.['answer:' + q.id]).length,
    questions_total: c.kit?.questions?.length || 0,
    activities_completed: (c.practice?.plan?.activities || []).filter((a: any) => c.practice?.completed?.[a.id]).length,
    activities_total: c.practice?.plan?.activities?.length || 0,
    confidence: Object.fromEntries(
      [1, 2, 3].map((n) => [
        String(n),
        Object.values(r).filter((v: any) => v.confidence === n).length,
      ]),
    ),
  };
}
export function cardOrder(c: any): Kit["flashcards"] {
  const reviews = reviewed(c);
  return [...(c.kit?.flashcards || [])].sort((a, b) => {
    const x = reviews[a.id],
      y = reviews[b.id];
    return (
      Number(!!x) - Number(!!y) ||
      (x?.confidence || 0) - (y?.confidence || 0) ||
      (x?.reviewed_at || "").localeCompare(y?.reviewed_at || "") ||
      a.id.localeCompare(b.id)
    );
  });
}
export function tasks(c: any) {
  const kit: Kit = c.kit;
  const result: any[] = [];
  const lessons = (c.learning?.lessons || []).filter((l: any) =>
    kit.role.requirements.some((r) => r.id === l.requirement_id),
  );
  const add = (
    id: string,
    kind: string,
    title: string,
    minutes: number,
    refs: string[],
    prerequisite: string | null = null,
    question_ids: string[] = [],
  ) =>
    result.push({
      id,
      kind,
      title,
      minutes,
      requirement_ids: refs,
      prerequisite,
      question_ids,
      required: kit.role.requirements.some(
        (r) => r.priority === "must" && refs.includes(r.id),
      ),
    });
  for (const l of lessons)
    add("read:" + l.requirement_id, "reading", l.title, l.minutes + (needsFoundation(c, l.requirement_id) ? 10 : 0), [
      l.requirement_id,
    ]);
  for (const q of [...kit.questions].sort(
    (a, b) => b.difficulty - a.difficulty || a.id.localeCompare(b.id),
  )) {
    const l = lessons.find((l: any) =>
      q.requirement_ids.includes(l.requirement_id),
    );
    add(
      "answer:" + q.id,
      "assignment",
      (q.requirement_ids.some(id => needsFoundation(c, id)) ? "Guided practice: " : "") + q.prompt,
      5 + 5 * q.difficulty + (q.requirement_ids.some(id => needsFoundation(c, id)) ? 10 : 0),
      q.requirement_ids,
      l ? "read:" + l.requirement_id : null,
      [q.id],
    );
  }
  for (const l of lessons)
    if (l.coding)
      add(
        "code:" + l.requirement_id,
        "coding",
        l.coding.title,
        20,
        [l.requirement_id],
        "read:" + l.requirement_id,
      );
  for (const f of cardOrder(c))
    add("review:" + f.id, "flashcard", f.front, 5, f.requirement_ids);
  if (kit.role.requirements.length)
    add(
      "mock:1",
      "mock_interview",
      "Practise explaining your decisions",
      15,
      kit.role.requirements.map((r) => r.id),
    );
  for (const r of c.learning?.resources || [])
    add(
      "resource:" + r.id,
      "external_resource",
      r.title,
      r.minutes,
      r.requirement_ids,
    );
  return result;
}
export function allocate(c: any, peers: any[] = [], start = today()) {
  const state = c.practice || {},
    s = state.settings || {},
    old = state.plan || {};
  const end =
    s.end_date ||
    (old.start_date
      ? addDays(old.start_date, old.days - 1)
      : addDays(start, (s.days || c.days) - 1));
  const expired = end < start;
  const days = Math.max(
    1,
    Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1,
  );
  const shared = c.availability_scope === "shared";
  const budget = Math.min(
    s.daily_minutes || c.daily_minutes,
    ...peers
      .filter(
        (p) =>
          p.id !== c.id && shared && p.availability_scope === "shared" && p.kit,
      )
      .map((p) => p.practice?.settings?.daily_minutes || p.daily_minutes),
  );
  const dates = Array.from({ length: days }, (_, i) => addDays(start, i));
  const occupied: Record<string, number> = Object.fromEntries(
    dates.map((d) => [d, 0]),
  );
  const completed = state.completed || {};
  const activities = (old.activities || [])
    .filter((t: any) => completed[t.id] || t.pinned)
    .map((t: any) => structuredClone(t));
  for (const p of peers)
    if (p.id !== c.id && shared && p.availability_scope === "shared")
      for (const t of p.practice?.plan?.activities || [])
        if (t.date in occupied) occupied[t.date] += t.minutes;
  for (const t of activities)
    if (t.date in occupied) occupied[t.date] += t.minutes;
  const allocated = new Map<string, string>(
    activities.map((t: any) => [t.id, t.date]),
  );
  const backlog: any[] = [];
  const priority: Record<string, number> = {
    reading: 0,
    assignment: 1,
    coding: 2,
    flashcard: 3,
    mock_interview: 4,
    external_resource: 5,
  };
  const all = tasks(c).sort(
    (a, b) =>
      Number(!a.required) - Number(!b.required) ||
      priority[a.kind] - priority[b.kind],
  );
  for (const t of all) {
    if (allocated.has(t.id) || completed[t.id]) continue;
    if (
      t.prerequisite &&
      !allocated.has(t.prerequisite) &&
      !completed[t.prerequisite]
    ) {
      backlog.push({ ...t, reason: "Prerequisite reading does not fit." });
      continue;
    }
    const earliest = allocated.get(t.prerequisite) || dates[0];
    let choices = dates.filter(
      (d) => !expired && d >= earliest && occupied[d] + t.minutes <= budget,
    );
    if (t.kind === "mock_interview") choices.reverse();
    else if (t.kind === "flashcard" && choices.length > 2)
      choices = [...choices.slice(1), choices[0]];
    else if (t.prerequisite)
      choices.sort(
        (a, b) =>
          Number(a === earliest) - Number(b === earliest) || a.localeCompare(b),
      );
    const selected = choices[0];
    if (!selected) {
      backlog.push({ ...t, reason: "Insufficient remaining study time." });
      continue;
    }
    activities.push({ ...t, date: selected, pinned: false });
    allocated.set(t.id, selected);
    occupied[selected] += t.minutes;
  }
  for (const f of cardOrder(c)) {
    const first = allocated.get("review:" + f.id),
      id = "repeat:" + f.id;
    if (!first || allocated.has(id) || completed[id]) continue;
    const choices = dates.filter((d) => d > first && occupied[d] + 5 <= budget);
    const selected = choices.at(-1);
    if (selected) {
      activities.push({
        id,
        kind: "flashcard",
        title: f.front,
        minutes: 5,
        requirement_ids: f.requirement_ids,
        prerequisite: null,
        question_ids: [],
        required: false,
        date: selected,
        pinned: false,
      });
      occupied[selected] += 5;
    }
  }
  return {
    start_date: start,
    end_date: end,
    expired,
    days,
    daily_minutes: budget,
    activities: activities.sort(
      (a: any, b: any) =>
        a.date.localeCompare(b.date) || priority[a.kind] - priority[b.kind],
    ),
    backlog,
    shortfall_minutes: backlog
      .filter((t) => t.required)
      .reduce((n, t) => n + t.minutes, 0),
    conflicts: Object.entries(occupied)
      .filter(([, n]) => n > budget)
      .map(([date, minutes]) => ({ date, minutes, budget })),
  };
}
export function projection(c: any, p: any) {
  return {
    days_available: p.days,
    days: Array.from({ length: p.days }, (_, i) => {
      const selected = p.activities.filter(
        (a: any) => a.date === addDays(p.start_date, i),
      );
      return {
        day: i + 1,
        focus:
          [
            ...new Set(selected.map((a: any) => a.kind.replaceAll("_", " "))),
          ].join(", ") || "Light review",
        minutes: selected.reduce((n: number, a: any) => n + a.minutes, 0),
        question_ids: [
          ...new Set(selected.flatMap((a: any) => a.question_ids)),
        ].filter((id) => c.kit.questions.some((q: any) => q.id === id)),
      };
    }),
  };
}

export function weakSpots(c: any) {
  const reviews = reviewed(c);
  return (c.kit?.role.requirements || []).map((requirement: any) => {
    const cards = (c.kit?.flashcards || []).filter((f: any) => f.requirement_ids.includes(requirement.id));
    const seen = cards.filter((f: any) => reviews[f.id]);
    return { id: requirement.id, topic: requirement.text, kind: requirement.kind, priority: requirement.priority,
      total: cards.length, reviewed: seen.length,
      confidence: seen.length ? Math.round(seen.reduce((sum: number, f: any) => sum + (reviews[f.id].confidence - 1) * 50, 0) / seen.length) : null };
  }).sort((a: any, b: any) => (a.confidence ?? -1) - (b.confidence ?? -1) || a.topic.localeCompare(b.topic));
}
