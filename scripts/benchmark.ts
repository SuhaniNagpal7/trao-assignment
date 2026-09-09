import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { settings } from "../backend/src/config.js";
import { validateKit } from "../backend/src/schemas.js";
if (!settings.geminiKey)
  throw new Error("Configure GEMINI_API_KEY before running a live benchmark.");
const server = createServer((req, res) => {
  res.setHeader(
    "Content-Type",
    req.url === "/robots.txt" ? "text/plain" : "text/html",
  );
  if (req.url === "/robots.txt") res.end("User-agent: *\nAllow: /");
  else if (req.url === "/")
    res.end(
      '<body>Harbour Tools is a fictional developer tools company. <a href="/team/handbook/hiring">Our interview process</a><a href="/company/our-story">About the company</a></body>',
    );
  else if (req.url === "/team/handbook/hiring")
    res.end(
      "<body>Fictional hiring process: a practical exercise followed by a design discussion.</body>",
    );
  else if (req.url === "/company/our-story")
    res.end(
      "<body>Harbour Tools builds tools that help teams test and ship software.</body>",
    );
  else {
    res.statusCode = 404;
    res.end("Not found");
  }
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = "http://127.0.0.1:" + (server.address() as any).port;
const folder = "output/stack-migration-benchmark";
await mkdir(folder, { recursive: true });
const cases = [
  {
    id: "one-day-javascript",
    jd: "JavaScript Developer. Required: write and debug JavaScript functions.",
    company_url: origin,
    days: 1,
  },
  {
    id: "frontend-fourteen-days",
    jd: "Frontend Engineer. Required: build accessible React interfaces. Bonus: TypeScript.",
    company_url: origin,
    days: 14,
  },
  {
    id: "leadership-sixty-days",
    jd: "Engineering Lead. Required: mentor junior engineers and communicate delivery risks clearly.",
    company_url: origin,
    days: 60,
  },
  {
    id: "thin-description",
    jd: "Join us! An opportunity to grow.",
    company_url: origin + "/missing",
    days: 14,
  },
  {
    id: "sql-unavailable-company",
    jd: "Data Analyst. Required: write SQL queries using joins and aggregation.",
    company_url: origin + "/missing",
    days: 7,
  },
];
await writeFile(folder + "/cases.json", JSON.stringify(cases, null, 2));
const start = Date.now();
try {
  const args = [
    "run",
    "evaluate",
    "--",
    "--input",
    folder + "/cases.json",
    "--output",
    folder + "/kits.json",
  ];
  const child =
    process.platform === "win32"
      ? spawn("cmd.exe", ["/d", "/c", "npm.cmd", ...args], { stdio: "inherit" })
      : spawn("npm", args, { stdio: "inherit" });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", resolve);
  });
  const output = JSON.parse(await readFile(folder + "/kits.json", "utf8"));
  for (const result of output.kits)
    if (result.status === "ok") {
      validateKit(result.kit);
      if (
        result.kit.schedule.days_available !==
        cases.find((c) => c.id === result.id)!.days
      )
        throw new Error("Wrong day count");
    }
  const report = {
    elapsed_seconds: (Date.now() - start) / 1000,
    within_fifteen_minutes: Date.now() - start < 900000,
    exit_code: code,
    cases: output.kits.map((r: any) => ({
      id: r.id,
      status: r.status,
      questions: r.kit?.questions.length,
      coverage_passes: r.kit?.coverage.passes,
      error: r.error,
    })),
  };
  await writeFile(folder + "/report.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (code !== 0 || output.kits.some((r: any) => r.status !== "ok"))
    process.exitCode = 1;
} finally {
  server.close();
}
