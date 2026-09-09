import app from "./app.js";
import { connect, client } from "./db.js";
import { settings } from "./config.js";
await connect();
const server = app.listen(settings.port, "0.0.0.0", () =>
  console.log(`Express API listening on port ${settings.port}`),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () =>
    server.close(() => {
      void client.close().then(() => process.exit(0));
    }),
  );
