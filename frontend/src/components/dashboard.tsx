"use client";
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, BookOpen, Plus, Search, ArrowRight, Layers, CheckCircle2, Target } from 'lucide-react';
import { api, Auth, Course } from '@/lib/api';
import Shell from './shell';

export default function Dashboard({ auth }: { auth: Auth }) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const refresh = useCallback(async () => {
    setError('');
    try { setCourses((await api<{ courses: Course[] }>('/courses')).courses); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!courses.some(course => course.status === 'generating')) return;
    const timer = setTimeout(() => void refresh(), 3000);
    return () => clearTimeout(timer);
  }, [courses, refresh]);
  const filtered = courses.filter(c => `${c.title} ${c.company_name}`.toLowerCase().includes(query.toLowerCase()));

  const ready = courses.filter(c => c.status === 'ready');
  const reviewed = courses.reduce((n, c) => n + (c.practice_summary?.reviewed || 0), 0);
  const confident = courses.reduce((n, c) => n + (c.practice_summary?.confident || 0), 0);
  return <Shell auth={auth}>
    <div className="dashboard-welcome"><span className="eyebrow">YOUR INTERVIEW WORKSPACE</span><span className="welcome-name">Welcome back, {auth.user.name.split(' ')[0]}</span></div>
    <div className="simple-heading">
      <div><h1>My courses</h1><p>Your interview preparation, in one place.</p></div>
      <Link className="primary" href="/courses/new"><Plus size={16} /> New course</Link>
    </div>
    {!loading && !error && <><section className="focus-banner"><div><span className="focus-tag">A LITTLE PREPARATION, EVERY DAY</span><h2>Your next opportunity.<br />Your plan to get there.</h2><p>Turn a job description into a focused course.<br />Learn, practise, and see where to improve.</p><Link className="focus-action" href={ready[0] ? `/courses/${ready[0].id}/practice` : courses[0] ? `/courses/${courses[0].id}` : '/courses/new'}>{ready[0] ? 'Continue preparing' : courses[0] ? 'Finish course setup' : 'Build your first plan'}<ArrowRight size={17} /></Link></div><div className="focus-visual" aria-hidden="true"><span className="orbit orbit-one"/><span className="orbit orbit-two"/><div className="visual-card"><span className="visual-check"><CheckCircle2 size={26}/></span><strong>One step closer.</strong><span>Learn. Recall. Improve.</span><div className="visual-lines"><i/><i/><i/></div></div></div></section><div className="overview-metrics"><div><Layers size={19}/><span><strong>{courses.length}</strong>Interview courses</span></div><div><BookOpen size={19}/><span><strong>{reviewed}</strong>Cards reviewed</span></div><div><Target size={19}/><span><strong>{confident}</strong>Cards marked confident</span></div></div></>}
    {loading ? <div className="course-empty" role="status">Loading your courses...</div>
      : error ? <div className="course-empty"><p className="error" role="alert">{error}</p><button className="secondary" onClick={refresh}>Try again</button></div>
      : courses.length === 0 ? <div className="course-empty">
        <span className="empty-book"><BookOpen size={25} strokeWidth={1.5} /></span>
        <h2>A place for your next interview.</h2>
        <p>Add a job description and the time you have to prepare.</p>
        <Link className="text-link" href="/courses/new">Create your first course <ArrowUpRight size={15} /></Link>
      </div> : <section aria-label="Saved courses" className="saved-courses">
        <div className="course-toolbar"><span>{courses.length} {courses.length === 1 ? 'course' : 'courses'}</span><div className="course-search"><Search size={16} /><input type="search" aria-label="Search courses" placeholder="Search courses" value={query} onChange={e => setQuery(e.target.value)} /></div></div>
        {filtered.length === 0 ? <div className="course-empty compact"><h2>No matching courses.</h2><button className="text-link" onClick={() => setQuery('')}>Clear search</button></div>
          : <div className="course-rows">{filtered.map(c => <Link href={`/courses/${c.id}`} className="course-row" data-status={c.status} key={c.id}>
            <span className="row-avatar">{(c.company_name || c.title).slice(0, 1).toUpperCase()}</span>
            <div className="row-title"><h2>{c.title}</h2><p>{c.company_name || new URL(c.company_url).hostname}</p></div>
            <span className="row-time">{c.days}-day plan<span>{c.daily_minutes / 60} hrs / day</span></span>
            <div className="row-progress"><span>{c.practice_progress ?? 0}% reviewed</span><progress aria-label={`${c.title} cards reviewed`} value={c.practice_progress ?? 0} max={100} /></div>
            <div className="course-detail-metrics"><span><b>{c.practice_summary?.confident ?? 0}</b> confident cards</span><span>{c.practice_summary?.questions_total ? <><b>{c.practice_summary.questions_attempted}/{c.practice_summary.questions_total}</b> questions attempted</> : 'Questions not generated'}</span><span>{c.practice_summary?.activities_total ? <><b>{c.practice_summary.activities_completed}/{c.practice_summary.activities_total}</b> scheduled tasks done</> : 'Practice plan not started'}</span></div>
            <span className="row-status"><span />{c.status === 'draft' ? 'Draft' : c.status === 'blocked' ? 'Paused' : c.status === 'generating' ? 'Working' : c.status === 'failed' ? 'Failed' : 'Ready'}</span>
            <ArrowUpRight className="row-arrow" size={18} />
          </Link>)}</div>}
      </section>}
  </Shell>;
}
