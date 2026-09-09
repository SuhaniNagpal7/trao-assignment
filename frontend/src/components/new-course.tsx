'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Auth } from '@/lib/api';
import Shell from './shell';
import CourseForm from './course-form';

export default function NewCourse({ auth }: { auth: Auth }) {
  const router = useRouter();
  return <Shell auth={auth}><div className="new-course-page">
    <Link className="back-link" href="/"><ArrowLeft size={15} /> All courses</Link>
    <CourseForm csrf={auth.csrf_token} onSaved={() => router.push('/')} />
  </div></Shell>;
}
