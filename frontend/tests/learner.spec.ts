import { test, expect } from '@playwright/test';
import { seed } from './course-fixture';

test('learner level and topic familiarity persist and adapt practice', async ({ page }) => {
  const { course } = await seed(page);
  await page.goto(`/courses/${course.id}/practice`);
  await page.getByRole('combobox', { name: 'Your current level', exact: true }).selectOption('beginner');
  await page.getByLabel('Relevant experience (years)').fill('0');
  await page.getByLabel('What would you like extra help with?').fill('Start with small examples');
  await page.getByText('How comfortable are you with each topic?', { exact: true }).click();
  await page.getByLabel('Familiarity with Python', { exact: true }).selectOption('new');
  await page.getByRole('button', { name: 'Save level and adapt plan' }).click();
  await expect(page.getByText(/Your level is saved/)).toBeVisible();
  await page.getByRole('button', { name: 'Replan unfinished work' }).click();
  await expect(page.getByRole('button', { name: 'Guided practice: How do you debug Python?', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Your current level', exact: true })).toHaveValue('beginner');
  await expect(page.getByLabel('Relevant experience (years)')).toHaveValue('0');
  await page.getByText('How comfortable are you with each topic?', { exact: true }).click();
  await expect(page.getByLabel('Familiarity with Python', { exact: true })).toHaveValue('new');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
