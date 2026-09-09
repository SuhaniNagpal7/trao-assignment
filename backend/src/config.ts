import { config } from "dotenv";
import { fileURLToPath } from "node:url";
config({
  path: fileURLToPath(new URL("../.env", import.meta.url)),
  quiet: true,
});
const origins = process.env.ALLOWED_ORIGINS || "http://localhost:3000";
export const settings = {
  production: process.env.APP_ENV === "production",
  port: Number(process.env.PORT || 8011),
  mongoUri:
    process.env.MONGODB_URI ||
    "mongodb://127.0.0.1:27017/?replicaSet=rs0&directConnection=true",
  mongoDb: process.env.MONGODB_DATABASE || "ahead",
  origins: (origins.startsWith("[")
    ? JSON.parse(origins)
    : origins.split(",").map((s) => s.trim())) as string[],
  openaiKey: process.env.OPENAI_API_KEY || "",
  model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
  rpm: Number(
    process.env.OPENAI_RPM || process.env.PROVIDER_REQUESTS_PER_MINUTE || 10,
  ),
  tpm: Number(
    process.env.OPENAI_TPM || process.env.PROVIDER_TOKENS_PER_MINUTE || 30000,
  ),
  tavilyKey: process.env.TAVILY_API_KEY || "",
  youtubeKey: process.env.YOUTUBE_API_KEY || "",
  jobTimeout: Number(process.env.JOB_TIMEOUT_SECONDS || 600),
  sessionDays: 7,
};
if (
  settings.production &&
  settings.origins.some((o) => !o.startsWith("https://"))
)
  throw new Error("Production requires HTTPS origins.");
if (
  ![settings.rpm, settings.tpm, settings.jobTimeout].every(
    (n) => Number.isFinite(n) && n > 0,
  )
)
  throw new Error("Invalid provider or timeout configuration.");
