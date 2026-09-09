import { z } from "zod";
export const url = z
  .string()
  .max(2048)
  .url()
  .refine((s) => {
    const u = new URL(s);
    return (
      ["http:", "https:"].includes(u.protocol) && !u.username && !u.password
    );
  }, "Use an HTTP(S) URL without credentials");
const text = z.string().min(1);
export const credentials = z
  .object({
    email: z
      .string()
      .email()
      .max(254)
      .transform((s) => s.toLowerCase()),
    password: z.string().min(10).max(128),
  })
  .strict();
export const registration = credentials.extend({
  name: z.string().trim().min(1).max(80),
});
export const courseInput = z
  .object({
    title: z.string().trim().min(1).max(120),
    company_name: z.string().max(120).default(""),
    company_url: url,
    jd: text.max(50000),
    days: z.number().int().min(1).max(60),
    daily_minutes: z.number().int().min(15).max(720).default(120),
    availability_scope: z.enum(["shared", "course"]).default("shared"),
  })
  .strict();
export const batchCase = z
  .object({
    id: text.max(120),
    jd: text.max(50000),
    company_url: url,
    days: z.number().int().min(1).max(60),
  })
  .strict();
export const batchInput = z
  .object({
    cases: z.array(batchCase).min(1).max(20),
    daily_minutes: z.number().int().min(15).max(720).default(120),
  })
  .strict()
  .refine(
    (v) => new Set(v.cases.map((c) => c.id)).size === v.cases.length,
    "Case IDs must be unique",
  );
export const requirement = z
  .object({
    id: text,
    text,
    kind: z.enum(["technical", "behavioural", "domain"]),
    priority: z.enum(["must", "nice"]),
  })
  .strict();
export const role = z
  .object({
    title: z.string(),
    seniority: z.string(),
    responsibilities: z.array(z.string()),
    requirements: z.array(requirement).max(60),
  })
  .strict();
export const question = z
  .object({
    id: text,
    requirement_ids: z.array(text),
    category: z.enum([
      "technical",
      "behavioural",
      "system-design",
      "company-fit",
    ]),
    prompt: text,
    answer_outline: text,
    difficulty: z.number().int().min(1).max(3),
  })
  .strict();
export const flashcard = z
  .object({ id: text, front: text, back: text, requirement_ids: z.array(text) })
  .strict();
export const brief = z
  .object({
    summary: z.string(),
    what_they_do: z.string(),
    sources: z.array(url),
  })
  .strict();
export const schedule = z
  .object({
    days_available: z.number().int().min(1).max(60),
    days: z.array(
      z
        .object({
          day: z.number().int().min(1),
          focus: z.string(),
          question_ids: z.array(text),
          minutes: z.number().int().min(0),
        })
        .strict(),
    ),
  })
  .strict();
export const kitSchema = z
  .object({
    source: z
      .object({
        company: z.string(),
        company_url: url,
        role: z.string(),
        location: z.string(),
        jd_chars: z.number().int().min(0),
        researched_at: z.string().datetime({ offset: true }),
        pages_used: z.array(url),
      })
      .strict(),
    company_brief: brief,
    role,
    questions: z.array(question).max(200),
    flashcards: z.array(flashcard).max(200),
    schedule,
    coverage: z
      .object({
        uncovered_requirement_ids: z.array(text),
        passes: z.number().int().min(1),
      })
      .strict(),
  })
  .strict();
export type Kit = z.infer<typeof kitSchema>;
export type Input = z.infer<typeof courseInput>;
export function validateKit(value: unknown, allowGaps = false): Kit {
  const k = kitSchema.parse(value);
  const fail = (m: string) => {
    throw new Error(m);
  };
  for (const group of [k.questions, k.flashcards, k.role.requirements])
    if (new Set(group.map((i) => i.id)).size !== group.length)
      fail("Duplicate IDs");
  const r = new Set(k.role.requirements.map((r) => r.id)),
    q = new Map(k.questions.map((q) => [q.id, q]));
  for (const item of [...k.questions, ...k.flashcards])
    if (item.requirement_ids.some((id) => !r.has(id)))
      fail("Unknown requirement");
  if (
    k.schedule.days.length !== k.schedule.days_available ||
    k.schedule.days.some((d, i) => d.day !== i + 1)
  )
    fail("Schedule must have exactly the requested consecutive days");
  const covered = new Set(k.questions.flatMap((q) => q.requirement_ids)),
    scheduled = new Set<string>();
  for (const d of k.schedule.days)
    for (const id of d.question_ids) {
      if (!q.has(id)) fail("Unknown scheduled question");
      q.get(id)!.requirement_ids.forEach((r) => scheduled.add(r));
    }
  const uncovered = [...r].filter((id) => !covered.has(id)).sort();
  if (
    JSON.stringify(uncovered) !==
    JSON.stringify([...k.coverage.uncovered_requirement_ids].sort())
  )
    fail("Incorrect coverage");
  if (
    !allowGaps &&
    k.role.requirements.some(
      (r) =>
        r.priority === "must" && (!covered.has(r.id) || !scheduled.has(r.id)),
    )
  )
    fail("Must-have requirement missing from questions or schedule");
  return k;
}
