# Ahead — interview preparation workspace

Ahead turns a job description, company website, interview date and daily study allowance into an editable preparation course. Each account can prepare for several roles in parallel, track flashcard confidence, study lessons, save coding drafts and practise an interactive text interview.

## Assessment stack

| Layer | Implementation |
| --- | --- |
| Frontend | Next.js, React, TypeScript, Tailwind CSS |
| Backend | Node.js 24, Express 5, TypeScript |
| Database | MongoDB 8 replica set locally; MongoDB Atlas for hosting |
| Scraping | TypeScript, Cheerio, Undici, robots-parser |
| LLM | OpenAI Developer API, default `gpt-4.1-mini` |
| Validation | Zod schemas and deterministic reference/coverage checks |

The application no longer requires Python, FastAPI, SQLAlchemy, PostgreSQL, or Gemini. The optional one-time data importer uses Node's built-in SQLite reader to copy the former database into MongoDB; SQLite is not an application datastore.

OpenAI is enabled at the user's request using the existing server-side key. This temporarily deviates from the assessment's genuine-free-tier LLM preference. The rest of the application follows the assessment stack. Requests use the [OpenAI Responses API](https://developers.openai.com/api/reference/cli/resources/responses/methods/create), with response storage disabled and local Zod validation.

## Install and run

Use Node.js 24 and Docker Desktop (or an existing MongoDB replica set). From the repository root:

```powershell
npm.cmd run setup
Copy-Item backend/.env.example backend/.env
docker compose up -d --wait
```

Do not overwrite an existing `backend/.env`. Add `OPENAI_API_KEY` there. Keys stay on the server. The local MongoDB service is bound to loopback and uses a replica set because multi-document transactions protect shared state.

Run these in separate terminals:

```powershell
npm.cmd run backend
npm.cmd run worker
npm.cmd run dev
```

Set `frontend/.env.local` to `BACKEND_URL=http://127.0.0.1:8011`, or set that environment variable before building/starting Next.js. Open http://localhost:3000. On macOS/Linux use `npm` rather than `npm.cmd`.

For production builds:

```powershell
npm.cmd run build
node backend/dist/server.js
node backend/dist/worker.js
npm.cmd run start --workspace frontend
```

The API uses port 8011 locally; the container uses port 8000. See [deployment instructions](deployment/README.md) for HTTPS and MongoDB Atlas.

## Environment

`backend/.env.example` documents every active setting:

- `MONGODB_URI`, `MONGODB_DATABASE`: persistent MongoDB database. Transactions require a replica set or Atlas.
- `APP_ENV=production`: requires HTTPS origins and enables Secure cookies.
- `ALLOWED_ORIGINS`: comma-separated origins; the former JSON-array notation is also accepted for migration.
- `OPENAI_API_KEY`, `OPENAI_MODEL`: model credentials and selection.
- `OPENAI_RPM`, `OPENAI_TPM`: project-specific request/token budgets, defaulting conservatively to 10 RPM and 30,000 TPM. Adjust to the project's actual limits.
- `JOB_TIMEOUT_SECONDS`: per-run orchestration deadline, default 600 seconds.
- `TAVILY_API_KEY`: optional public interview search. Without it the kit records the missing evidence.
- `YOUTUBE_API_KEY`: optional verified videos and playlists. Missing keys never produce fabricated links.

Existing Gemini and SQL settings are ignored. Legacy PROVIDER_REQUESTS_PER_MINUTE and PROVIDER_TOKENS_PER_MINUTE values remain supported. Restart API and worker after changing configuration.

## PDF intake

On New course, choose Upload PDF to read a job posting (up to 5 MB). OpenAI receives the PDF directly and extracts the full posting, role title, company name and any explicitly stated website. Review the populated form, supply missing details and your preparation time, then create the course. Scanned PDFs can be read when legible; unreadable documents fail instead of producing an empty course. JSON remains an optional bulk-import format.

The extraction endpoint requires a session and CSRF token, limits file size and upload frequency, and stores extracted results with the owner's ID in MongoDB. The original PDF is sent inline to OpenAI with response storage disabled; it is not retained by this application. Course creation persists the reviewed description using the existing course flow.

## Mandatory batch command

```powershell
npm.cmd run evaluate -- --input cases.json --output kits.json
```

Input is an array of `{id, jd, company_url, days}`. Output is Appendix B exactly: `version`, `generated_at`, and `kits`; each result has `id`, `status`, `kit`, and `error`. Kit fields match Appendix A. Generated question, requirement and flashcard IDs are stable content hashes.

The evaluator uses the same TypeScript pipeline as the worker. It does not need MongoDB, a browser, or Python. It respects each supplied day count, isolates case failures, and atomically saves completed results after each case. A shared 840-second budget leaves margin for a five-case evaluation. Requests have bounded timeouts and retries; exhausted provider quotas are reported as failures, not fabricated success.

Local fixture URLs are allowed only by the development/test CLI. Use `--public-sources-only` to disable them. Web generation always blocks private/reserved networks; production cannot enable local retrieval.

Live benchmark, once the OpenAI key is configured:

```powershell
node --import tsx scripts/benchmark.ts
```

This invokes the mandatory npm command for five cases and writes `output/stack-migration-benchmark/`. It uses fictional company pages and live OpenAI. The previous 6m4s OpenAI benchmark predates this migration and is not evidence of throughput on the current Express backend.

## Pipeline and research

The pipeline deliberately separates input validation, LLM requirement extraction, company crawling, public interview search, brief generation, four question categories, coverage, two targeted repair opportunities, flashcards, arithmetic scheduling, and final validation.

Extraction includes verbatim JD evidence for each requirement; code verifies that evidence occurs in the JD. A sparse JD produces sparse requirements and warnings. Requirements are marked must/nice and technical/behavioural/domain.

The crawler reads robots.txt, follows relative links discovered on actual pages, ranks hiring/interview/handbook/about links, and retrieves at most six pages. It does not guess a fixed careers URL. DNS results are checked and the chosen address is pinned to the connection, including on redirects. Expected MIME types, byte limits, redirect limits and timeouts bound untrusted responses. Unavailable or forbidden sources are recorded and skipped. If robots policy cannot be established, the crawl is skipped conservatively. This is a text HTML crawler; JavaScript-only sites can yield limited evidence.

Company pages are factual source material. Tavily search snippets are labelled anecdotal; they never become confirmed company policy. Missing sources remain explicit in the research panel. JD, pages and candidate answers are treated as untrusted model input, never as system instructions.

Coverage is computed from requirement references. Only missing requirements are sent through repair, up to two additional passes. Uncovered must-have topics prevent generated kit publication. Thin descriptions and partial company research may still produce valid kits.

Scheduling is deterministic: a greedy set cover selects must-have questions first, harder questions are allocated earlier, and integer durations fit the daily allowance. Exactly the requested number of days is emitted, with spaced review on spare days. Insufficient capacity for required work is an explicit error.

## Progress and weak spots

The dashboard separates reviewed cards, cards marked confident, questions with submitted feedback, and completed scheduled activities. It does not combine these into an interview-readiness score. Unstarted courses and practice plans are labelled explicitly.

Practice includes a Weak spots tab with per-requirement confidence. Needs work, Developing and Confident map to 0, 50 and 100 respectively; the topic percentage averages only reviewed cards. Reviewed/total counts keep unseen work visible. Edited card content invalidates its old review. Choose Practise this topic to start a session filtered to that requirement. Confidence is self-reported, not a measured exam score.

## Persistence, concurrency and security

MongoDB collections store users, hashed sessions, courses, jobs and provider/authentication quota windows. Course documents include kits, item metadata, learning content, practice state, review/attempt history and interactive interview transcripts. Jobs contain checkpoints, ordered steps and cursor-addressable events.

Passwords use Argon2. Session cookies are HTTP-only, SameSite=Lax, Secure in production; only session token hashes are stored. State-changing requests need both an allowed Origin and the session's CSRF token. Owner filtering applies to courses, jobs and practice. MongoDB-backed login throttling works across API instances; errors never return submitted passwords or connection strings.

The API only enqueues work. A separate worker claims jobs atomically with a lease token, renews its lease and fences writes against that token. Crashed workers can be replaced without accepting stale results. Completed checkpoints survive retries. Unique partial indexes permit only one active job per course; request keys deduplicate submissions.

MongoDB transactions protect enqueue/commit and concurrent editing. Shared planning also writes the owner's planning revision to serialize competing allocations across courses. This is why a standalone MongoDB instance is insufficient.

Kit revisions reject stale browser saves. Metadata records generated/manual origin, edits, pins, per-day changes and deletion fingerprints. Regeneration merges into the latest saved kit, retaining manual/edited/pinned content, ordering and deletions. Role changes during an incompatible generation invalidate that run instead of overwriting the new context.

OpenAI calls reserve estimated input plus maximum output tokens. Worker quota windows are shared in MongoDB; the standalone evaluator uses an in-process limiter. Calls retry transient failures and malformed structured output; exhausted quotas retain checkpoints and expose retry information. Independent CLI processes do not share a quota window.

## Practice

Flashcards prioritise unseen cards, then low confidence, oldest review and stable ID. Changed card content invalidates a previous review. Course percentages reflect reviewed current flashcards, not a guaranteed interview-readiness score.

Lessons teach essential concepts, worked examples, mistakes and readiness checks. Programming topics include a problem, starter code, hints, solution, line-by-line explanation and complexity. Coding drafts are saved; code is not executed in a sandbox.

Feedback explains mistakes and correct reasoning. Live mock interview practice is interactive text: teaching mode explains answers immediately; simulation mode reserves feedback for the end. Conversations and attempts persist across refreshes. Voice/video generation remains outside the implemented feature set.

The dated practice planner includes reading, assignments, coding, flashcards, mock practice and optional resources. Shared courses use a common capacity budget; completed and manually moved activities remain fixed, and overload/backlog is visible. This planner extends rather than changes the exact Appendix A schedule.

YouTube discovery verifies public availability and duration; it considers playlists for plans of 21 days or longer. Optional resources fit after core activities and do not replace lessons.

## Verification

```powershell
docker compose up -d --wait
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
cd frontend
npx.cmd playwright test
```

Backend tests use uniquely named disposable MongoDB databases. They cover schemas, 1/14/60-day schedules, required coverage, real repair-loop execution with model fixtures, crawling, private-network rejection, provider errors, atomic jobs, stale edits, worker recovery, lessons, feedback and interview persistence.

Browser tests exercise the actual application; test-only data is seeded through a restricted local TypeScript script, never a public API endpoint. Three live-provider browser tests are opt-in via `RUN_LIVE_GENERATION`, `RUN_LIVE_REGENERATION`, and `RUN_LIVE_PRACTICE`. Hosted CI is configured but needs a repository remote.

Verified locally: 46 backend tests and 15 browser checks passed. The five-case live evaluation completed successfully in 192.602 seconds, including short and long schedules, a thin description, and an unavailable company page.

## Existing data and handoff

The one-time importer preserves IDs, password hashes, kits, edits, practice history and old job logs:

```powershell
npm.cmd run migrate:sqlite --workspace backend -- C:/absolute/path/to/development.db
```

It opens the source read-only and only inserts missing records into MongoDB. Run it while the previous app is stopped. Sign in again afterwards; sessions are deliberately not copied. Old active runs become blocked with their checkpoints preserved and require a new run because the pipeline changed.

Legacy source backups and local databases are not required to build or run the application and are excluded from this repository.

Public hosting remains pending. The walkthrough has been refreshed against the current stack and UI. Current checks passed: 46 backend tests, 15 browser checks, and five live evaluation cases in 192.602 seconds. No public deployment or assessment submission has been sent automatically.
