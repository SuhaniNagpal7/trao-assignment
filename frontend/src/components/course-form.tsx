'use client';
import { LearnerFields } from "./learner-profile";
import { defaultLearnerProfile } from "@/lib/api";
import { FormEvent, useState } from 'react';
import { ArrowRight, Clock3, FileText, Upload } from 'lucide-react';
import { api, ApiError, Course, CourseInput } from '@/lib/api';
const defaults: CourseInput = { title: '', company_name: '', company_url: '', jd: '', days: 14, daily_minutes: 120, availability_scope: 'shared', learner_profile: defaultLearnerProfile };
export default function CourseForm({ csrf, initial, onSaved }: { csrf: string; initial?: Course; onSaved: (course: Course) => void }) {
  const [values, setValues] = useState<CourseInput>(initial ? { title: initial.title, company_name: initial.company_name, company_url: initial.company_url, jd: initial.jd, days: initial.days, daily_minutes: initial.daily_minutes, availability_scope: initial.availability_scope, learner_profile: initial.learner_profile || defaultLearnerProfile } : defaults);
  const [extracting, setExtracting] = useState(false);
  const [pdfMode, setPdfMode] = useState(false);
  const [tab, setTab] = useState<'single' | 'batch'>('single');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [fields, setFields] = useState<{ field: string; message: string }[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const change = <K extends keyof CourseInput>(key: K, value: CourseInput[K]) => setValues(v => ({ ...v, [key]: value }));
  async function uploadPdf(file: File | undefined) {
    if (!file) return;
    setError(''); setNotice(''); setExtracting(true);
    try {
      if (file.size > 5_000_000) throw new Error('The PDF must be smaller than 5 MB.');
      const result = await api<{ extracted: { title: string; company_name: string; company_url: string; jd: string; warnings: string[] } }>('/documents/extract', { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: file }, csrf);
      setValues(v => ({ ...v, title: result.extracted.title, company_name: result.extracted.company_name, company_url: result.extracted.company_url, jd: result.extracted.jd }));
      setNotice('PDF extracted. Review the details below and fill in anything missing. ' + result.extracted.warnings.join(' '));
    } catch (e) { setError((e as Error).message); }
    finally { setExtracting(false); }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setNotice(''); setFields([]);
    try {
      if (tab === 'batch') {
        if (!file) throw new Error('Select a JSON file to import.');
        if (file.size > 1_500_000) throw new Error('The file must be smaller than 1.5 MB.');
        let cases: unknown;
        try { cases = JSON.parse(await file.text()); } catch { throw new Error('This file is not valid JSON.'); }
        if (!Array.isArray(cases) || !cases.length || cases.length > 20) throw new Error('Include between 1 and 20 cases in a JSON array.');
        const result = await api<{ results: { course: Course; created: boolean }[] }>('/courses/batch', { method: 'POST', body: JSON.stringify({ cases, daily_minutes: values.daily_minutes, auto_generate: true }) }, csrf);
        setNotice(`${result.results.filter(r => r.created).length} new courses saved. Existing duplicates were kept.`);
        onSaved(result.results[0].course);
      } else {
        const result = await api<{ course: Course; created?: boolean }>(initial ? `/courses/${initial.id}` : '/courses/create-and-generate', { method: initial ? 'PUT' : 'POST', body: JSON.stringify({ ...values, ...(initial ? { revision: initial.revision } : {}) }) }, csrf);
        setNotice(initial ? 'Changes saved.' : result.created ? 'Course saved. Preparing your kit and all reading chapters.' : 'This course is already saved. You can open it from your course list.');
        if (!initial) setValues(defaults);
        onSaved(result.course);
      }
    } catch (e) { setError((e as Error).message); if (e instanceof ApiError) setFields(e.fields); }
    finally { setBusy(false); }
  }
  return <section className="panel intake-panel"><div className="panel-heading"><div className="section-icon"><FileText size={19} /></div><div><h2>{initial ? 'Preparation details' : 'Start a new course'}</h2><p>{initial ? 'Keep your preparation inputs up to date.' : 'One opportunity. One focused plan.'}</p></div></div>
    {!initial && <div className="tabs" aria-label="Input method"><button type="button" disabled={extracting} aria-pressed={tab === 'single' && !pdfMode} className={tab === 'single' && !pdfMode ? 'selected' : ''} onClick={() => { setTab('single'); setPdfMode(false); setError(''); setNotice(''); }}>Paste a description</button><button type="button" disabled={extracting} aria-pressed={pdfMode && tab === 'single'} className={pdfMode && tab === 'single' ? 'selected' : ''} onClick={() => { setTab('single'); setPdfMode(true); setError(''); setNotice(''); }}><Upload size={14} /> Upload PDF</button><button type="button" disabled={extracting} aria-pressed={tab === 'batch'} className={tab === 'batch' ? 'selected' : ''} onClick={() => { setTab('batch'); setError(''); setNotice(''); }}><Upload size={14} /> Import multiple</button></div>}
    <form onSubmit={submit}>
      <fieldset disabled={busy || extracting}>
      {tab === 'single' ? <>
        {pdfMode && <div className="upload-box"><strong>Upload a job description</strong><p>Choose one job posting as a PDF, up to 5 MB. We will fill in the details below for you to review.</p><input aria-label="Job description PDF" type="file" accept=".pdf,application/pdf" onChange={e => { void uploadPdf(e.target.files?.[0]); e.target.value = ''; }} /></div>}
        <label>Course name<input value={values.title} onChange={e => change('title', e.target.value)} required maxLength={120} placeholder="e.g. Frontend Engineer at Linear" /></label>
        <div className="form-row"><label>Company <span className="optional">optional</span><input value={values.company_name} onChange={e => change('company_name', e.target.value)} maxLength={120} placeholder="Company name" /></label><label>Company website<input type="url" value={values.company_url} onChange={e => change('company_url', e.target.value)} required maxLength={2048} placeholder="https://company.com" /></label></div>
        <label>Job description<textarea value={values.jd} onChange={e => change('jd', e.target.value)} required maxLength={50000} rows={7} placeholder="Paste the role, responsibilities, and requirements here…" /><span className="field-help">Use the original posting, even if it’s short.<span>{values.jd.length.toLocaleString()} / 50,000</span></span></label>
      </> : <div className="upload-box"><Upload size={26} /><strong>Bring your opportunities together</strong><p>Upload a JSON array of cases. Up to 20 courses per file.</p><input aria-label="Batch JSON file" type="file" accept=".json,application/json" required onChange={e => setFile(e.target.files?.[0] || null)} /><a href="/example-cases.json" download>Download an example file</a></div>}
      <div className="time-section">{tab === 'single' && <LearnerFields value={values.learner_profile || defaultLearnerProfile} onChange={profile => change('learner_profile', profile)} />}<span className="small-heading"><Clock3 size={15} /> MAKE IT FIT YOUR DAY</span><div className="form-row">
        {tab === 'single' && <label>Days until interview<input type="number" min={1} max={60} step={1} required value={values.days || ''} onChange={e => change('days', Number(e.target.value))} /></label>}
        <label>Study hours per day<input type="number" min={0.25} max={12} step={0.25} required value={values.daily_minutes / 60 || ''} onChange={e => change('daily_minutes', Math.round(Number(e.target.value) * 60))} /></label>
      </div><label>Daily availability applies to<select value={tab === 'batch' ? 'shared' : values.availability_scope} disabled={tab === 'batch'} onChange={e => change('availability_scope', e.target.value as CourseInput['availability_scope'])}><option value="shared">All my courses combined</option><option value="course">This course only</option></select></label><p className="field-help">{tab === 'batch' ? 'Each case supplies its own interview timeline. Imported courses share your daily availability.' : 'Your time budget will guide the course schedule.'}</p></div>
      </fieldset>
      {extracting && <p className="success" role="status">Reading your PDF and extracting the job details...</p>}
      {error && <div className="error" role="alert">{error}{fields.length > 0 && <ul>{fields.map((f, i) => <li key={i}>{f.field}: {f.message}</li>)}</ul>}</div>}
      {notice && <p className="success" role="status">{notice}</p>}
      <button className="primary full" disabled={busy || extracting}>{extracting ? 'Reading PDF...' : busy ? 'Saving…' : initial ? 'Save changes' : tab === 'batch' ? 'Import and generate courses' : 'Create and generate course'}<ArrowRight size={17} /></button>
      <p className="form-footnote">{initial ? 'Your changes are securely saved to your account.' : 'Your kit, reading chapters and daily practice plan are prepared in one run. You can leave and return while it works.'}</p>
    </form>
  </section>;
}
