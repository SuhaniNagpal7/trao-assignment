import { extractDocument } from "./documents.js";
import express from "express";
import {
  randomBytes,
  randomUUID,
  createHash,
  timingSafeEqual,
} from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { z, ZodError } from "zod";
import { collection, transaction, db } from "./db.js";
import { settings, originAllowed } from "./config.js";
import { AppError, conflict } from "./errors.js";
import {
  registration,
  credentials,
  courseInput,
  batchInput,
  kitSchema,
} from "./schemas.js";
import { ownedCourse, enqueue, jobView, retryJob } from "./jobs.js";
import { saveEdit, metadata, warnings } from "./editing.js";
import { summary, allocate, today } from "./study-plan.js";
import {
  practiceView,
  practiceCommand,
  commandSchema,
  generateSchema,
} from "./practice.js";
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
export const fingerprint = (v: any) =>
  digest(
    JSON.stringify([
      v.jd,
      v.company_url,
      v.days,
      v.daily_minutes,
      v.availability_scope,
      v.learner_profile,
    ]),
  );
const cookie = (req: express.Request) =>
  req.headers.cookie
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("prep_session="))
    ?.slice(13) || "";
function same(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
const publicUser = (u: any) => ({ id: u.id, name: u.name, email: u.email });
export function courseView(c: any, full = false) {
  const keys = [
    "id",
    "title",
    "company_name",
    "company_url",
    "days",
    "daily_minutes",
    "availability_scope",
    "learner_profile",
    "status",
    "revision",
    "created_at",
    "updated_at",
  ];
  const result: any = Object.fromEntries(keys.map((k) => [k, c[k]]));
  result.practice_progress = c.kit ? summary(c).coverage : null;
  result.practice_summary = c.kit ? summary(c) : null;
  if (full)
    Object.assign(result, {
      jd: c.jd,
      kit: c.kit || null,
      kit_revision: c.kit_revision,
      kit_meta: c.kit ? metadata(c.kit, c.kit_meta) : {},
      kit_warnings: c.kit ? warnings(c.kit) : {},
    });
  return result;
}
const app = express();
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  const origin = req.headers.origin;
  if (origin && originAllowed(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");
  }
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,X-CSRF-Token");
    res.sendStatus(204);
    return;
  }
  if (
    ["POST", "PUT", "PATCH", "DELETE"].includes(req.method) &&
    !originAllowed(origin)
  ) {
    next(
      new AppError(403, "ORIGIN_REJECTED", "Request origin is not allowed."),
    );
    return;
  }
  next();
});
app.use(express.json({ limit: 2000000 }));
app.get("/api/health", (_req, res) =>
  res.json({ status: "ok", phase: 7, stack: "express-typescript-mongodb" }),
);
app.get("/api/health/ready", async (_req, res) => {
  try {
    await db().command({ ping: 1 });
    res.json({ status: "ready" });
  } catch {
    throw new AppError(503, "NOT_READY", "MongoDB is not ready.");
  }
});
app.use("/api/auth", async (req, _res, next) => {
  if (req.method !== "POST" || !["/login", "/register"].includes(req.path)) {
    next();
    return;
  }
  const bucket = Math.floor(Date.now() / 60000),
    id = "auth:" + digest(req.socket.remoteAddress || "unknown") + ":" + bucket;
  const r = await collection("rate_limits").findOneAndUpdate(
    { _id: id },
    {
      $inc: { requests: 1 },
      $setOnInsert: { expires_at: new Date((bucket + 2) * 60000) },
    },
    { upsert: true, returnDocument: "after" },
  );
  if (r!.requests > 15)
    throw new AppError(
      429,
      "RATE_LIMITED",
      "Too many attempts. Try again in a minute.",
      60000,
    );
  next();
});
async function createSession(
  u: any,
  req: express.Request,
  res: express.Response,
) {
  const token = randomBytes(32).toString("base64url"),
    csrf = randomBytes(32).toString("hex");
  await transaction(async (session) => {
    const previous = cookie(req);
    if (previous)
      await collection("sessions").deleteOne(
        { _id: digest(previous) },
        { session },
      );
    await collection("sessions").insertOne(
      {
        _id: digest(token),
        user_id: u.id,
        csrf_token: csrf,
        expires_at: new Date(Date.now() + settings.sessionDays * 86400000),
      },
      { session },
    );
  });
  res.cookie("prep_session", token, {
    httpOnly: true,
    secure: settings.production,
    sameSite: "lax",
    path: "/",
    maxAge: settings.sessionDays * 86400000,
  });
  return { user: publicUser(u), csrf_token: csrf };
}
app.post("/api/auth/register", async (req, res) => {
  const v = registration.parse(req.body),
    id = randomUUID();
  const u = {
    _id: id,
    id,
    name: v.name,
    email: v.email,
    password_hash: await hash(v.password),
    created_at: new Date().toISOString(),
  };
  try {
    await collection("users").insertOne(u);
  } catch (e: any) {
    if (e.code === 11000)
      throw new AppError(
        409,
        "EMAIL_UNAVAILABLE",
        "Unable to register with this email. Try signing in.",
      );
    throw e;
  }
  res.status(201).json(await createSession(u, req, res));
});
let dummy: Promise<string> | undefined;
app.post("/api/auth/login", async (req, res) => {
  const v = credentials.parse(req.body),
    u = await collection("users").findOne({ email: v.email });
  dummy ||= hash("dummy-password-for-timing-only");
  const valid = await verify(
    u?.password_hash || (await dummy),
    v.password,
  ).catch(() => false);
  if (!u || !valid)
    throw new AppError(
      401,
      "INVALID_CREDENTIALS",
      "Email or password is incorrect.",
    );
  res.json(await createSession(u, req, res));
});
app.use("/api", async (req, res, next) => {
  const token = cookie(req);
  const session = token
    ? await collection("sessions").findOne({
        _id: digest(token),
        expires_at: { $gt: new Date() },
      })
    : null;
  if (!session)
    throw new AppError(401, "SESSION_EXPIRED", "Please sign in to continue.");
  if (
    !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
    !same(String(req.headers["x-csrf-token"] || ""), session.csrf_token)
  )
    throw new AppError(403, "CSRF_INVALID", "Refresh the page and try again.");
  const user = await collection("users").findOne({ _id: session.user_id });
  if (!user)
    throw new AppError(401, "SESSION_EXPIRED", "Please sign in to continue.");
  res.locals.user = user;
  res.locals.session = session;
  next();
});
app.get("/api/auth/me", (_req, res) =>
  res.json({
    user: publicUser(res.locals.user),
    csrf_token: res.locals.session.csrf_token,
  }),
);
app.post("/api/auth/logout", async (_req, res) => {
  await collection("sessions").deleteOne({ _id: res.locals.session._id });
  res.clearCookie("prep_session", {
    path: "/",
    secure: settings.production,
    httpOnly: true,
    sameSite: "lax",
  });
  res.sendStatus(204);
});
app.post("/api/documents/extract", express.raw({ type: "application/pdf", limit: 5_000_000 }), async (req, res) => {
  if (!req.is("application/pdf")) throw new AppError(415, "PDF_REQUIRED", "Upload a PDF document.");
  const bucket = Math.floor(Date.now() / 60000);
  const quota = await collection("rate_limits").findOneAndUpdate(
    { _id: "pdf:" + res.locals.user.id + ":" + bucket },
    { $inc: { requests: 1 }, $setOnInsert: { expires_at: new Date((bucket + 2) * 60000) } },
    { upsert: true, returnDocument: "after" });
  if (quota!.requests > 3) throw new AppError(429, "RATE_LIMITED", "Please wait a minute before uploading another PDF.", 60000);
  const extracted = await extractDocument(req.body);
  const id = randomUUID();
  await collection("document_imports").insertOne({ _id: id, user_id: res.locals.user.id, extracted, created_at: new Date() });
  res.json({ id, extracted });
});
async function saveDraft(userId: string, v: any, session?: any) {
  const fp = fingerprint(v);
  const old = await collection("courses").findOne(
    { user_id: userId, fingerprint: fp },
    { session },
  );
  if (old) return { course: old, created: false };
  const id = randomUUID(),
    now = new Date().toISOString(),
    c = {
      _id: id,
      id,
      user_id: userId,
      ...v,
      fingerprint: fp,
      status: "draft",
      revision: 1,
      kit_revision: 0,
      kit: null,
      kit_meta: {},
      practice_revision: 1,
      practice: {},
      learning: {},
      interviews: [],
      practice_history: [],
      created_at: now,
      updated_at: now,
    };
  await collection("courses").insertOne(c, { session });
  return { course: c, created: true };
}
app.get("/api/courses", async (_req, res) => {
  const rows = await collection("courses")
    .find({ user_id: res.locals.user.id })
    .sort({ created_at: -1 })
    .toArray();
  res.json({ courses: rows.map((c) => courseView(c)) });
});
app.post("/api/courses/create-and-generate", async (req, res) => {
  const v = courseInput.parse(req.body);
  const result = await transaction(async session => {
    const saved = await saveDraft(res.locals.user.id, v, session);
    if (saved.course.status === "ready") return { course: courseView(saved.course, true), created: false, job: null };
    const queued = await enqueue(saved.course.id, res.locals.user.id, { include_lessons: true }, "generate", session);
    const current = await ownedCourse(saved.course.id, res.locals.user.id, session);
    return { course: courseView(current, true), created: saved.created, job: jobView(queued.job) };
  });
  res.status(201).json(result);
});
app.post("/api/courses", async (req, res) => {
  const v = courseInput.parse(req.body);
  let result;
  try {
    result = await saveDraft(res.locals.user.id, v);
  } catch (e: any) {
    if (e.code !== 11000) throw e;
    result = {
      course: await collection("courses").findOne({
        user_id: res.locals.user.id,
        fingerprint: fingerprint(v),
      }),
      created: false,
    };
  }
  res
    .status(201)
    .json({ course: courseView(result.course, true), created: result.created });
});
app.post("/api/courses/batch", async (req, res) => {
  const { auto_generate = false, ...batch } = req.body || {};
  z.boolean().parse(auto_generate);
  const v = batchInput.parse(batch);
  const results = await transaction(async (session) => {
    const out = [];
    for (const c of v.cases) {
      const result = await saveDraft(
        res.locals.user.id,
        courseInput.parse({
          title: c.id,
          jd: c.jd,
          company_url: c.company_url,
          days: c.days,
          daily_minutes: v.daily_minutes,
        }),
        session,
      );
      if (auto_generate && result.course.status !== "ready") {
        await enqueue(result.course.id, res.locals.user.id, { include_lessons: true }, "generate", session);
        result.course = await ownedCourse(result.course.id, res.locals.user.id, session);
      }
      out.push({
        case_id: c.id,
        course: courseView(result.course, true),
        created: result.created,
      });
    }
    return out;
  });
  res.status(201).json({ results });
});
app.get("/api/courses/:id", async (req, res) =>
  res.json({
    course: courseView(
      await ownedCourse(String(req.params.id), res.locals.user.id),
      true,
    ),
  }),
);
app.put("/api/courses/:id", async (req, res) => {
  const v = courseInput
      .extend({ revision: z.number().int().min(1) })
      .parse(req.body),
    { revision, ...values } = v;
  const id = String(req.params.id);
  await ownedCourse(id, res.locals.user.id);
  let c;
  try {
    c = await collection("courses").findOneAndUpdate(
      {
        _id: id,
        user_id: res.locals.user.id,
        revision,
        status: { $in: ["draft", "blocked", "failed"] },
      },
      {
        $set: {
          ...values,
          fingerprint: fingerprint(values),
          status: "draft",
          updated_at: new Date().toISOString(),
        },
        $inc: { revision: 1 },
      },
      { returnDocument: "after" },
    );
  } catch (e: any) {
    if (e.code === 11000)
      throw new AppError(
        409,
        "DUPLICATE_COURSE",
        "A course with these preparation inputs already exists.",
      );
    throw e;
  }
  if (!c) throw conflict();
  res.json({ course: courseView(c, true) });
});
const generation = z
  .object({
    request_key: z.string().min(1).max(128).optional(),
    force: z.boolean().default(false),
    include_lessons: z.boolean().default(false),
  })
  .strict();
app.post("/api/courses/:id/generate", async (req, res) => {
  const r = await enqueue(
    String(req.params.id),
    res.locals.user.id,
    generation.parse(req.body || {}),
  );
  res.status(202).json({ job: jobView(r.job), created: r.created });
});
app.put("/api/courses/:id/kit", async (req, res) => {
  const data = z
    .object({
      revision: z.number().int().min(1),
      kit: kitSchema,
      pins: z.array(z.string()).max(500).default([]),
    })
    .strict()
    .parse(req.body);
  const c = await transaction(async (session) => {
    const old = await ownedCourse(
      String(req.params.id),
      res.locals.user.id,
      session,
    );
    const values = saveEdit(old, data);
    await collection("courses").updateOne(
      { _id: old.id },
      {
        $set: { ...values, updated_at: new Date().toISOString() },
        $inc: { _write_revision: 1 },
      },
      { session },
    );
    return { ...old, ...values };
  });
  res.json({ course: courseView(c, true) });
});
app.post("/api/courses/:id/regenerate", async (req, res) => {
  const data = z
    .object({
      revision: z.number().int().min(1),
      section: z.string(),
      request_key: z.string().min(1).max(128),
    })
    .strict()
    .parse(req.body);
  const r = await enqueue(
    String(req.params.id),
    res.locals.user.id,
    data,
    "regenerate",
  );
  res.status(202).json({ job: jobView(r.job), created: r.created });
});
app.get("/api/courses/:id/jobs", async (req, res) => {
  await ownedCourse(String(req.params.id), res.locals.user.id);
  const jobs = await collection("jobs")
    .find({ course_id: req.params.id })
    .sort({ created_at: -1 })
    .limit(20)
    .toArray();
  res.json({ jobs: jobs.map(jobView) });
});
app.get("/api/jobs/:id", async (req, res) => {
  const { after_event_id: after, limit } = z
    .object({
      after_event_id: z.coerce.number().int().min(0).default(0),
      limit: z.coerce.number().int().min(1).max(200).default(100),
    })
    .parse(req.query);
  const j = await collection("jobs").findOne({
    _id: String(req.params.id),
    user_id: res.locals.user.id,
  });
  if (!j) throw new AppError(404, "JOB_NOT_FOUND", "Generation run not found.");
  const all = j.events.filter((e: any) => e.id > after),
    events = all.slice(0, limit);
  res.json({
    job: jobView(j),
    events,
    next_cursor: events.at(-1)?.id || after,
    has_more: all.length > limit,
  });
});
app.post("/api/jobs/:id/retry", async (req, res) =>
  res
    .status(202)
    .json({
      job: jobView(await retryJob(String(req.params.id), res.locals.user.id)),
    }),
);
app.get("/api/courses/:id/practice", async (req, res) =>
  res.json(
    practiceView(await ownedCourse(String(req.params.id), res.locals.user.id)),
  ),
);
app.post("/api/courses/:id/practice", async (req, res) => {
  const data = commandSchema.parse(req.body);
  const c = await transaction(async (session) => {
    await collection("users").updateOne(
      { _id: res.locals.user.id },
      { $inc: { planning_revision: 1 } },
      { session },
    );
    const old = await ownedCourse(
        String(req.params.id),
        res.locals.user.id,
        session,
      ),
      peers = await collection("courses")
        .find({ user_id: res.locals.user.id }, { session })
        .toArray(),
      next = practiceCommand(old, data, peers);
    await collection("courses").replaceOne({ _id: old.id }, next, { session });
    return next;
  });
  res.json(practiceView(c));
});
app.post("/api/courses/:id/practice/generate", async (req, res) => {
  const r = await enqueue(
    String(req.params.id),
    res.locals.user.id,
    generateSchema.parse(req.body),
    "practice",
  );
  res.status(202).json({ job: jobView(r.job) });
});
app.get("/api/workload", async (_req, res) => {
  const rows = await collection("courses")
    .find({
      user_id: res.locals.user.id,
      availability_scope: "shared",
      kit: { $ne: null },
    })
    .toArray();
  const budget = rows.length
    ? Math.min(
        ...rows.map(
          (c) => c.practice?.settings?.daily_minutes || c.daily_minutes,
        ),
      )
    : 0;
  const dates: Record<string, any> = {};
  for (const c of rows)
    for (const t of c.practice?.plan?.activities || [])
      if (t.date >= today()) {
        const d = (dates[t.date] ||= { date: t.date, minutes: 0, courses: {} });
        d.minutes += t.minutes;
        d.courses[c.title] = (d.courses[c.title] || 0) + t.minutes;
      }
  res.json({
    daily_minutes: budget,
    days: Object.values(dates)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((d) => ({ ...d, over_by: Math.max(0, d.minutes - budget) })),
    unplanned_courses: rows.filter((c) => !c.practice?.plan).map((c) => c.id),
  });
});
app.post("/api/workload/rebalance", async (req, res) => {
  const data = z
    .object({ course_ids: z.array(z.string()).min(1).max(100) })
    .strict()
    .parse(req.body);
  const result = await transaction(async (session) => {
    await collection("users").updateOne(
      { _id: res.locals.user.id },
      { $inc: { planning_revision: 1 } },
      { session },
    );
    const rows = await collection("courses")
      .find(
        {
          user_id: res.locals.user.id,
          availability_scope: "shared",
          kit: { $ne: null },
        },
        { session },
      )
      .toArray();
    if (
      new Set(data.course_ids).size !== data.course_ids.length ||
      data.course_ids.some((id) => !rows.some((r) => r.id === id))
    )
      throw new AppError(
        422,
        "INVALID_COURSES",
        "Choose your own shared courses, once each.",
      );
    const budget = Math.min(
      ...rows.map(
        (c) => c.practice?.settings?.daily_minutes || c.daily_minutes,
      ),
    );
    for (const c of rows) {
      c.practice ||= {};
      c.practice.plan ||= {};
      c.practice.plan.activities = (c.practice.plan.activities || []).filter(
        (a: any) => a.pinned || c.practice.completed?.[a.id],
      );
      c.practice.settings = {
        ...(c.practice.settings || { days: c.days }),
        daily_minutes: budget,
      };
    }
    const rank = (id: string) =>
      data.course_ids.includes(id)
        ? data.course_ids.indexOf(id)
        : data.course_ids.length;
    rows.sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id));
    for (const c of rows) {
      c.practice.plan = allocate(c, rows);
      c.practice_revision++;
      await collection("courses").replaceOne({ _id: c.id }, c, { session });
    }
    return { course_ids: rows.map((c) => c.id), daily_minutes: budget };
  });
  res.json(result);
});
app.use((_req, _res, next) =>
  next(new AppError(404, "NOT_FOUND", "Endpoint not found.")),
);
app.use(
  (
    error: any,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if (error instanceof ZodError) {
      res
        .status(422)
        .json({
          error: {
            code: "VALIDATION_ERROR",
            message: "Check the highlighted input values.",
            fields: error.issues.map((i) => ({
              field: i.path.join("."),
              message: i.message,
            })),
          },
        });
      return;
    }
    const e =
      error instanceof AppError
        ? error
        : error.type === "entity.too.large"
          ? new AppError(
              413,
              "BODY_TOO_LARGE",
              _req.path === "/api/documents/extract" ? "The PDF must be smaller than 5 MB." : "Request must be smaller than 2 MB.",
            )
          : error instanceof SyntaxError
            ? new AppError(
                422,
                "INVALID_JSON",
                "Request body must be valid JSON.",
              )
            : new AppError(
                500,
                "INTERNAL_ERROR",
                "Something went wrong. Please try again.",
              );
    if (!(error instanceof AppError))
      console.error("Request failed:", error.constructor?.name);
    if (e.retryAfter)
      res.setHeader("Retry-After", Math.ceil(e.retryAfter / 1000));
    res.status(e.status).json({ error: { code: e.code, message: e.message } });
  },
);
export default app;
