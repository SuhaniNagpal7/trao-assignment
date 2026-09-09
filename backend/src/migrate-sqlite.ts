/** One-time read-only import of the previous local database. No Python runtime. */
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { connect, client, collection, transaction } from "./db.js";
import { validateKit } from "./schemas.js";
import { fingerprint } from "./app.js";
const input = process.argv[2];
if (!input)
  throw new Error(
    "Usage: npm run migrate:sqlite --workspace backend -- /absolute/path/development.db",
  );
const source = new DatabaseSync(resolve(input), { readOnly: true });
const jsonFields = new Set([
  "kit",
  "kit_meta",
  "practice",
  "learning",
  "checkpoint",
  "input_snapshot",
  "output",
  "payload",
  "messages",
  "feedback",
]);
const read = (table: string) =>
  source
    .prepare("SELECT * FROM " + table)
    .all()
    .map((r: any) =>
      Object.fromEntries(
        Object.entries(r).map(([k, v]) => [
          k,
          jsonFields.has(k) && typeof v === "string" ? JSON.parse(v) : v,
        ]),
      ),
    );
const users = read("users"),
  courses = read("courses"),
  jobs = read("jobs"),
  steps = read("job_steps"),
  events = read("job_events"),
  practiceEvents = read("practice_events"),
  interviews = read("interviews");
source.close();
for (const c of courses) if (c.kit) validateKit(c.kit, true);
await connect();
try {
  await transaction(async (session) => {
    for (const u of users)
      await collection("users").updateOne(
        { _id: u.id },
        { $setOnInsert: { ...u, _id: u.id } },
        { upsert: true, session },
      );
    for (const c of courses) {
      const active = ["generating", "queued", "running"].includes(c.status);
      await collection("courses").updateOne(
        { _id: c.id },
        {
          $setOnInsert: {
            ...c,
            _id: c.id,
            fingerprint: fingerprint(c),
            status: active ? (c.kit ? "ready" : "blocked") : c.status,
            practice_history: practiceEvents.filter(
              (e) => e.course_id === c.id,
            ),
            interviews: interviews.filter((i) => i.course_id === c.id),
          },
        },
        { upsert: true, session },
      );
    }
    for (const j of jobs) {
      const active = ["queued", "running", "retry_wait"].includes(j.status);
      await collection("jobs").updateOne(
        { _id: j.id },
        {
          $setOnInsert: {
            ...j,
            _id: j.id,
            user_id: courses.find((c) => c.id === j.course_id)?.user_id,
            active_key: null,
            status: active ? "blocked" : j.status,
            pipeline_version: "legacy-python",
            error_code: active ? "PIPELINE_VERSION_CHANGED" : j.error_code,
            error_message: active
              ? "Backend migrated. Start a new run; the previous checkpoints are preserved."
              : j.error_message,
            available_at: new Date(j.available_at),
            deadline_at: j.deadline_at ? new Date(j.deadline_at) : new Date(),
            lease_expires_at: new Date(0),
            steps: steps
              .filter((s) => s.job_id === j.id)
              .sort((a, b) => a.position - b.position),
            events: events
              .filter((e) => e.job_id === j.id)
              .sort((a, b) => a.id - b.id),
          },
        },
        { upsert: true, session },
      );
    }
  });
  console.log(
    JSON.stringify({
      users: users.length,
      courses: courses.length,
      jobs: jobs.length,
      source_unchanged: true,
      sessions: "Sign in again after migration.",
    }),
  );
} finally {
  await client.close();
}
