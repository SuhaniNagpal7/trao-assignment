import { test, expect, Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { seed } from './course-fixture';

async function learning(page: Page) {
  const value = await seed(page);
  execFileSync(process.execPath, ['--import', 'tsx', path.resolve('../scripts/seed-browser.ts')], { cwd: path.resolve('..'), input: JSON.stringify({ id: value.course.id, learning: true }), stdio: ['pipe', 'pipe', 'pipe'] });
  return value;
}

test('practice resumes flashcards, saves confidence, reading and coding drafts', async ({ page }) => {
  const { course } = await learning(page);
  await page.goto(`/courses/${course.id}`);
  await page.getByRole('link', { name: 'Start practicing', exact: true }).click();
  await page.getByRole('tab', { name: 'Flashcards', exact: true }).click();
  await page.getByRole('button', { name: 'Start review session' }).click();
  await expect(page.getByRole('heading', { name: 'What is a traceback?' })).toBeVisible();
  await page.reload();
  await page.getByRole('tab', { name: 'Flashcards', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'What is a traceback?' })).toBeVisible();
  await page.getByRole('button', { name: 'Reveal answer' }).click();
  await expect(page.getByText('A report of the active call stack after an exception.')).toBeVisible();
  await page.getByRole('button', { name: 'Needs work', exact: true }).click();
  await expect(page.getByText('1 reviewed · 0 unseen', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Reading', exact: true }).click();
  await page.getByRole('button', { name: 'Mark reading complete' }).click();
  await expect(page.getByRole('button', { name: 'Reading completed' })).toBeDisabled();
  await page.getByRole('button', { name: 'Try the coding exercise' }).click();
  await page.getByRole('textbox', { name: 'Your code', exact: true }).fill('def counts(items):\n    return {} # my saved draft');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByText(/Draft ready/)).toBeVisible();
  await page.getByText('Reveal the solution', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Line-by-line explanation' })).toBeVisible();
  await page.reload();
  await page.getByRole('tab', { name: 'Assignments', exact: true }).click();
  await page.getByLabel('Choose an exercise').selectOption('code:r1');
  await expect(page.getByLabel('Your code', { exact: true })).toHaveValue('def counts(items):\n    return {} # my saved draft');
  await page.getByLabel('Your code', { exact: true }).fill('unsaved text kept when switching tabs');
  await page.getByRole('tab', { name: 'Reading', exact: true }).click();
  await page.getByRole('tab', { name: 'Assignments', exact: true }).click();
  await expect(page.getByLabel('Your code', { exact: true })).toHaveValue('unsaved text kept when switching tabs');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/phase-6-mobile-practice.png', fullPage: true });
});

test('practice plan persists completion and shows insufficient capacity', async ({ page }) => {
  const { course } = await learning(page);
  await page.goto(`/courses/${course.id}/practice`);
  await page.getByLabel('Days remaining').fill('1');
  await page.getByLabel('Minutes per day').fill('15');
  await page.getByRole('button', { name: 'Replan unfinished work' }).click();
  await expect(page.getByText(/Required work needs/)).toBeVisible();
  const remaining = await page.getByRole('button', { name: 'Mark done', exact: true }).count() - 1;
  await page.getByRole('button', { name: 'Mark done', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Mark done', exact: true })).toHaveCount(remaining);
  await page.reload();
  await expect(page.getByText(/Required work needs/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mark done', exact: true })).toHaveCount(remaining);
});

test('practice rejects stale tab reviews and recovers with explicit reload', async ({ page }) => {
  const { course } = await learning(page);
  const second = await page.context().newPage();
  await page.goto(`/courses/${course.id}/practice`);
  await second.goto(`/courses/${course.id}/practice`);
  await page.getByRole('tab', { name: 'Flashcards', exact: true }).click();
  await second.getByRole('tab', { name: 'Flashcards', exact: true }).click();
  await page.getByRole('button', { name: 'Start review session' }).click();
  await second.getByRole('button', { name: 'Start review session' }).click();
  await expect(second.getByRole('main').getByRole('alert')).toContainText('Practice changed in another tab');
  await second.getByRole('button', { name: 'Reload saved practice' }).click();
  await expect(second.getByRole('button', { name: 'Reveal answer' })).toBeVisible();
  await second.close();
});

test('live Gemini lessons, answer feedback and interactive interview persist', async ({ page }) => {
  test.skip(process.env.RUN_LIVE_PRACTICE !== '1', 'Opt-in live provider test');
  test.setTimeout(300000);
  const { course } = await seed(page);
  await page.goto(`/courses/${course.id}/practice`);
  await page.getByRole('button', { name: 'Generate reading materials', exact: true }).click();
  async function idle() {
    await expect.poll(async () => {
      const { jobs } = await (await page.request.get(`/api/courses/${course.id}/jobs`)).json();
      if (jobs[0]?.status === 'failed' || jobs[0]?.status === 'blocked') throw new Error(jobs[0].error?.message);
      return jobs[0]?.status;
    }, { timeout: 180000, intervals: [1500, 2500] }).toBe('completed');
    await expect(page.getByText(/Preparing ·/)).toHaveCount(0, { timeout: 10000 });
  }
  await idle();
  await page.getByRole('tab', { name: 'Reading', exact: true }).click();
  await expect(page.getByLabel('Choose a lesson')).toBeVisible();
  let state = await (await page.request.get(`/api/courses/${course.id}/practice`)).json();
  expect(state.learning.lessons).toHaveLength(2);
  expect(state.missing_lesson_ids).toEqual([]);
  expect(state.learning.lessons.some((l: { coding: unknown }) => !!l.coding)).toBeTruthy();
  await page.getByRole('tab', { name: 'Assignments', exact: true }).click();
  await page.getByLabel('Your answer', { exact: true }).fill('I ignore every exception and hope the error goes away.');
  await page.getByRole('button', { name: 'Get feedback' }).click();
  await idle();
  await expect(page.getByRole('heading', { name: 'A better approach' })).toBeVisible();
  await page.getByRole('tab', { name: 'Interview', exact: true }).click();
  await page.getByRole('button', { name: 'Start live interview' }).click();
  await idle();
  await expect(page.getByLabel('Interview conversation')).toContainText('INTERVIEWER');
  await page.getByLabel('Your reply', { exact: true }).fill('I reproduce the error, inspect the traceback, and compare expected versus actual input. How do I narrow down a failure that only happens sometimes?');
  await page.getByRole('button', { name: 'Send reply', exact: true }).click();
  await idle();
  await expect(page.getByLabel('Interview conversation').getByText('INTERVIEWER', { exact: true })).toHaveCount(2);
  await page.reload();
  await page.getByRole('tab', { name: 'Interview', exact: true }).click();
  await expect(page.getByLabel('Interview conversation')).toContainText('only happens sometimes');
  await page.getByRole('button', { name: 'Finish and get feedback' }).click();
  await idle();
  await expect(page.getByText('Session complete. Your conversation and revision tasks are saved.')).toBeVisible();
  state = await (await page.request.get(`/api/courses/${course.id}/practice`)).json();
  expect(state.interviews[0].status).toBe('completed');
  expect(state.interviews[0].feedback.revision_tasks.length).toBeGreaterThan(0);
});
