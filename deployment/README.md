# Deploy the assessment stack

Two supported topologies:

- **Free hosting** — Render (backend) + Vercel (frontend) + MongoDB Atlas M0. The
  API and job worker run in one process. Described first, below.
- **Containers** — Next.js, Express/TypeScript, a separate Node worker and Caddy
  HTTPS via `docker compose`. Described under "Container deployment".

Both use an authenticated MongoDB replica-set connection (Atlas). No Python or
PostgreSQL service is deployed.

## Free hosting: Render + Vercel + Atlas

Everything here is on a genuine free tier.

### 1. Database — MongoDB Atlas M0

Create a [free M0 cluster](https://www.mongodb.com/docs/atlas/tutorial/deploy-free-tier-cluster/),
a database user, and a network access entry of `0.0.0.0/0` (Render's outbound IPs
are not fixed on the free plan). Copy the `mongodb+srv://…` connection string. M0
is a three-node replica set, so the multi-document transactions this app needs
work.

### 2. Backend — Render web service

The repo has a `render.yaml` blueprint (native Node runtime, no Docker). In the
Render dashboard choose **New → Blueprint** and point it at the repository, or
create a web service manually with:

- Runtime **Node**, plan **Free**, region **Oregon**, branch `main`
- Build command: `npm ci --include=dev --workspace backend --include-workspace-root && npm run build --workspace backend`
- Start command: `node backend/dist/server.js`
- Health check path: `/api/health`

Set these environment variables (the blueprint marks them `sync: false`):

| Variable | Value |
| --- | --- |
| `MONGODB_URI` | the Atlas `mongodb+srv://…` string |
| `ALLOWED_ORIGINS` | `https://<your-vercel-domain>` (comma-separated if several) |
| `GEMINI_API_KEY` | free key from [Google AI Studio](https://aistudio.google.com/apikey) |
| `TAVILY_API_KEY` | optional — enables public interview search |
| `YOUTUBE_API_KEY` | optional — enables verified video resources |

`NODE_VERSION=22`, `APP_ENV=production`, `RUN_WORKER=1`, `MONGODB_DATABASE=ahead`
and the `GEMINI_MODEL`/`GEMINI_RPM`/`GEMINI_TPM` defaults come from the blueprint.
Render injects `PORT` and the server binds it automatically.

The `backend/Dockerfile` still exists for the container topology below; the free
Render path does not use it.

`RUN_WORKER=1` makes `server.js` run the job-drain loop in-process, so a single
free service covers both the API and generation. The lease/heartbeat/checkpoint
logic still applies, so this is safe across restarts.

**Free-plan behaviour to expect:** the service sleeps after 15 minutes with no
inbound request and cold-starts (~30–60s) on the next one. A generation job that
was mid-run resumes from its last checkpoint when the service wakes. To keep it
warm and draining the queue continuously, add a free external ping (for example
[cron-job.org](https://cron-job.org) or a scheduled GitHub Actions workflow)
hitting `https://<service>.onrender.com/api/health` every 10 minutes.

### 3. Frontend — Vercel

Import the repo in Vercel with **Root Directory** `frontend`. Set one
environment variable:

| Variable | Value |
| --- | --- |
| `BACKEND_URL` | `https://<your-render-service>.onrender.com` |

Deploy, then copy the resulting `https://<project>.vercel.app` URL back into the
Render service's `ALLOWED_ORIGINS` and redeploy the backend so CORS and CSRF
origin checks accept it.

### 4. Verify

On the public Vercel URL: register/login, create a course, run generation with
visible progress, edit and regenerate a section without losing edits, practise,
refresh, and log out. Confirm anonymous and cross-account requests are rejected.
Trigger a Render redeploy and confirm persisted courses and in-flight jobs
survive.

## Container deployment

1. Create a [MongoDB Atlas Free cluster](https://www.mongodb.com/docs/atlas/tutorial/deploy-free-tier-cluster/), a database user, and a network allowlist for the hosting machine. Store the authenticated connection URI in the server environment, never in client code.
2. Choose a container-capable host that supports a continuously running worker. Hosting has not been provisioned; this repository does not claim a free VM is already available.
3. Point a domain at that host. Run `node scripts/configure-deploy.mjs prep.example.com` once to create an ignored environment template, or copy `.env.example` manually.
4. In `deployment/.env`, set `APP_DOMAIN`, `MONGODB_URI`, `MONGODB_DATABASE`, `GEMINI_API_KEY`, and the project's real Gemini free-tier quotas. The MongoDB URI in the example is only for the local smoke override.
5. From the repository root run:

```sh
docker compose --env-file deployment/.env -f deployment/compose.yaml up -d --build --wait
```

Only Caddy publishes ports 80/443. API and worker share MongoDB and provider quotas. On startup the API creates required indexes before becoming ready. Caddy obtains a public certificate only when DNS and inbound connections are configured correctly.

Verify registration/login, creation, generation, edit/regeneration preservation, practice, refresh and logout on the public URL with normal certificate verification. Restart services and confirm persisted courses and jobs. Check that anonymous and cross-account requests are rejected. A hosted CI run and public deployment check are still pending a destination account.

## Local production smoke test

This creates a separate disposable MongoDB replica set with no published database port. It does not touch the development database:

```sh
docker compose --env-file deployment/.env.example -f deployment/compose.yaml -f deployment/compose.smoke.yaml -p ahead-ts-smoke up -d --build --wait
cd frontend
npx playwright test --config playwright.production.config.ts
```

The smoke test uses HTTPS on localhost:3443 and ignores only the locally generated certificate's trust error. It checks secure cookies, CSRF rejection, ownership, useful missing-key failure, saved checkpoints, and sign-in persistence. Do not interpret that as public certificate verification.

From the root, stop and remove only those disposable test resources:

```sh
docker compose --env-file deployment/.env.example -f deployment/compose.yaml -f deployment/compose.smoke.yaml -p ahead-ts-smoke down --volumes
```

## Operations

The container topology keeps API and worker as separate processes; the Render
topology runs both in one process via `RUN_WORKER=1`. Either way a worker
heartbeat/lease lets another worker resume saved checkpoints after a crash, and
transactions and lease fencing reject stale commits. Liveness is `/api/health`;
readiness (includes a MongoDB ping) is `/api/health/ready`.

Back up MongoDB using the hosting provider's supported tools or `mongodump`, keeping credentials out of command history and logs. Free-tier storage, backups and idle-cluster limits differ from paid tiers; see [Atlas Free cluster limits](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/). Keep the source SQLite backup until migration has been verified, but do not deploy it.

Secrets, databases, generated output and local caches are excluded from Docker and Git. The containers run as the unprivileged Node user. Production rejects non-HTTPS frontend origins, and cookies are Secure/HTTP-only/SameSite=Lax.

Relevant references: [Next.js standalone output](https://nextjs.org/docs/app/api-reference/config/next-config-js/output), [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https), [Gemini API free tier](https://ai.google.dev/gemini-api/docs/rate-limits).
