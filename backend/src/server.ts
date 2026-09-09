import app from "./app.js";
import { connect, client } from "./db.js";
import { settings } from "./config.js";
import { workOne } from "./worker.js";
import { sleep } from "./errors.js";
await connect();
const server = app.listen(settings.port, "0.0.0.0", () =>
  console.log(`Express API listening on port ${settings.port}`),
);
let stopping = false;
// Hosts without a separate always-on process (a single free web service, for
// example) can set RUN_WORKER=1 to drain the job queue from inside the API.
// Job leases, heartbeats and checkpoints keep this correct alongside restarts
// or a dedicated worker running the same loop.
if (process.env.RUN_WORKER === "1") {
  console.log("In-process job worker enabled.");
  void (async () => {
    while (!stopping) {
      try {
        if (!(await workOne())) await sleep(1000);
      } catch {
        console.error("Worker iteration failed; retrying.");
        await sleep(1000);
      }
    }
  })();
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    stopping = true;
    server.close(() => {
      void client.close().then(() => process.exit(0));
    });
  });
