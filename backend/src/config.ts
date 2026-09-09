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
  geminiKey: process.env.GEMINI_API_KEY || "",
  model: process.env.GEMINI_MODEL || "gemini-3.5-flash-lite",
  rpm: Number(
    process.env.GEMINI_RPM || process.env.PROVIDER_REQUESTS_PER_MINUTE || 15,
  ),
  tpm: Number(
    process.env.GEMINI_TPM || process.env.PROVIDER_TOKENS_PER_MINUTE || 250000,
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
// An ALLOWED_ORIGINS entry may contain "*" to match one URL segment, e.g.
// https://*-team.vercel.app covers every deployment and branch URL a Vercel
// project produces without listing each hash.
export function originAllowed(origin: string | null | undefined): boolean {
  if (!origin) return false;
  return settings.origins.some((pattern) => {
    if (pattern === origin) return true;
    if (!pattern.includes("*")) return false;
    const source = pattern
      .split("*")
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("[A-Za-z0-9-]+");
    return new RegExp(`^${source}$`).test(origin);
  });
}
if (
  ![settings.rpm, settings.tpm, settings.jobTimeout].every(
    (n) => Number.isFinite(n) && n > 0,
  )
)
  throw new Error("Invalid provider or timeout configuration.");
