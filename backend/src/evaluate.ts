import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { batchCase, courseInput } from "./schemas.js";
import { generateKit } from "./pipeline.js";
import { settings } from "./config.js";
import { AppError } from "./errors.js";
export async function evaluateCases(
  cases: z.infer<typeof batchCase>[],
  output: string,
  options: Parameters<typeof generateKit>[1] = {},
) {
  const result: any = {
    version: "1.0",
    generated_at: new Date().toISOString(),
    kits: [],
  };
  const deadline = options?.deadline || Date.now() + 840000;
  await mkdir(dirname(output), { recursive: true });
  const save = async () => {
    const tmp = output + ".tmp";
    await writeFile(tmp, JSON.stringify(result, null, 2));
    await rename(tmp, output);
  };
  await save();
  for (const c of cases) {
    try {
      if (Date.now() >= deadline)
        throw new AppError(
          408,
          "BATCH_TIME_BUDGET_EXCEEDED",
          "The batch time budget was exhausted.",
        );
      const kit = await generateKit(
        courseInput.parse({
          title: c.id,
          jd: c.jd,
          company_url: c.company_url,
          days: c.days,
        }),
        {
          ...options,
          deadline: Math.min(deadline, Date.now() + settings.jobTimeout * 1000),
          onStep: (key) => console.error(`[${c.id}] ${key}`),
        },
      );
      result.kits.push({ id: c.id, status: "ok", kit, error: null });
    } catch (error) {
      const e =
        error instanceof AppError
          ? error
          : new AppError(
              500,
              "GENERATION_FAILED",
              "The case could not produce a valid kit.",
            );
      result.kits.push({
        id: c.id,
        status: "failed",
        kit: null,
        error: { code: e.code, message: e.message },
      });
    }
    await save();
  }
  return result;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const args = process.argv.slice(2);
    const value = (key: string) => args[args.indexOf(key) + 1];
    if (!args.includes("--input") || !args.includes("--output"))
      throw new Error(
        "Usage: npm run evaluate -- --input cases.json --output kits.json",
      );
    const input = resolve(value("--input")),
      output = resolve(value("--output"));
    if (input === output)
      throw new Error("Input and output must be different files.");
    const cases = z
      .array(batchCase)
      .parse(JSON.parse(await readFile(input, "utf8")));
    if (new Set(cases.map((c) => c.id)).size !== cases.length)
      throw new Error("Case IDs must be unique.");
    await evaluateCases(cases, output, {
      allowLocal:
        !settings.production && !args.includes("--public-sources-only"),
    });
  } catch (e) {
    console.error(
      e instanceof z.ZodError
        ? "Invalid batch input."
        : e instanceof Error
          ? e.message
          : "Evaluation failed.",
    );
    process.exitCode = 1;
  }
}
