import { connect, client, collection } from "../backend/src/db.js";
import { validateKit } from "../backend/src/schemas.js";
import { lessonFixture } from "../backend/tests-ts/fixture.js";
let raw = "";
for await (const chunk of process.stdin) raw += chunk;
const data = JSON.parse(raw);
await connect();
try {
  const c = await collection("courses").findOne({ _id: data.id });
  const user = c && (await collection("users").findOne({ _id: c.user_id }));
  if (
    !c ||
    c.title !== "Editor test course" ||
    !user?.email.startsWith("editor-")
  )
    throw new Error("Only newly created browser-test courses may be seeded.");
  const values = data.learning
    ? {
        learning: {
          lessons: [lessonFixture("r1", true), lessonFixture("r2")],
          role: c.kit.role,
        },
      }
    : { kit: validateKit(data.kit), kit_revision: 1, status: "ready" };
  await collection("courses").updateOne({ _id: c.id }, { $set: values });
} finally {
  await client.close();
}
