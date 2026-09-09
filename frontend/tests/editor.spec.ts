import { test, expect, Page } from '@playwright/test';
import { seed } from './course-fixture';

async function saved(page: Page) { await expect(page.getByText('All changes saved', { exact: true })).toBeVisible({ timeout: 10000 }); }

test('editor autosaves additions, edits, moves, pins and deletion gaps through refresh', async ({ page }) => {
  const { course } = await seed(page);
  await page.goto(`/courses/${course.id}`);
  await page.getByRole('button', { name: 'Edit course', exact: true }).click();
  await page.getByLabel('Company summary', { exact: true }).fill('My company preparation notes.');
  await saved(page);
  await page.getByRole('tab', { name: 'Questions', exact: true }).click();
  let first = page.getByRole('article', { name: 'Question 1', exact: true });
  await first.getByLabel('Answer outline', { exact: true }).fill('My debugging checklist and example.');
  await first.getByRole('button', { name: 'Pin', exact: true }).click();
  await saved(page);
  await page.getByRole('button', { name: 'Add question', exact: true }).click();
  const added = page.getByRole('article', { name: 'Question 3', exact: true });
  await added.getByLabel('Question prompt', { exact: true }).fill('My manual practice question');
  await added.getByLabel('Answer outline', { exact: true }).fill('My own answer and reasoning.');
  await added.getByLabel('Topics covered', { exact: true }).selectOption(['r1']);
  await added.getByLabel('Category', { exact: true }).selectOption('system-design');
  await saved(page);
  await added.getByRole('button', { name: 'Move up', exact: true }).click();
  await saved(page);
  await page.getByRole('article', { name: 'Question 3', exact: true }).getByRole('button', { name: 'Delete question', exact: true }).click();
  await saved(page);
  await expect(page.getByText(/Needs review: Communication/)).toBeVisible();
  await page.getByRole('tab', { name: 'Flashcards', exact: true }).click();
  await page.getByRole('button', { name: 'Add flashcard', exact: true }).click();
  const card = page.getByRole('article', { name: 'Flashcard 2', exact: true });
  await card.getByLabel('Front', { exact: true }).fill('My flashcard prompt');
  await card.getByLabel('Back', { exact: true }).fill('My clear explanation.');
  await saved(page);
  await page.reload();
  await page.getByRole('button', { name: 'Edit course', exact: true }).click();
  await expect(page.getByLabel('Company summary', { exact: true })).toHaveValue('My company preparation notes.');
  await page.getByRole('tab', { name: 'Questions', exact: true }).click();
  first = page.getByRole('article', { name: 'Question 1', exact: true });
  await expect(first.getByLabel('Answer outline', { exact: true })).toHaveValue('My debugging checklist and example.');
  await expect(first.getByRole('button', { name: 'Unpin', exact: true })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Question 2', exact: true }).getByLabel('Question prompt', { exact: true })).toHaveValue('My manual practice question');
  const result = (await (await page.request.get(`/api/courses/${course.id}`)).json()).course;
  expect(result.kit_meta.deleted['questions:q2']).toBeDefined();
  expect(result.kit_warnings.uncovered_required_ids).toEqual(['r2']);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: 'test-results/phase-5-mobile-editor.png', fullPage: true });
});

test('stale-tab conflict keeps local draft until explicit reload', async ({ page }) => {
  const { course } = await seed(page);
  const second = await page.context().newPage();
  for (const tab of [page, second]) {
    await tab.goto(`/courses/${course.id}`);
    await tab.getByRole('button', { name: 'Edit course', exact: true }).click();
  }
  await page.getByLabel('Company summary', { exact: true }).fill('Saved in first tab');
  await saved(page);
  await second.getByLabel('Company summary', { exact: true }).fill('My retained conflicting draft');
  await expect(second.getByRole('main').getByRole('alert')).toContainText('changed in another tab');
  await expect(second.getByLabel('Company summary', { exact: true })).toHaveValue('My retained conflicting draft');
  await second.getByRole('button', { name: 'Reload saved version (discard draft)', exact: true }).click();
  await expect(second.getByLabel('Company summary', { exact: true })).toHaveValue('Saved in first tab');
  await second.close();
});

test('schedule regeneration preserves edited day and unrelated content', async ({ page }) => {
  const { course } = await seed(page);
  await page.goto(`/courses/${course.id}`);
  await page.getByRole('button', { name: 'Edit course', exact: true }).click();
  await page.getByLabel('Company summary', { exact: true }).fill('My protected overview');
  await page.getByRole('tab', { name: 'Daily plan', exact: true }).click();
  await page.getByLabel('Day focus', { exact: true }).first().fill('My custom rehearsal day');
  await saved(page);
  await page.getByLabel('Section to regenerate', { exact: true }).selectOption('schedule');
  await page.getByRole('button', { name: 'Regenerate section', exact: true }).click();
  await expect(page.getByText('2 of 2 steps complete', { exact: true })).toBeVisible({ timeout: 15000 });
  await page.reload();
  await page.getByRole('button', { name: 'Edit course', exact: true }).click();
  await expect(page.getByLabel('Company summary', { exact: true })).toHaveValue('My protected overview');
  await page.getByRole('tab', { name: 'Daily plan', exact: true }).click();
  await expect(page.getByLabel('Day focus', { exact: true }).first()).toHaveValue('My custom rehearsal day');
  const result = (await (await page.request.get(`/api/courses/${course.id}`)).json()).course;
  expect(result.kit.schedule.days[1].focus).toContain('Spaced review');
});

test('live category regeneration preserves edits made during the provider request', async ({ page }) => {
  test.skip(process.env.RUN_LIVE_REGENERATION !== '1', 'Opt-in: uses OpenAI credits.');
  test.setTimeout(180000);
  const { course, auth } = await seed(page);
  let current = (await (await page.request.get(`/api/courses/${course.id}`)).json()).course;
  const headers = { Origin: 'http://localhost:3000', 'X-CSRF-Token': auth.csrf_token };
  const run = await page.request.post(`/api/courses/${course.id}/regenerate`, { headers, data: { revision: current.kit_revision, section: 'questions_technical', request_key: crypto.randomUUID() } });
  expect(run.status()).toBe(202);
  const job = (await run.json()).job;
  current.kit.questions[0].answer_outline = 'Written while OpenAI was generating replacement questions.';
  current.kit.questions.push({ ...current.kit.questions[0], id: 'manual-live', prompt: 'My original manual question' });
  const edit = await page.request.put(`/api/courses/${course.id}/kit`, { headers, data: { revision: current.kit_revision, kit: current.kit, pins: ['questions:q1'] } });
  expect(edit.status()).toBe(200);
  await expect.poll(async () => (await (await page.request.get(`/api/jobs/${job.id}`)).json()).job.status, { timeout: 150000, intervals: [1500] }).toBe('completed');
  current = (await (await page.request.get(`/api/courses/${course.id}`)).json()).course;
  expect(current.kit.questions.find((q: { id: string }) => q.id === 'q1').answer_outline).toBe('Written while OpenAI was generating replacement questions.');
  expect(current.kit.questions.some((q: { id: string }) => q.id === 'manual-live')).toBeTruthy();
  expect(current.kit.questions.length).toBeGreaterThanOrEqual(3);
  await page.goto(`/courses/${course.id}`);
  await expect(page.getByRole('heading', { name: 'Ready to prepare' })).toBeVisible();
});
