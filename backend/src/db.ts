import {
  MongoClient,
  type Db,
  type ClientSession,
  type Document,
} from "mongodb";
import { settings } from "./config.js";
export const client = new MongoClient(settings.mongoUri, {
  serverSelectionTimeoutMS: 5000,
});
let database: Db;
export async function connect() {
  await client.connect();
  database = client.db(settings.mongoDb);
  await indexes();
  return database;
}
export function db() {
  if (!database) throw new Error("Database not connected");
  return database;
}
export const collection = (name: string) =>
  db().collection<Document & { _id: string }>(name);
async function indexes() {
  await Promise.all([
    collection("users").createIndex({ email: 1 }, { unique: true }),
    collection("sessions").createIndex(
      { expires_at: 1 },
      { expireAfterSeconds: 0 },
    ),
    collection("courses").createIndex(
      { user_id: 1, fingerprint: 1 },
      { unique: true },
    ),
    collection("jobs").createIndex(
      { course_id: 1, request_key: 1 },
      { unique: true },
    ),
    collection("jobs").createIndex(
      { active_key: 1 },
      {
        unique: true,
        partialFilterExpression: { active_key: { $type: "string" } },
      },
    ),
    collection("jobs").createIndex({
      status: 1,
      available_at: 1,
      lease_expires_at: 1,
    }),
    collection("rate_limits").createIndex(
      { expires_at: 1 },
      { expireAfterSeconds: 0 },
    ),
  ]);
}
export async function transaction<T>(
  fn: (s: ClientSession) => Promise<T>,
): Promise<T> {
  const session = client.startSession();
  try {
    return (await session.withTransaction(() => fn(session))) as T;
  } finally {
    await session.endSession();
  }
}
export const withoutId = (doc: any) => {
  if (!doc) return doc;
  const { _id, ...value } = doc;
  return value;
};
