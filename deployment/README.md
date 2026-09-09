# Deploy the assessment stack

The containers run Next.js, Express/TypeScript, a separate Node worker and Caddy HTTPS. Production uses an authenticated MongoDB replica-set connection, normally MongoDB Atlas. No Python or PostgreSQL service is deployed.

## Public deployment

1. Create a [MongoDB Atlas Free cluster](https://www.mongodb.com/docs/atlas/tutorial/deploy-free-tier-cluster/), a database user, and a network allowlist for the hosting machine. Store the authenticated connection URI in the server environment, never in client code.
2. Choose a container-capable host that supports a continuously running worker. Hosting has not been provisioned; this repository does not claim a free VM is already available.
3. Point a domain at that host. Run `node scripts/configure-deploy.mjs prep.example.com` once to create an ignored environment template, or copy `.env.example` manually.
4. In `deployment/.env`, set `APP_DOMAIN`, `MONGODB_URI`, `MONGODB_DATABASE`, `OPENAI_API_KEY`, and the project's real OpenAI quotas. The MongoDB URI in the example is only for the local smoke override.
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

Keep API and worker running as separate processes. A worker heartbeat/lease lets another worker resume saved checkpoints after a crash; transactions and lease fencing reject stale commits. Readiness is exposed at `/api/health/ready`.

Back up MongoDB using the hosting provider's supported tools or `mongodump`, keeping credentials out of command history and logs. Free-tier storage, backups and idle-cluster limits differ from paid tiers; see [Atlas Free cluster limits](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/). Keep the source SQLite backup until migration has been verified, but do not deploy it.

Secrets, databases, generated output and local caches are excluded from Docker and Git. The containers run as the unprivileged Node user. Production rejects non-HTTPS frontend origins, and cookies are Secure/HTTP-only/SameSite=Lax.

Relevant references: [Next.js standalone output](https://nextjs.org/docs/app/api-reference/config/next-config-js/output), [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https), [OpenAI Responses API](https://developers.openai.com/api/reference/cli/resources/responses/methods/create).
