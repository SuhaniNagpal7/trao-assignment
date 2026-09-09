import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
if (Number(process.versions.node.split(".")[0]) < 24)
  throw new Error("Use Node.js 24 or newer.");
const args = [
  "ci",
  "--no-audit",
  "--no-fund",
  "--cache",
  path.join(root, ".npm-cache"),
];
const result =
  process.platform === "win32"
    ? spawnSync("cmd", ["/c", "npm.cmd", ...args], {
        cwd: root,
        stdio: "inherit",
      })
    : spawnSync("npm", args, { cwd: root, stdio: "inherit" });
if (result.error || result.status !== 0) process.exit(result.status || 1);
console.log(
  "Installed locked JavaScript/TypeScript dependencies. Configure backend/.env and start MongoDB. Existing environment files were preserved.",
);
