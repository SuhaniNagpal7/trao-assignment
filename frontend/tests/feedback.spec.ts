import { test, expect } from '@playwright/test';
import { seed } from './course-fixture';

test('live feedback supports repeated submissions and reload without crashing', async ({ page }) => {
  test.skip(process.env.RUN_LIVE_FEEDBACK !== '1', 'Opt-in: real Gemini calls.');
  test.setTimeout(240000);
  const { course } = await seed(page);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`/courses/${course.id}/practice`);
  await page.getByRole('tab', { name: 'Assignments', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Get feedback', exact: true })).toBeDisabled();
  for (const answer of ['I ignore the exception.', 'I reproduce the issue, read the traceback and test a minimal fix.']) {
    await page.getByLabel('Your answer', { exact: true }).fill(answer);
    await page.getByRole('button', { name: 'Get feedback', exact: true }).click();
    await expect.poll(async () => {
      const state = await (await page.request.get(`/api/courses/${course.id}/practice`)).json();
      return state.state.feedback?.['answer:q1']?.answer;
    }, { timeout: 100000, intervals: [1500] }).toBe(answer);
    await expect(page.locator('.exercise-feedback').getByRole('heading', { name: 'A better approach' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: 'Get feedback', exact: true })).toBeEnabled();
  }
  await page.reload();
  await page.getByRole('tab', { name: 'Assignments', exact: true }).click();
  await expect(page.locator('.exercise-feedback').getByRole('heading', { name: 'A better approach' })).toBeVisible();
  const state = await (await page.request.get(`/api/courses/${course.id}/practice`)).json();
  expect(state.history.filter((entry: { kind: string }) => entry.kind === 'feedback')).toHaveLength(2);
  expect(errors).toEqual([]);
});
