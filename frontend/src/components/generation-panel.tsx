'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Circle, Loader2, Play, RotateCcw } from 'lucide-react';
import { api, Course } from '@/lib/api';
import ResearchResults from './research-results';
import type { ComponentProps } from 'react';

type Step = { key: string; label: string; status: string; attempts: number };
type Job = { id: string; status: string; course_revision: number; completed_steps: number; total_steps: number; steps: Step[]; created_at: string; available_at: string; error: { code: string; message: string } | null; can_retry: boolean; research?: ComponentProps<typeof ResearchResults>['research'] };
type JobEvent = { id: number; message: string; level: string; created_at: string };
type PollResponse = { job: Job; events: JobEvent[]; next_cursor: number; has_more: boolean };
const active = (status: string) => ['queued', 'running', 'retry_wait'].includes(status);
const statusLabel: Record<string, string> = { queued: 'Queued', running: 'In progress', retry_wait: 'Waiting to retry', blocked: 'Paused', failed: 'Needs attention', completed: 'Complete' };

export default function GenerationPanel({ course, csrf, onUpdate }: { course: Course; csrf: string; onUpdate: () => void }) {
  const [job, setJob] = useState<Job | null>(null);
  const [runs, setRuns] = useState<Job[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [events, setEvents] = useState<JobEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [connectionError, setConnectionError] = useState('');
  const [pollRevision, setPollRevision] = useState(0);
  const requestKey = useRef<string | null>(null);
  const updateRef = useRef(onUpdate);
  updateRef.current = onUpdate;

  const loadRuns = useCallback(async () => {
    setError('');
    try {
      const data = await api<{ jobs: Job[] }>(`/courses/${course.id}/jobs`);
      setRuns(data.jobs);
      setSelected(previous => previous || data.jobs[0]?.id || null);
      if (data.jobs[0]) setJob(data.jobs[0]);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [course.id]);
  useEffect(() => { void loadRuns(); }, [loadRuns]);

  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let cursor = 0;
    let failures = 0;
    setEvents([]);
    setConnectionError('');
    async function poll() {
      try {
        const data = await api<PollResponse>(`/jobs/${selected}?after_event_id=${cursor}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setJob(data.job);
        setRuns(old => old.map(run => run.id === data.job.id ? data.job : run));
        setEvents(old => [...old, ...data.events.filter(event => !old.some(item => item.id === event.id))]);
        cursor = data.next_cursor;
        failures = 0;
        setConnectionError('');
        if (data.has_more || active(data.job.status)) timer = setTimeout(poll, data.has_more ? 0 : 1500);
        else updateRef.current();
      } catch (e) {
        if (controller.signal.aborted) return;
        setConnectionError('Connection interrupted. Your run continues in the background. Reconnecting…');
        timer = setTimeout(poll, Math.min(15000, 1500 * 2 ** Math.min(++failures, 4)));
      }
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [selected, pollRevision]);

  async function start(force = false, retry = false) {
    setBusy(true); setError('');
    requestKey.current ||= crypto.randomUUID();
    try {
      const result = retry && job
        ? await api<{ job: Job }>(`/jobs/${job.id}/retry`, { method: 'POST' }, csrf)
        : await api<{ job: Job }>(`/courses/${course.id}/generate`, { method: 'POST', body: JSON.stringify({ force, request_key: requestKey.current, include_lessons: true }) }, csrf);
      requestKey.current = null;
      setJob(result.job);
      setRuns(old => [result.job, ...old.filter(run => run.id !== result.job.id)]);
      setSelected(result.job.id);
      setPollRevision(value => value + 1);
      updateRef.current();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  const currentRun = job?.course_revision === course.revision;
  const anotherRunActive = runs.some(run => active(run.status) && run.id !== job?.id);
  return <section className="panel generation-panel" aria-label="Course generation">
    <div className="generation-heading"><h2>Course generation</h2>{job && <span className="badge">{statusLabel[job.status] || job.status}</span>}</div>
    <p className="generation-intro">Progress is saved automatically. You can refresh or leave this page at any time.</p>
    {loading ? <p role="status">Loading generation history…</p> : <>
      {runs.length > 1 && <label className="run-select">Generation history<select value={selected || ''} onChange={event => { setSelected(event.target.value); setJob(runs.find(run => run.id === event.target.value) || null); }}>{runs.map((run, index) => <option key={run.id} value={run.id}>{index === 0 ? 'Latest run' : 'Earlier run'} · {new Date(run.created_at).toLocaleString()}</option>)}</select></label>}
      {!job && <div className="generation-intro-note">Start a run to analyse the job description, research the company, and find public interview experiences. Then generate practice questions, flashcards, and your study schedule.</div>}
      {job && <>
        <p className="step-count">{job.completed_steps} of {job.total_steps} steps complete</p>
        <ol className="generation-steps">{job.steps.map(step => <li key={step.key} className={`generation-step ${step.status}`}>
          {step.status === 'completed' ? <CheckCircle2 size={18} /> : step.status === 'running' ? <Loader2 className="spin" size={18} /> : <Circle size={18} />}
          <div><strong>{step.label}</strong><span>{step.status === 'pending' ? 'Not started' : step.status === 'completed' ? 'Saved' : step.status === 'blocked' ? 'Not connected yet' : step.status === 'retry_wait' ? 'Retry scheduled' : step.status === 'failed' ? 'Needs attention' : 'Working…'}{step.attempts > 1 ? ` · Attempt ${step.attempts}` : ''}</span></div>
        </li>)}</ol>
        {job.status === 'queued' && <p className="generation-intro-note">Waiting for the background worker. This run will start when a worker is available.</p>}
        {job.status === 'retry_wait' && <p className="generation-intro-note">The next attempt is scheduled for {new Date(job.available_at).toLocaleTimeString()}. Completed steps will be reused.</p>}
        {job.error && <p className={job.status === 'blocked' ? 'generation-intro-note' : 'error'} role="status">{job.error.message}</p>}
        <ResearchResults research={job.research} />
        {!currentRun && <p className="generation-intro-note">These logs are from earlier inputs. Start a new run to use your saved changes.</p>}
        <details className="generation-logs" open><summary>Activity log <span>{events.length} events</span></summary><ol>{events.map(event => <li key={event.id} className={event.level}><time dateTime={event.created_at}>{new Date(event.created_at).toLocaleTimeString()}</time><span>{event.message}</span></li>)}</ol></details>
      </>}
      {connectionError && <p className="generation-intro-note" role="status">{connectionError}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {!job || !currentRun ? <button className="primary full" disabled={busy || anotherRunActive || !!job && active(job.status)} onClick={() => start()}><Play size={15} />{busy ? 'Queuing…' : 'Start generation'}</button>
        : job.can_retry && job.error?.code !== 'PIPELINE_NOT_IMPLEMENTED' ? <button className="primary full" disabled={busy || anotherRunActive} onClick={() => start(false, true)}><RotateCcw size={15} />{busy ? 'Queuing…' : 'Retry unfinished steps'}</button>
        : job.status === 'completed' || (!job.can_retry && ['failed', 'blocked'].includes(job.status)) ? <button className="secondary full" disabled={busy || anotherRunActive} onClick={() => start(true)}><RotateCcw size={15} />{busy ? 'Queuing…' : 'Start a fresh run'}</button> : null}
      {error && !job && <button className="text-link" onClick={loadRuns}>Reload history</button>}
    </>}
  </section>;
}
