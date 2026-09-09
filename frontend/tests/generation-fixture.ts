import type { Page } from '@playwright/test';

// Keep form/polling tests independent of live provider calls.
export async function mockDraftCreation(page: Page) {
  for (const endpoint of ['create-and-generate', 'batch']) {
    await page.route(`**/api/courses/${endpoint}`, async route => {
      const { auto_generate, ...data } = route.request().postDataJSON();
      const response = await page.request.post(endpoint === 'batch' ? '/api/courses/batch' : '/api/courses', {
        headers: { Origin: 'http://localhost:3000', 'X-CSRF-Token': route.request().headers()['x-csrf-token'] }, data
      });
      await route.fulfill({ status: response.status(), json: await response.json() });
    });
  }
}

// Deterministic polling tests must never consume a developer's live API credits.
export async function mockMissingProvider(page: Page) {
  await mockDraftCreation(page);
  let job: Record<string, unknown> | null = null;
  await page.route(/\/api\/courses\/[^/]+\/generate$/, async route => {
    const url = route.request().url().replace(/\/generate$/, '');
    const course = (await (await page.request.get(url)).json()).course;
    job = { id: 'missing-provider-fixture', course_revision: course.revision, course_id: course.id, status: 'blocked', completed_steps: 2, total_steps: 17,
      steps: [], created_at: new Date().toISOString(), available_at: new Date().toISOString(), can_retry: true,
      error: { code: 'CONFIGURATION_REQUIRED', message: 'Job analysis needs a configured OpenAI provider. Ask the administrator to configure OPENAI_API_KEY, then retry this run.' } };
    await route.fulfill({ status: 202, json: { job, created: true } });
  });
  await page.route(/\/api\/courses\/[^/]+\/jobs$/, async route => {
    await route.fulfill({ json: { jobs: job ? [job] : [] } });
  });
  await page.route(/\/api\/jobs\/missing-provider-fixture\?/, async route => {
    const after = Number(new URL(route.request().url()).searchParams.get('after_event_id') || 0);
    const events = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, message: `Fixture progress event ${i + 1}`, level: 'info', created_at: new Date().toISOString() })).filter(event => event.id > after);
    await route.fulfill({ json: { job, events, next_cursor: 8, has_more: false } });
  });
}
