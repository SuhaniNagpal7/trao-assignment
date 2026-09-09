import { test, expect } from '@playwright/test';
import { seed } from './course-fixture';

test('weak spots start a focused session and update confidence after refresh', async ({ page }) => {
  const { course } = await seed(page);
  await page.goto(`/courses/${course.id}/practice`);
  await page.getByRole('tab', { name: 'Weak spots', exact: true }).click();
  const topic = page.locator('.weak-card').filter({ has: page.getByRole('heading', { name: 'Python', exact: true }) });
  await expect(topic.getByText('Not reviewed', { exact: true })).toBeVisible();
  await topic.getByRole('button', { name: 'Practise this topic' }).click();
  await expect(page.getByRole('heading', { name: 'What is a traceback?' })).toBeVisible();
  await page.getByRole('button', { name: 'Reveal answer' }).click();
  await page.getByRole('button', { name: 'Developing', exact: true }).click();
  await expect(page.getByText(/1 reviewed/).first()).toBeVisible();
  await page.reload();
  await page.getByRole('tab', { name: 'Weak spots', exact: true }).click();
  await expect(topic.getByText('50%', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/weak-spots-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/weak-spots-mobile.png', fullPage: true });
});
