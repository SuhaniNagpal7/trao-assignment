import { z } from "zod";

export const learnerProfile = z.object({
  level: z.enum(["not_sure", "beginner", "intermediate", "advanced"]).default("not_sure"),
  experience_years: z.number().min(0).max(60).nullable().default(null),
  focus: z.string().trim().max(1500).default(""),
  topics: z.record(z.string().max(100), z.enum(["new", "some", "comfortable"])).default({}),
}).strict().refine(p => Object.keys(p.topics).length <= 60, "Choose up to 60 topics.");

export function profileFor(c: any) {
  return learnerProfile.parse(c.practice?.learner_profile || c.learner_profile || {});
}

export function needsFoundation(c: any, id: string) {
  const p = profileFor(c);
  return p.topics[id] === "new" || (!p.topics[id] && p.level === "beginner");
}
