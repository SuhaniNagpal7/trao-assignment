import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const entry = fileURLToPath(
  new URL("../backend/src/evaluate.ts", import.meta.url),
);
const result = spawnSync(
  process.execPath,
  ["--import", "tsx", entry, ...process.argv.slice(2)],
  { stdio: "inherit" },
);
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
