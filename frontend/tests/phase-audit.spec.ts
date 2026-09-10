import { test, expect, Page } from '@playwright/test';
import { mockMissingProvider } from './generation-fixture';

async function register(page: Page) {
  const response = await page.request.post('/api/auth/register', {
    headers: { Origin: 'http://localhost:3000' },
    data: { name: 'Audit user', email: `audit-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`, password: 'audit-password-123' }
  });
  expect(response.status()).toBe(201);
  return response.json();
}

async function createCourse(page: Page, csrf: string, title = 'Audit interview') {
  const response = await page.request.post('/api/courses', {
    headers: { Origin: 'http://localhost:3000', 'X-CSRF-Token': csrf },
    data: { title, company_name: 'Example', company_url: 'https://example.com', jd: 'Required: React and TypeScript.', days: 14, daily_minutes: 120, availability_scope: 'shared' }
  });
  expect(response.status()).toBe(201);
  return (await response.json()).course;
}

test('login, registration and error states fit desktop, mobile and landscape; keyboard works', async ({ page }) => {
  await page.route('**/api/auth/login', route => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Email or password is incorrect.' } }) }));
  await page.route('**/api/auth/register', route => route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Unable to register with this email. Try signing in.' } }) }));
  for (const [width, height] of [[1440,900],[1366,768],[1280,720],[390,844],[375,667],[320,568],[844,390],[667,375]]) {
    await page.setViewportSize({ width, height });
    await page.goto('/login');
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Email address')).toBeFocused();
    for (const state of ['login', 'register']) {
      if (state === 'register') {
        await page.getByRole('button', { name: 'Create an account', exact: true }).click();
        await page.getByLabel('Full name').fill('Audit');
      }
      await page.getByLabel('Email address').fill('audit@example.com');
      await page.getByLabel('Password', { exact: true }).fill('audit-password-123');
      await page.getByRole('button', { name: state === 'login' ? 'Sign in' : 'Create account', exact: true }).click();
      await expect(page.getByRole('main').getByRole('alert')).toBeVisible();
      const fit = await page.evaluate(() => ({
        scroll: document.documentElement.scrollHeight > innerHeight || document.documentElement.scrollWidth > innerWidth,
        clipped: [...document.querySelectorAll('.auth-form input,.auth-form button,.auth-form [role="alert"]')].some(element => { const r = element.getBoundingClientRect(); return r.top < 0 || r.bottom > innerHeight || r.left < 0 || r.right > innerWidth; })
      }));
      expect(fit, `${width}x${height} ${state}`).toEqual({ scroll: false, clipped: false });
    }
  }
});

test('invalid imports show useful errors without saving partial courses', async ({ page }) => {
  await register(page);
  await page.goto('/courses/new');
  await page.getByRole('button', { name: 'Import multiple' }).click();
  const upload = page.getByLabel('Batch JSON file');
  await upload.setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{bad json') });
  await page.getByRole('button', { name: 'Import and generate courses' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('not valid JSON');
  await upload.setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify([{ id: 'good', jd: 'Python', company_url: 'https://example.com', days: 1 }, { id: 'bad', jd: 'SQL', company_url: 'https://example.org', days: 0 }])) });
  await page.getByRole('button', { name: 'Import and generate courses' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('cases.1.days');
  const courses = await page.request.get('/api/courses');
  expect((await courses.json()).courses).toEqual([]);
});

test('two tabs cannot silently overwrite each other and course search works', async ({ page, context }) => {
  const auth = await register(page);
  const course = await createCourse(page, auth.csrf_token);
  const second = await context.newPage();
  await page.goto(`/courses/${course.id}`);
  await second.goto(`/courses/${course.id}`);
  await expect(second.getByLabel('Course name')).toHaveValue('Audit interview');
  await page.getByLabel('Course name').fill('Saved in the first tab');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Changes saved.', { exact: true })).toBeVisible();
  await second.getByLabel('Course name').fill('Unsaved second tab');
  await second.getByRole('button', { name: 'Save changes' }).click();
  await expect(second.getByRole('main').getByRole('alert')).toContainText('another tab');
  await expect(second.getByLabel('Course name')).toHaveValue('Unsaved second tab');
  await page.goto('/');
  await page.getByRole('searchbox', { name: 'Search courses' }).fill('no matching role');
  await expect(page.getByRole('heading', { name: 'No matching courses.' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear search' }).click();
  await expect(page.getByRole('heading', { name: 'Saved in the first tab' })).toBeVisible();
  await second.close();
});

test('polling reconnects and restores saved logs after refresh', async ({ page }) => {
  const auth = await register(page);
  const course = await createCourse(page, auth.csrf_token);
  await mockMissingProvider(page);
  let interrupted = 0;
  await page.route(/\/api\/jobs\/[^/?]+\?/, async route => {
    if (++interrupted <= 2) await route.abort('failed');
    else await route.fallback();
  });
  await page.goto(`/courses/${course.id}`);
  await page.getByRole('button', { name: 'Start generation', exact: true }).click();
  await expect(page.getByText(/Connection interrupted/)).toBeVisible();
  await expect(page.getByText('2 of 17 steps complete', { exact: true })).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: /Activity log/ }).click();
  await expect(page.locator('.generation-logs li')).toHaveCount(8, { timeout: 20000 });
  await page.reload();
  await page.getByRole('button', { name: /Activity log/ }).click();
  await expect(page.locator('.generation-logs li')).toHaveCount(8);
  await expect(page.getByText(/Connection interrupted/)).toHaveCount(0);
  expect(interrupted).toBeGreaterThanOrEqual(4);
});

test('unauthorised course pages remain hidden and sign-out protects navigation', async ({ page, browser }) => {
  const first = await register(page);
  const course = await createCourse(page, first.csrf_token);
  const otherContext = await browser.newContext({ baseURL: 'http://localhost:3000' });
  const other = await otherContext.newPage();
  await register(other);
  await other.goto(`/courses/${course.id}`);
  await expect(other.getByRole('main').getByRole('alert')).toContainText('Course not found');
  await other.goto('/');
  await expect(other.getByRole('heading', { name: 'A place for your next interview.' })).toBeVisible();
  await other.getByRole('button', { name: 'Sign out' }).click();
  await expect(other).toHaveURL(/\/login$/);
  await other.goto(`/courses/${course.id}`);
  await expect(other).toHaveURL(/\/login$/);
  await otherContext.close();
});
