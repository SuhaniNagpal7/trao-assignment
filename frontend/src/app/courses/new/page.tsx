import { requireAuth } from '@/lib/server-auth';
import NewCourse from '@/components/new-course';

export default async function NewCoursePage() {
  return <NewCourse auth={await requireAuth()} />;
}
