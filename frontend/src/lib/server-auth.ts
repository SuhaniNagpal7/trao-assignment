import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Auth } from './api';
import { backendOrigin } from './backend';
export async function requireAuth(): Promise<Auth> {
  const token = (await cookies()).get('prep_session')?.value;
  if (!token) redirect('/login');
  let response: Response;
  try {
    response = await fetch(`${backendOrigin()}/api/auth/me`, {
      headers: { Cookie: `prep_session=${encodeURIComponent(token)}` }, cache: 'no-store'
    });
  } catch { throw new Error('The workspace service is unavailable. Please try again shortly.'); }
  if (response.status === 401) redirect('/login');
  if (!response.ok) throw new Error('Unable to load your session.');
  return response.json();
}
