import type { Kit } from "../src/schemas.js";
export const kit = (): Kit => ({
  source: {
    company: "Fixture",
    company_url: "https://example.com/",
    role: "Engineer",
    location: "",
    jd_chars: 40,
    researched_at: "2026-09-09T00:00:00.000Z",
    pages_used: [],
  },
  company_brief: {
    summary: "Fixture company.",
    what_they_do: "Testing.",
    sources: [],
  },
  role: {
    title: "Engineer",
    seniority: "",
    responsibilities: ["Build APIs"],
    requirements: [
      { id: "r1", text: "JavaScript", kind: "technical", priority: "must" },
      {
        id: "r2",
        text: "Communication",
        kind: "behavioural",
        priority: "must",
      },
    ],
  },
  questions: [
    {
      id: "q1",
      requirement_ids: ["r1"],
      category: "technical",
      prompt: "How do you debug an error?",
      answer_outline: "Reproduce and inspect the call stack.",
      difficulty: 3,
    },
    {
      id: "q2",
      requirement_ids: ["r2"],
      category: "behavioural",
      prompt: "How do you explain a risk?",
      answer_outline: "Describe impact and options.",
      difficulty: 2,
    },
  ],
  flashcards: [
    {
      id: "fc1",
      requirement_ids: ["r1"],
      front: "What is a traceback?",
      back: "A report of the active call stack after an exception.",
    },
  ],
  schedule: {
    days_available: 3,
    days: [1, 2, 3].map((day) => ({
      day,
      focus: "Practice",
      question_ids: ["q1", "q2"],
      minutes: 35,
    })),
  },
  coverage: { uncovered_requirement_ids: [], passes: 1 },
});
export const course = () => ({
  _id: "fixture",
  id: "fixture",
  user_id: "owner",
  title: "Fixture",
  company_name: "Fixture",
  company_url: "https://example.com/",
  jd: "JavaScript and communication required.",
  days: 3,
  daily_minutes: 120,
  availability_scope: "shared",
  revision: 1,
  status: "ready",
  kit_revision: 1,
  kit: kit(),
  kit_meta: {},
  practice_revision: 1,
  practice: {},
  learning: {},
  practice_history: [],
  interviews: [],
});
export function lessonFixture(id: string, coding = false) {
  return {
    requirement_id: id,
    title: id === "r1" ? "Debugging with tracebacks" : "Explain delivery risks",
    concepts:
      "Start from an observable failure, reproduce it, and trace the flow of data. ".repeat(
        10,
      ),
    example:
      "Given an unexpected exception, reproduce it using a small input and inspect the stack frames. ".repeat(
        3,
      ),
    mistakes: ["Changing several things at once hides the cause."],
    readiness: ["Explain the mechanism.", "Demonstrate a worked example."],
    minutes: 10,
    coding: coding
      ? {
          title: "Count repeated items",
          language: "python",
          problem:
            "Given a list of strings, return the number of occurrences of each string.",
          starter_code: "def counts(items):\n    pass",
          hints: ["Use a dictionary"],
          solution:
            "def counts(items):\n    result = {}\n    for item in items:\n        result[item] = result.get(item, 0) + 1\n    return result",
          explanation:
            "Create a dictionary, traverse the input, increment each count, then return the completed mapping.",
          complexity: "O(n) time and O(k) space.",
        }
      : null,
  };
}
