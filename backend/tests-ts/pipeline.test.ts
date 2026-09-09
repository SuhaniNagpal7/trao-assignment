import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { OpenAI, type Llm } from "../src/provider.js";
import { settings } from "../src/config.js";
import { generateKit, steps } from "../src/pipeline.js";
import { courseInput } from "../src/schemas.js";
import { crawlCompany, retrieve } from "../src/research.js";
import { evaluateCases } from "../src/evaluate.js";
import { AppError } from "../src/errors.js";
class FixtureModel implements Llm {
  repair = false;
  async json<T>(
    schema: z.ZodType<T>,
    instructions: string,
    data: any,
  ): Promise<T> {
    if (instructions.startsWith("Extract"))
      return schema.parse({
        title: "Engineer",
        seniority: "",
        responsibilities: [],
        requirements:
          data.jd === "thin"
            ? []
            : [
                {
                  id: "placeholder",
                  text: "JavaScript",
                  evidence: "JavaScript",
                  kind: "technical",
                  priority: "must",
                },
              ],
        warnings: [],
      });
    if (instructions.startsWith("Write"))
      return schema.parse({
        summary: "Fictional company for tests.",
        what_they_do: "Builds test tools.",
        sources: [data.sources[0].url],
      });
    if (instructions.startsWith("Generate")) {
      if (instructions.includes("technical.") && !this.repair) {
        this.repair = true;
        return schema.parse({ questions: [] });
      }
      return schema.parse({
        questions: data.requirements.map((r: any) => ({
          id: "placeholder",
          requirement_ids: [r.id],
          category: "technical",
          prompt: "Explain " + r.text,
          answer_outline:
            "Use a small example to explain the mechanism and tradeoffs.",
          difficulty: 2,
        })),
      });
    }
    return schema.parse({
      flashcards: data.requirements.map((r: any) => ({
        id: "placeholder",
        requirement_ids: [r.id],
        front: "What is " + r.text + "?",
        back: "A focused teaching example.",
      })),
    });
  }
}
test("extraction repairs fabricated quote wording without weakening evidence checks", async () => {
  let calls = 0;
  const llm: Llm = {
    json: async (schema, _instructions, data: any) => {
      calls++;
      if (calls === 2)
        assert.deepEqual(data.invalid_evidence, ["Required: JavaScript."]);
      return schema.parse({
        title: "Engineer",
        seniority: "",
        responsibilities: [],
        warnings: [],
        requirements: [
          {
            id: "temp",
            text: "JavaScript",
            kind: "technical",
            priority: "must",
            evidence: calls === 1 ? "Required: JavaScript." : "JavaScript",
          },
        ],
      });
    },
  };
  const result = await steps
    .find((s) => s.key === "extract_job")!
    .run({
      input: courseInput.parse({
        title: "Test",
        jd: "Required: JavaScript and SQL.",
        company_url: "https://example.com",
        days: 14,
      }),
      outputs: {},
      deadline: Date.now() + 1000,
      llm,
    });
  assert.equal(calls, 2);
  assert.equal(result.requirements[0].evidence, "JavaScript");
});
async function fixture() {
  const server = createServer((req, res) => {
    res.setHeader("Content-Type", "text/html");
    if (req.url === "/robots.txt") {
      res.setHeader("Content-Type", "text/plain");
      res.end("User-agent: *\nAllow: /\nDisallow: /private");
      return;
    }
    if (req.url === "/")
      res.end(
        '<body>Fictional company <a href="/handbook/unexpected-hiring">How we hire</a><a href="/private">Hiring private</a></body>',
      );
    else if (req.url === "/handbook/unexpected-hiring")
      res.end(
        "<body>Our interview includes a take-home and design discussion.</body>",
      );
    else {
      res.statusCode = 404;
      res.end("Missing");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      ),
  };
}
test("crawler discovers relative hiring links and respects robots", async () => {
  const f = await fixture();
  try {
    const result = await crawlCompany(f.url, Date.now() + 10000, true);
    assert.ok(
      result.sources.some((p) => p.url.endsWith("/handbook/unexpected-hiring")),
    );
    assert.ok(result.skipped.some((p) => p.reason.includes("robots")));
  } finally {
    await f.close();
  }
});
test("web retrieval rejects local fixtures unless explicitly authorised for CLI", async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      () => retrieve(f.url, Date.now() + 10000),
      /network addresses/,
    );
  } finally {
    await f.close();
  }
});
test("full pipeline detects a real coverage gap and repairs it before scheduling", async () => {
  const f = await fixture(),
    llm = new FixtureModel();
  try {
    const seen: string[] = [];
    const k = await generateKit(
      courseInput.parse({
        title: "Fixture",
        jd: "JavaScript required.",
        company_url: f.url,
        days: 14,
      }),
      { llm, allowLocal: true, onStep: (k) => seen.push(k) },
    );
    assert.equal(k.coverage.passes, 2);
    assert.deepEqual(k.coverage.uncovered_requirement_ids, []);
    assert.equal(k.schedule.days.length, 14);
    assert.ok(seen.indexOf("coverage_initial") < seen.indexOf("repair_1"));
    assert.ok(k.source.pages_used.some((p) => p.includes("unexpected-hiring")));
  } finally {
    await f.close();
  }
});
test("batch continues after a failure and writes exact Appendix B for a thin JD", async () => {
  const f = await fixture(),
    dir = await mkdtemp(join(tmpdir(), "ahead-evaluate-"));
  let calls = 0;
  const llm = new FixtureModel(),
    wrapped: Llm = {
      json: async (...args) => {
        if (calls++ === 0)
          throw new AppError(
            503,
            "TEST_FAILURE",
            "Deliberate fixture failure.",
          );
        return llm.json(...args);
      },
    };
  try {
    const result = await evaluateCases(
      [
        { id: "fails", jd: "JavaScript", company_url: f.url, days: 1 },
        { id: "thin", jd: "thin", company_url: f.url, days: 60 },
      ],
      join(dir, "kits.json"),
      { llm: wrapped, allowLocal: true },
    );
    assert.deepEqual(Object.keys(result), ["version", "generated_at", "kits"]);
    assert.equal(result.kits[0].status, "failed");
    assert.equal(result.kits[1].status, "ok");
    assert.equal(result.kits[1].kit.questions.length, 0);
    assert.equal(result.kits[1].kit.schedule.days.length, 60);
    assert.deepEqual(
      JSON.parse(await readFile(join(dir, "kits.json"), "utf8")),
      result,
    );
  } finally {
    await f.close();
    await rm(dir, { recursive: true });
  }
});
test("OpenAI retries malformed JSON, authenticates using a header, and validates output", async () => {
  const old = settings.openaiKey;
  settings.openaiKey = "fixture-only";
  let calls = 0;
  try {
    const transport: typeof fetch = async (_url, options) => {
      assert.equal(_url, "https://api.openai.com/v1/responses");
      assert.equal(
        (options!.headers as any).Authorization,
        "Bearer fixture-only",
      );
      assert.equal(JSON.parse(String(options!.body)).store, false);
      assert.match(String(options!.body), /output_schema/);
      calls++;
      return new Response(
        JSON.stringify({
          status: "completed",
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: calls === 1 ? "invalid" : '{"answer":"ok"}',
                },
              ],
            },
          ],
        }),
        { status: 200 },
      );
    };
    const gemini = new OpenAI(async () => {}, transport);
    assert.deepEqual(
      await gemini.json(
        z.object({ answer: z.string() }),
        "Answer",
        {},
        Date.now() + 1000,
      ),
      { answer: "ok" },
    );
    assert.equal(calls, 2);
  } finally {
    settings.openaiKey = old;
  }
});
test("OpenAI rate-limit response respects deadline and never falls back to another provider", async () => {
  const old = settings.openaiKey;
  settings.openaiKey = "fixture-only";
  let calls = 0;
  try {
    const gemini = new OpenAI(
      async () => {},
      async () => {
        calls++;
        return new Response("{}", {
          status: 429,
          headers: { "retry-after": "60" },
        });
      },
    );
    await assert.rejects(
      () => gemini.json(z.object({}), "Answer", {}, Date.now() + 1000),
      (e: any) => e.code === "RATE_LIMITED",
    );
    assert.equal(calls, 1);
  } finally {
    settings.openaiKey = old;
  }
});
