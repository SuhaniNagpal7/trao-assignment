import { test, expect } from '@playwright/test';

test('PDF upload extracts editable fields and saves the reviewed course', async ({ page, browser }) => {
  test.setTimeout(150000);
  const response = await page.request.post('/api/auth/register', { headers: { Origin: 'http://localhost:3000' }, data: { name: 'PDF tester', email: `pdf-${Date.now()}@example.com`, password: 'pdf-test-password-123' } });
  expect(response.status()).toBe(201);
  const document = await browser.newPage();
  await document.setContent('<h1>Frontend Engineer</h1><p>Company: Example</p><p>Company website: https://example.com</p><h2>Requirements</h2><p>JavaScript, React, TypeScript and accessible interfaces.</p><div style="break-before:page"><h2>Responsibilities</h2><p>Build dashboards and collaborate with designers.</p></div>');
  const pdf = await document.pdf(); await document.close();
  if (process.env.RUN_LIVE_PDF !== '1') {
    await page.route('**/api/documents/extract', async route => {
      expect(route.request().headers()['content-type']).toContain('application/pdf');
      expect(route.request().postDataBuffer()?.subarray(0, 5).toString()).toBe('%PDF-');
      await route.fulfill({ json: { extracted: { title: 'Frontend Engineer', company_name: 'Example', company_url: 'https://example.com', jd: 'Requirements: JavaScript, React, TypeScript and accessible interfaces. Responsibilities: Build dashboards and collaborate with designers.', warnings: [] } } });
    });
  }
  await page.goto('/courses/new');
  await page.getByRole('button', { name: 'Upload PDF', exact: true }).click();
  await page.getByLabel('Job description PDF').setInputFiles({ name: 'job.pdf', mimeType: 'application/pdf', buffer: pdf });
  await expect(page.getByText(/PDF extracted/)).toBeVisible({ timeout: 125000 });
  await expect(page.getByLabel('Course name')).toHaveValue(/Frontend Engineer/i);
  await expect(page.getByRole('textbox', { name: /^Job description/ })).toHaveValue(/collaborate with designers/i);
  await expect(page.getByRole('textbox', { name: 'Company website', exact: true })).toHaveValue(/example.com/);
  await page.getByLabel('Course name').fill('Reviewed PDF course');
  await page.getByRole('button', { name: 'Create course', exact: true }).click();
  await page.getByRole('link').filter({ has: page.getByRole('heading', { name: 'Reviewed PDF course' }) }).click();
  await expect(page).toHaveURL(/\/courses\/[0-9a-f-]+$/);
  await expect(page.getByLabel('Course name')).toHaveValue('Reviewed PDF course');
  await page.reload();
  await expect(page.getByRole('textbox', { name: /^Job description/ })).toHaveValue(/collaborate with designers/i);
});
