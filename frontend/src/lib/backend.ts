// Single source of truth for the backend origin the frontend proxies to.
// Accepts BACKEND_URL with or without a scheme (a bare host like
// "api.example.com" is treated as https) and falls back to local dev.
export function backendOrigin(): string {
  const raw = process.env.BACKEND_URL?.trim() || 'http://127.0.0.1:8011';
  return /^https?:\/\//i.test(raw) ? raw.replace(/\/$/, '') : `https://${raw.replace(/\/$/, '')}`;
}
