export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public retryAfter = 0,
  ) {
    super(message);
  }
}
export const conflict = (
  message = "This course changed in another tab. Reload before saving.",
) => new AppError(409, "REVISION_CONFLICT", message);
export function deadlineCheck(deadline: number) {
  if (Date.now() >= deadline)
    throw new AppError(
      408,
      "TIME_BUDGET_EXCEEDED",
      "Generation reached its time budget. Saved steps can be resumed.",
    );
}
export const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));
