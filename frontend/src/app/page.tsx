import { requireAuth } from '@/lib/server-auth';
import Dashboard from '@/components/dashboard';
export default async function Home() { return <Dashboard auth={await requireAuth()} />; }
