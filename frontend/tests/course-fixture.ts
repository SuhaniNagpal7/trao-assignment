import { expect, Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

export async function seed(page: Page) {
  const registered = await page.request.post('/api/auth/register', { headers: { Origin: 'http://localhost:3000' }, data: { name: 'Editor tester', email: `editor-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`, password: 'editor-test-password-123' } });
  expect(registered.status()).toBe(201);
  const auth = await registered.json();
  const response = await page.request.post('/api/courses', { headers: { Origin: 'http://localhost:3000', 'X-CSRF-Token': auth.csrf_token }, data: { title: 'Editor test course', company_url: 'https://example.com', jd: 'Python and communication required.', days: 3, daily_minutes: 120 } });
  const course = (await response.json()).course;
  const kit = {
    source: { company: 'Example', company_url: 'https://example.com', role: 'Engineer', location: '', jd_chars: 34, researched_at: new Date().toISOString(), pages_used: [] },
    company_brief: { summary: 'Fixture company summary.', what_they_do: 'Fixture only.', sources: [] },
    role: { title: 'Engineer', seniority: '', responsibilities: ['Build APIs'], requirements: [{ id: 'r1', text: 'Python', kind: 'technical', priority: 'must' }, { id: 'r2', text: 'Communication', kind: 'behavioural', priority: 'must' }] },
    questions: [{ id: 'q1', prompt: 'How do you debug Python?', answer_outline: 'Read the traceback and reproduce the issue.', category: 'technical', difficulty: 2, requirement_ids: ['r1'] }, { id: 'q2', prompt: 'How do you communicate a risk?', answer_outline: 'Explain the impact and options clearly.', category: 'behavioural', difficulty: 2, requirement_ids: ['r2'] }],
    flashcards: [{ id: 'fc1', front: 'What is a traceback?', back: 'A report of the active call stack after an exception.', requirement_ids: ['r1'] }],
    schedule: { days_available: 3, days: [1, 2, 3].map(day => ({ day, focus: 'Practice', question_ids: ['q1', 'q2'], minutes: 30 })) },
    coverage: { uncovered_requirement_ids: [], passes: 1 }
  };
  // Seed only this newly-created test-owned course. No production seeding endpoint.
  execFileSync(process.execPath, ['--import', 'tsx', path.resolve('../scripts/seed-browser.ts')], { cwd: path.resolve('..'), input: JSON.stringify({ id: course.id, kit }), stdio: ['pipe', 'pipe', 'pipe'] });
  return { course, auth };
}
