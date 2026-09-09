'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { api, Auth, Course } from '@/lib/api';
import Shell from './shell';
import CourseForm from './course-form';
import GenerationPanel from './generation-panel';
import KitBuilder from './kit-builder';
export default function CourseDetail({ auth, id }: { auth: Auth; id: string }) {
  const [course, setCourse] = useState<Course | null>(null);
  const [error, setError] = useState('');
  const [generationVersion, setGenerationVersion] = useState(0);
  const load = useCallback(async () => {
    setError('');
    try { setCourse((await api<{ course: Course }>(`/courses/${id}`)).course); }
    catch (e) { setError((e as Error).message); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  return <Shell auth={auth}><Link className="back-link" href="/"><ArrowLeft size={15} /> All courses</Link>
    {error ? <div className="panel empty-state"><h2>We couldn’t open this course.</h2><p role="alert">{error}</p><button className="secondary" onClick={load}>Try again</button></div> : !course ? <p role="status">Loading course…</p> : <><div className="page-heading"><div><span className="eyebrow">YOUR PREPARATION COURSE</span><h1>{course.title}</h1><p>{course.days} days · {course.daily_minutes / 60} study hours per day · {course.availability_scope === 'shared' ? 'Shared across courses' : 'For this course'}</p></div><span className="badge">{course.status === 'generating' ? 'Generating' : course.status === 'blocked' ? 'Paused' : course.status === 'failed' ? 'Needs attention' : course.status === 'ready' ? 'Ready' : 'Draft saved'}</span></div>
      {course.kit && <div className="practice-entry"><div><h2>Continue your preparation</h2><p>Reading, flashcards, coding and live interview practice.</p></div><Link className="primary" href={`/courses/${course.id}/practice`}>Open practice</Link></div>}
      {course.kit && <KitBuilder key={course.id} course={course} csrf={auth.csrf_token} onSaved={setCourse} onRegenerated={() => { setGenerationVersion(v => v + 1); void load(); }} />}<div className="dashboard-grid"><div>{course.status === 'generating' || course.status === 'ready' ? <section className="panel saved-inputs"><h2>Preparation details</h2><p>{course.company_name || course.company_url}</p><p>{course.days} days · {course.daily_minutes / 60} hours per day</p><details><summary>Job description</summary><p className="saved-jd">{course.jd}</p></details><p className="field-help">{course.status === 'generating' ? 'Inputs are locked while generation is active.' : 'Generated content is saved with this course.'}</p></section> : <CourseForm key={course.id} csrf={auth.csrf_token} initial={course} onSaved={setCourse} />}</div><GenerationPanel key={`${course.id}:${course.revision}:${generationVersion}`} course={course} csrf={auth.csrf_token} onUpdate={load} /></div>
    </>}
  </Shell>;
}
