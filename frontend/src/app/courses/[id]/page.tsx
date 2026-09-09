import { requireAuth } from '@/lib/server-auth';
import CourseDetail from '@/components/course-detail';
export default async function CoursePage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  const { id } = await params;
  return <CourseDetail auth={auth} id={id} />;
}
