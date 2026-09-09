import { requireAuth } from '@/lib/server-auth';
import PracticeWorkspace from '@/components/practice-workspace';
export default async function PracticePage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  const { id } = await params;
  return <PracticeWorkspace auth={auth} id={id} />;
}
