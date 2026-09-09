import { type Kit, validateKit } from "./schemas.js";
import { coverage } from "./pipeline.js";
import { createHash } from "node:crypto";
import { AppError } from "./errors.js";
export const equal = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
export const fingerprint = (item: any) =>
  createHash("sha256")
    .update(String(item.prompt || item.front || "").toLowerCase().replace(/\s+/g, " ").trim())
    .digest("hex");
export function metadata(kit: Kit, saved: any = {}) {
  const m = structuredClone(saved);
  m.items ||= {};
  m.sections ||= {};
  m.deleted ||= {};
  m.days ||= {};
  for (const group of ["questions", "flashcards"] as const)
    for (const item of kit[group])
      m.items[group + ":" + item.id] ||= {
        origin: "generated",
        edited: false,
        pinned: false,
        revision: 1,
        fingerprint: fingerprint(item),
      };
  return m;
}
export function reconcile(kit: Kit) {
  const k = structuredClone(kit);
  const ids = new Set(k.questions.map((q) => q.id));
  for (const day of k.schedule.days) {
    const old = day.question_ids;
    day.question_ids = [...new Set(old.filter((id) => ids.has(id)))];
    if (old.length && old.length !== day.question_ids.length)
      day.minutes = Math.round(
        (day.minutes * day.question_ids.length) / old.length,
      );
  }
  k.coverage.uncovered_requirement_ids = coverage(
    k.role.requirements,
    k.questions,
  );
  return k;
}
export function warnings(k: Kit) {
  const scheduled = new Set(k.schedule.days.flatMap((d) => d.question_ids));
  return {
    uncovered_required_ids: coverage(
      k.role.requirements.filter((r) => r.priority === "must"),
      k.questions,
    ),
    unscheduled_required_ids: coverage(
      k.role.requirements.filter((r) => r.priority === "must"),
      k.questions.filter((q) => scheduled.has(q.id)),
    ),
  };
}
function validEdit(k: Kit, course: any) {
  const kit = validateKit(k, true);
  if (
    kit.schedule.days_available !== course.days ||
    kit.schedule.days.some((d) => d.minutes > course.daily_minutes)
  )
    throw new AppError(
      422,
      "INVALID_KIT_EDIT",
      "Check the day count and daily time limits.",
    );
  return kit;
}
export function saveEdit(
  course: any,
  data: { revision: number; kit: Kit; pins: string[] },
) {
  if (!course.kit || course.kit_revision !== data.revision)
    throw new AppError(
      409,
      "KIT_CONFLICT",
      "This course changed in another tab or generation run. Your draft is retained; reload the saved version before retrying.",
    );
  const before: Kit = course.kit;
  let candidate: Kit;
  try {
    if (!equal(before.source, data.kit.source)) throw new Error();
    const known = new Set(
      [...before.questions, ...data.kit.questions].map((q) => q.id),
    );
    if (
      data.kit.schedule.days.some((d) =>
        d.question_ids.some((id) => !known.has(id)),
      )
    )
      throw new Error();
    candidate = validEdit(reconcile(data.kit), course);
  } catch {
    throw new AppError(
      422,
      "INVALID_KIT_EDIT",
      "Check edited fields, requirement references, and daily time limits.",
    );
  }
  const meta = metadata(before, course.kit_meta);
  const automatic = reconcile({
    ...structuredClone(before),
    questions: candidate.questions,
  });
  const allowed = new Set(["company_brief", "role", "schedule"]);
  for (const group of ["questions", "flashcards"] as const) {
    const old = new Map<string, any>(before[group].map((i) => [i.id, i])),
      after = new Map<string, any>(candidate[group].map((i) => [i.id, i]));
    for (const [id, item] of old)
      if (!after.has(id))
        meta.deleted[group + ":" + id] = [
          fingerprint(item),
          meta.items[group + ":" + id].fingerprint,
        ];
    for (const [id, item] of after) {
      const key = group + ":" + id;
      if (meta.deleted[key])
        throw new AppError(
          409,
          "DELETED_ITEM",
          "Add deleted content as a new item.",
        );
      const m = meta.items[key] || {
        origin: "manual",
        edited: true,
        revision: 0,
        fingerprint: fingerprint(item),
      };
      const changed = !equal(old.get(id), item);
      meta.items[key] = {
        ...m,
        edited: m.edited || changed,
        pinned: data.pins.includes(key),
        revision: m.revision + Number(changed),
      };
      allowed.add(key);
    }
    const oldOrder = [...old.keys()].filter((id) => after.has(id)),
      newOrder = [...after.keys()].filter((id) => old.has(id));
    if (!equal(oldOrder, newOrder)) {
      meta.sections[group + "_order"] = { edited: true };
      for (const id of oldOrder)
        if (oldOrder.indexOf(id) !== newOrder.indexOf(id)) {
          meta.items[group + ":" + id].edited = true;
          meta.items[group + ":" + id].revision++;
        }
    }
  }
  if (data.pins.some((p) => !allowed.has(p)))
    throw new AppError(422, "INVALID_PIN", "A pinned item no longer exists.");
  for (const section of ["company_brief", "role", "schedule"] as const)
    meta.sections[section] = {
      edited:
        meta.sections[section]?.edited ||
        !equal(automatic[section], candidate[section]),
      pinned: data.pins.includes(section),
    };
  candidate.schedule.days.forEach((d, i) => {
    if (!equal(d, automatic.schedule.days[i]))
      meta.days[String(d.day)] = { edited: true };
  });
  return {
    kit: candidate,
    kit_meta: meta,
    kit_revision: course.kit_revision + 1,
  };
}
const protectedItem = (m: any) =>
  m?.origin === "manual" || m?.edited || m?.pinned;
export function mergeGenerated(
  course: any,
  incoming: Partial<Kit>,
  section = "all",
  baseline?: Kit,
) {
  if (!course.kit) {
    const kit = validateKit(incoming);
    return {
      kit,
      kit_meta: metadata(kit),
      kit_revision: course.kit_revision + 1,
    };
  }
  const current: Kit = structuredClone(course.kit),
    meta = metadata(current, course.kit_meta);
  if (
    baseline &&
    section !== "company_brief" &&
    !equal(baseline.role, current.role)
  )
    throw new AppError(
      409,
      "KIT_CONTEXT_CHANGED",
      "Role requirements changed during generation. Start a new run with your saved edits.",
    );
  for (const key of ["company_brief", "role", "schedule"] as const) {
    if (section !== "all" && section !== key) continue;
    if (!incoming[key]) continue;
    if (key === "schedule") {
      if (!meta.sections.schedule?.pinned)
        current.schedule.days = current.schedule.days.map((d, i) =>
          protectedItem(meta.days[String(d.day)])
            ? d
            : incoming.schedule!.days[i],
        );
    } else if (!protectedItem(meta.sections[key]))
      (current as any)[key] = structuredClone(incoming[key]);
  }
  for (const group of ["questions", "flashcards"] as const) {
    if (
      section !== "all" &&
      !(group === "questions" && section.startsWith("questions_"))
    )
      continue;
    const cat = section.startsWith("questions_") ? section.slice(10) : null;
    const selected = (i: any) => !cat || i.category === cat;
    const kept = (current[group] as any[]).filter(
      (i) => !selected(i) || protectedItem(meta.items[group + ":" + i.id]),
    );
    const keptIds = new Set(kept.map((i) => i.id)),
      fps = new Set(kept.map(fingerprint));
    for (const [key, values] of Object.entries(meta.deleted))
      if (key.startsWith(group + ":"))
        for (const fp of values as string[]) fps.add(fp);
    const replacements = new Map(
      (incoming[group] || [])
        .filter(
          (i) =>
            selected(i) &&
            !keptIds.has(i.id) &&
            !meta.deleted[group + ":" + i.id] &&
            !fps.has(fingerprint(i)),
        )
        .map((i) => [i.id, i]),
    );
    const existing = new Map(kept.map((i) => [i.id, i]));
    const merged: any[] = [];
    for (const old of current[group]) {
      const next = existing.get(old.id) || replacements.get(old.id);
      if (next) merged.push(next);
      existing.delete(old.id);
      replacements.delete(old.id);
    }
    (current as any)[group] = [
      ...merged,
      ...existing.values(),
      ...replacements.values(),
    ];
  }
  const known = new Set(current.role.requirements.map((r) => r.id));
  for (const group of ["questions", "flashcards"] as const) {
    for (const item of current[group])
      for (const id of item.requirement_ids)
        if (
          !known.has(id) &&
          protectedItem(meta.items[group + ":" + item.id])
        ) {
          const previous = course.kit.role.requirements.find(
            (r: any) => r.id === id,
          );
          if (previous) {
            current.role.requirements.push(previous);
            known.add(id);
          }
        }
    (current as any)[group] = current[group].filter((i) =>
      i.requirement_ids.every((id) => known.has(id)),
    );
  }
  const kit = validEdit(reconcile(current), course);
  return {
    kit,
    kit_meta: metadata(kit, meta),
    kit_revision: course.kit_revision + 1,
  };
}
