import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

test('live Gemini generates a persisted course visible after refresh', async ({ page }) => {
  test.skip(process.env.RUN_LIVE_GENERATION !== '1', 'Opt-in: uses real provider credits.');
  test.setTimeout(600000);
  page.setDefaultTimeout(15000);
  const registered = await page.request.post('/api/auth/register', {
    headers: { Origin: 'http://localhost:3000' },
    data: { name: 'Phase 4 live tester', email: `phase4-live-${Date.now()}@example.com`, password: `live-test-${crypto.randomUUID()}` }
  });
  expect(registered.status()).toBe(201);
  const auth = await registered.json();
  const created = await page.request.post('/api/courses/create-and-generate', {
    headers: { Origin: 'http://localhost:3000', 'X-CSRF-Token': auth.csrf_token },
    data: { title: 'Phase 4 live verification', company_name: process.env.RUN_LIVE_TAVILY === '1' ? 'Microsoft' : 'Example', company_url: process.env.RUN_LIVE_TAVILY === '1' ? 'https://careers.microsoft.com' : 'https://example.com',
      jd: 'Senior Backend Engineer. Build reliable APIs and mentor teammates. Required: Python, PostgreSQL, clear communication, and financial services domain knowledge. Preferred: Kubernetes experience.',
      days: 14, daily_minutes: 120, availability_scope: 'course' }
  });
  expect(created.status()).toBe(201);
  const course = (await created.json()).course;
  await page.goto(`/courses/${course.id}`);
  // Poll the same owner-protected API while the page's own polling updates the UI.
  let last = '';
  for (let attempt = 0; attempt < 180; attempt++) {
    const jobs = (await (await page.request.get(`/api/courses/${course.id}/jobs`)).json()).jobs;
    const job = jobs[0];
    const state = `${job.completed_steps}/${job.total_steps}: ${job.current_step} (${job.status})`;
    if (state !== last) console.log(state);
    last = state;
    if (['failed', 'blocked'].includes(job.status)) throw new Error(JSON.stringify(job.error));
    if (job.status === 'completed') break;
    await page.waitForTimeout(3000);
  }
  await expect(page.getByRole('heading', { name: 'Ready to prepare' })).toBeVisible({ timeout: 10000 });
  if (process.env.RUN_LIVE_TAVILY === '1') {
    const jobs = (await (await page.request.get(`/api/courses/${course.id}/jobs`)).json()).jobs;
    const sources = jobs[0].research.search_interviews.sources;
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.every((source: { text: string; kind: string }) => source.text.length > 0 && source.kind === 'anecdotal_search_snippet')).toBeTruthy();
    await page.locator('summary').filter({ hasText: 'Interview experiences' }).click();
    await expect(page.locator('.research-results a').filter({ hasText: new URL(sources[0].url).hostname }).first()).toBeVisible();
    await page.reload();
    const restored = (await (await page.request.get(`/api/courses/${course.id}/jobs`)).json()).jobs;
    expect(restored[0].research.search_interviews.sources).toEqual(sources);
    console.log(`Tavily: ${sources.length} sources persisted and displayed.`);
  }
  const saved = (await (await page.request.get(`/api/courses/${course.id}`)).json()).course;
  expect(saved.status).toBe('ready');
  expect(saved.kit.questions.length).toBeGreaterThan(0);
  expect(saved.kit.flashcards.length).toBeGreaterThan(0);
  expect(saved.kit.coverage.uncovered_requirement_ids).toEqual([]);
  expect(saved.kit.schedule.days).toHaveLength(14);
  expect(saved.kit.schedule.days.every((day: { minutes: number }) => day.minutes <= 120)).toBeTruthy();
  await page.getByRole('tab', { name: 'Questions', exact: true }).click();
  await page.locator('.study-question summary').first().click();
  await expect(page.getByRole('heading', { name: 'How to approach it' }).first()).toBeVisible();
  await page.getByRole('tab', { name: 'Daily plan', exact: true }).click();
  await page.getByLabel('Study day', { exact: true }).selectOption('14');
  await expect(page.getByRole('heading', { name: 'Day 14', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Ready to prepare' })).toBeVisible();
  const reloaded = (await (await page.request.get(`/api/courses/${course.id}`)).json()).course;
  expect(reloaded.kit).toEqual(saved.kit);
  const practice = await (await page.request.get(`/api/courses/${course.id}/practice`)).json();
  expect(practice.missing_lesson_ids).toEqual([]);
  expect(practice.learning.lessons).toHaveLength(saved.kit.role.requirements.length);
  expect(practice.state.plan).toBeTruthy();
  let generationRequests = 0;
  page.on('request', request => { if (request.method() === 'POST' && request.url().includes('/generate')) generationRequests++; });
  await page.goto(`/courses/${course.id}/practice`);
  await page.getByRole('tab', { name: 'Reading', exact: true }).click();
  await expect(page.getByText('All chapters saved and ready to read')).toBeVisible();
  for (const lesson of practice.learning.lessons) {
    await page.getByLabel('Choose a lesson', { exact: true }).selectOption(lesson.requirement_id);
    await expect(page.locator('.reading-lesson h2')).toHaveText(lesson.title);
  }
  await page.reload();
  await page.getByRole('tab', { name: 'Reading', exact: true }).click();
  await expect(page.getByText('All chapters saved and ready to read')).toBeVisible();
  expect(generationRequests).toBe(0);
  const restoredPractice = await (await page.request.get(`/api/courses/${course.id}/practice`)).json();
  expect(restoredPractice.learning.lessons).toEqual(practice.learning.lessons);
  await mkdir('../output', { recursive: true });
  await writeFile('../output/phase-4-live-kit.json', JSON.stringify({ course_id: course.id, kit: saved.kit }, null, 2));
  await page.screenshot({ path: 'test-results/phase-4-live-course.png', fullPage: true });
});
