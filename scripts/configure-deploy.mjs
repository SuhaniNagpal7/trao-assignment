import { readFileSync, writeFileSync } from "node:fs";
const domain = process.argv[2];
if (
  !domain ||
  !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(domain) ||
  !domain.includes(".")
)
  throw new Error("Usage: node scripts/configure-deploy.mjs prep.example.com");
const template = readFileSync(
  new URL("../deployment/.env.example", import.meta.url),
  "utf8",
);
writeFileSync(
  new URL("../deployment/.env", import.meta.url),
  template
    .replace("APP_DOMAIN=localhost", "APP_DOMAIN=" + domain)
    .replace(
      "mongodb://mongo:27017/?replicaSet=rs0&directConnection=true",
      "mongodb+srv://USER:PASSWORD@CLUSTER.mongodb.net/",
    ),
  { flag: "wx", mode: 0o600 },
);
console.log(
  "Created deployment/.env. Add your authenticated MongoDB Atlas URI and OpenAI key locally. The file is excluded from source control and Docker.",
);
