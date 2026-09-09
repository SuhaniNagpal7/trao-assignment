import { test, expect } from '@playwright/test';

test('saved research renders evidence and source distinctions on desktop and mobile after refresh', async ({ page }) => {
  const response = await page.request.post('/api/auth/register', {
    headers: { Origin: 'http://localhost:3000' },
    data: { name: 'Research tester', email: `research-${Date.now()}@example.com`, password: 'research-password-123' }
  });
  expect(response.status()).toBe(201);
  const auth = await response.json();
  const created = await page.request.post('/api/courses', {
    headers: { Origin: 'http://localhost:3000', 'X-CSRF-Token': auth.csrf_token },
    data: { title: 'Research preview', company_url: 'https://example.com', jd: 'React is required.', days: 14 }
  });
  const course = (await created.json()).course;
  // Provider-independent UI fixture; database persistence is covered by the API suite.
  const job = { id: 'research-fixture', status: 'blocked', course_revision: 1, completed_steps: 5, total_steps: 6,
    steps: [], created_at: '2026-09-09T00:00:00Z', available_at: '2026-09-09T00:00:00Z', can_retry: true,
    error: { code: 'PIPELINE_NOT_IMPLEMENTED', message: 'Research is saved. Course content follows in Phase 4.' },
    research: {
      extract_job: { title: null, seniority: null, responsibilities: [], warnings: [], requirements: [{ id: 'req_test', text: 'React', evidence: 'React is required.', kind: 'technical', priority: 'must' }] },
      research_company: { sources: [{ url: 'https://example.com/about', text: 'Company evidence.', kind: 'company_page', fetched_at: '2026-09-09T00:00:00Z' }], skipped: [] },
      search_interviews: { sources: [{ url: 'https://forum.example/interview', text: 'A candidate described two interviews.', kind: 'anecdotal_search_snippet', fetched_at: '2026-09-09T00:00:00Z' }], skipped: [{ reason: 'One discussion page was unavailable.' }], limitations: ['Candidate reports are anecdotal.'] }
    }
  };
  await page.route(`**/api/courses/${course.id}/jobs`, route => route.fulfill({ json: { jobs: [job] } }));
  await page.route('**/api/jobs/research-fixture?*', route => route.fulfill({ json: { job, events: [], next_cursor: 0, has_more: false } }));
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto(`/courses/${course.id}`);
    await expect(page.getByRole('heading', { name: 'Your research' })).toBeVisible();
    await expect(page.locator('.research-results blockquote').filter({ hasText: 'React is required.' })).toBeVisible();
    await page.getByText('Company sources · 1 sources', { exact: true }).click();
    await expect(page.getByRole('link', { name: 'example.com', exact: true })).toHaveAttribute('href', 'https://example.com/about');
    await page.getByText('Interview experiences · 1 sources', { exact: true }).click();
    await expect(page.getByText('Candidate reports are anecdotal.', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await page.reload();
    await expect(page.locator('.research-results blockquote').filter({ hasText: 'React is required.' })).toBeVisible();
  }
});
