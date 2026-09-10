'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, FileText, Activity, Pencil, Eye } from 'lucide-react';
import { api, Auth, Course } from '@/lib/api';
import Shell from './shell';
import CourseForm from './course-form';
import GenerationPanel from './generation-panel';
import KitBuilder from './kit-builder';
import Drawer from './drawer';

const statusLabel = (s: string) => s === 'generating' ? 'Generating' : s === 'blocked' ? 'Paused' : s === 'failed' ? 'Needs attention' : s === 'ready' ? 'Ready' : 'Draft';
const jobActive = (s: string) => ['queued', 'running', 'retry_wait'].includes(s);

export default function CourseDetail({ auth, id }: { auth: Auth; id: string }) {
  const [course, setCourse] = useState<Course | null>(null);
  const [activeJob, setActiveJob] = useState(false);
  const [error, setError] = useState('');
  const [generationVersion, setGenerationVersion] = useState(0);
  const [editing, setEditing] = useState(false);
  const [drawer, setDrawer] = useState<null | 'details' | 'generation'>(null);
  const load = useCallback(async () => {
    setError('');
    try {
      const [c, jobs] = await Promise.all([
        api<{ course: Course }>(`/courses/${id}`),
        api<{ jobs: { status: string }[] }>(`/courses/${id}/jobs`),
      ]);
      setCourse(c.course);
      setActiveJob(jobs.jobs.some(j => jobActive(j.status)));
    } catch (e) { setError((e as Error).message); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  const panel = (extra: React.ReactNode = null) => <>
    {extra}
    <GenerationPanel key={`${course!.id}:${course!.revision}:${generationVersion}`} course={course!} csrf={auth.csrf_token} onUpdate={load} />
  </>;

  return <Shell auth={auth}>
    <Link className="back-link" href="/"><ArrowLeft size={15} /> All courses</Link>
    {error ? <div className="panel empty-state"><h2>We couldn’t open this course.</h2><p role="alert">{error}</p><button className="secondary" onClick={load}>Try again</button></div>
    : !course ? <p role="status">Loading course…</p>
    : (() => {
      const ready = course.status === 'ready' && course.kit && !activeJob;
      const draft = course.status === 'draft' && !activeJob;
      return <>
        <div className="course-head">
          <div>
            <h1>{course.title}</h1>
            <p>{course.days} days · {course.daily_minutes / 60} h/day · {course.availability_scope === 'shared' ? 'shared time budget' : 'this course only'}</p>
          </div>
          <div className="course-head-actions">
            <span className="badge" data-status={course.status}>{statusLabel(course.status)}</span>
            {ready && <Link className="primary" href={`/courses/${course.id}/practice`}>Start practicing <ArrowRight size={15} /></Link>}
          </div>
        </div>

        {ready ? <>
          <div className="course-toolbar-2">
            <div className="segmented" role="group" aria-label="Course view">
              <button type="button" aria-pressed={!editing} onClick={() => setEditing(false)}><Eye size={14} /> Preview</button>
              <button type="button" aria-pressed={editing} onClick={() => setEditing(true)}><Pencil size={14} /> Edit</button>
            </div>
            <div className="course-toolbar-2-right">
              <button type="button" className="secondary" onClick={() => setDrawer('details')}><FileText size={14} /> Job description</button>
              <button type="button" className="secondary" onClick={() => setDrawer('generation')}><Activity size={14} /> Generation</button>
            </div>
          </div>
          <KitBuilder key={course.id} course={course} csrf={auth.csrf_token} editing={editing} onSaved={setCourse} onRegenerated={() => { setGenerationVersion(v => v + 1); void load(); }} />
          <Drawer open={drawer === 'details'} title="Preparation inputs" onClose={() => setDrawer(null)}>
            <p><strong>{course.company_name || course.company_url}</strong></p>
            <p className="field-help">{course.days} days · {course.daily_minutes / 60} hours per day</p>
            <h3>Job description</h3>
            <p className="saved-jd">{course.jd}</p>
          </Drawer>
          <Drawer open={drawer === 'generation'} title="Generation & regeneration" onClose={() => setDrawer(null)}>
            <GenerationPanel key={`${course.id}:${course.revision}:${generationVersion}`} course={course} csrf={auth.csrf_token} onUpdate={load} />
          </Drawer>
        </> : draft
          ? panel(<CourseForm key={course.id} csrf={auth.csrf_token} initial={course} onSaved={setCourse} />)
          : panel(course.kit ? <p className="generation-intro-note">Your saved course is below. It updates automatically when this run finishes.</p> : null)}
      </>;
    })()}
  </Shell>;
}
