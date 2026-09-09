export type LearnerProfile = { level: "not_sure" | "beginner" | "intermediate" | "advanced"; experience_years: number | null; focus: string; topics: Record<string, "new" | "some" | "comfortable"> };
export const defaultLearnerProfile: LearnerProfile = { level: "not_sure", experience_years: null, focus: "", topics: {} };
export type User = { id: string; name: string; email: string };
export type CourseInput = { learner_profile?: LearnerProfile; title: string; company_name: string; company_url: string; jd: string; days: number; daily_minutes: number; availability_scope: 'shared' | 'course' };
export type Progress = { reviewed: number; total: number; coverage: number; confident: number; questions_attempted: number; questions_total: number; activities_completed: number; activities_total: number };
export type Course = CourseInput & { id: string; status: string; revision: number; created_at: string; updated_at: string; practice_progress: number | null; practice_summary: Progress | null; kit_revision: number; kit_meta: { items: Record<string, { origin: string; edited: boolean; pinned: boolean; revision: number }>; sections: Record<string, { edited?: boolean; pinned?: boolean }>; deleted: Record<string, string[]> }; kit_warnings: { uncovered_required_ids?: string[]; unscheduled_required_ids?: string[] }; kit: import('@/components/kit-results').Kit | null };
export type Auth = { user: User; csrf_token: string };
export class ApiError extends Error {
  constructor(public status: number, message: string, public fields: { field: string; message: string }[] = []) { super(message); }
}
export async function api<T>(path: string, options: RequestInit = {}, csrf?: string): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options, credentials: 'same-origin', cache: 'no-store',
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(csrf ? { 'X-CSRF-Token': csrf } : {}), ...options.headers }
  });
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/auth/')) window.location.assign('/login');
    throw new ApiError(response.status, data?.error?.message || 'Unable to connect. Please try again.', data?.error?.fields || []);
  }
  return data as T;
}
