'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, Course } from '@/lib/api';
import KitResults, { Kit } from './kit-results';

const categories = ['technical', 'behavioural', 'system-design', 'company-fit'];
const pinsFrom = (course: Course) => [...Object.entries(course.kit_meta?.items || {}), ...Object.entries(course.kit_meta?.sections || {})].filter(([, value]) => value.pinned).map(([key]) => key);

export default function KitBuilder({ course, csrf, onSaved, onRegenerated }: { course: Course; csrf: string; onSaved: (course: Course) => void; onRegenerated: () => void }) {
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState('Overview');
  const [draft, setDraft] = useState<Kit>(course.kit!);
  const [pins, setPins] = useState<string[]>(pinsFrom(course));
  const [status, setStatus] = useState('All changes saved');
  const [error, setError] = useState('');
  const [regenerating, setRegenerating] = useState(false);
  const [section, setSection] = useState('company_brief');
  const current = useRef(draft), currentPins = useRef(pins), revision = useRef(course.kit_revision || 1);
  const serial = useRef(0), savedSerial = useRef(0), saving = useRef(false), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retry = useRef<() => Promise<void>>(async () => {});
  const mounted = useRef(true);
  const requestKey = useRef<string | null>(null);
  const save = useCallback(async () => {
    if (saving.current || serial.current === savedSerial.current) return;
    const value = current.current;
    if (value.role.requirements.some(r => !r.text.trim()) || value.questions.some(q => !q.prompt.trim() || !q.answer_outline.trim()) || value.flashcards.some(c => !c.front.trim() || !c.back.trim())) {
      setStatus('Complete empty requirement, question and flashcard fields to save.'); return;
    }
    saving.current = true; setStatus('Saving…'); setError('');
    const sent = serial.current;
    try {
      const result = await api<{ course: Course }>(`/courses/${course.id}/kit`, { method: 'PUT', body: JSON.stringify({ revision: revision.current, kit: value, pins: currentPins.current }) }, csrf);
      revision.current = result.course.kit_revision;
      savedSerial.current = sent;
      if (!mounted.current) return;
      if (serial.current === sent) {
        current.current = result.course.kit!; setDraft(result.course.kit!);
        setStatus('All changes saved');
      }
      onSaved(result.course);
    } catch (e) {
      if (mounted.current) { setError((e as Error).message); setStatus('Not saved — your draft is kept here'); }
      saving.current = false;
      return;
    }
    saving.current = false;
    if (mounted.current && serial.current !== savedSerial.current) timer.current = setTimeout(() => void retry.current(), 450);
  }, [course.id, csrf, onSaved]);
  retry.current = save;
  useEffect(() => {
    if (course.kit_revision !== revision.current && serial.current === savedSerial.current && !saving.current) {
      revision.current = course.kit_revision; current.current = course.kit!; setDraft(course.kit!);
      currentPins.current = pinsFrom(course); setPins(currentPins.current);
    }
  }, [course]);
  useEffect(() => {
    mounted.current = true;
    const warn = (event: BeforeUnloadEvent) => { if (serial.current !== savedSerial.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => { mounted.current = false; if (timer.current) clearTimeout(timer.current); window.removeEventListener('beforeunload', warn); };
  }, []);
  function change(mutate: (kit: Kit) => void, nextPins = currentPins.current) {
    const next = structuredClone(current.current); mutate(next);
    current.current = next; currentPins.current = nextPins; serial.current++;
    setDraft(next); setPins(nextPins); setStatus('Unsaved changes');
    if (timer.current) clearTimeout(timer.current);
    if (!error) timer.current = setTimeout(() => void retry.current(), 650);
  }
  function pin(key: string) { change(() => {}, pins.includes(key) ? pins.filter(item => item !== key) : [...pins, key]); }
  function remove(group: 'questions' | 'flashcards', id: string) {
    change(kit => {
      if (group === 'questions') {
        kit.questions = kit.questions.filter(item => item.id !== id);
        for (const day of kit.schedule.days) {
          const count = day.question_ids.length;
          day.question_ids = day.question_ids.filter(qid => qid !== id);
          if (count) day.minutes = Math.round(day.minutes * day.question_ids.length / count);
        }
      } else kit.flashcards = kit.flashcards.filter(item => item.id !== id);
    }, pins.filter(key => key !== `${group}:${id}`));
  }
  async function reloadSaved() {
    try {
      const result = await api<{ course: Course }>(`/courses/${course.id}`);
      serial.current = savedSerial.current = 0; revision.current = result.course.kit_revision;
      current.current = result.course.kit!; currentPins.current = pinsFrom(result.course);
      setDraft(current.current); setPins(currentPins.current); setError(''); setStatus('All changes saved'); onSaved(result.course);
    } catch (e) { setError((e as Error).message); }
  }
  function downloadDraft() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(current.current, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'course-draft.json'; link.click(); URL.revokeObjectURL(url);
  }
  async function regenerate() {
    await save();
    if (saving.current || serial.current !== savedSerial.current) return;
    setRegenerating(true); setError(''); requestKey.current ||= crypto.randomUUID();
    try {
      await api(`/courses/${course.id}/regenerate`, { method: 'POST', body: JSON.stringify({ revision: revision.current, section, request_key: requestKey.current }) }, csrf);
      requestKey.current = null; onRegenerated();
    } catch (e) { setError((e as Error).message); }
    finally { setRegenerating(false); }
  }
  const referencePicker = (ids: string[], update: (ids: string[]) => void) => <label>Topics covered<select multiple aria-label="Topics covered" value={ids} onChange={e => update(Array.from(e.target.selectedOptions).map(option => option.value))}>{draft.role.requirements.map(r => <option key={r.id} value={r.id}>{r.text}</option>)}</select></label>;
  const must = new Set(draft.role.requirements.filter(r => r.priority === 'must').map(r => r.id));
  const covered = new Set(draft.questions.flatMap(q => q.requirement_ids));
  const scheduled = new Set(draft.schedule.days.flatMap(day => day.question_ids));
  const scheduleCoverage = new Set(draft.questions.filter(q => scheduled.has(q.id)).flatMap(q => q.requirement_ids));
  const gaps = draft.role.requirements.filter(r => must.has(r.id) && (!covered.has(r.id) || !scheduleCoverage.has(r.id)));
  return <>
    <div className="builder-toolbar"><button className="secondary" onClick={() => setEditing(!editing)}>{editing ? 'Preview course' : 'Edit course'}</button><span role="status">{status}</span></div>
    {error && <div className="panel builder-message"><p className="error" role="alert">{error}</p><button className="secondary" onClick={() => { setError(''); void save(); }}>Retry save</button> <button className="secondary" disabled={saving.current} onClick={reloadSaved}>Reload saved version (discard draft)</button> <button className="text-link" onClick={downloadDraft}>Download my draft</button></div>}
    {!!gaps.length && <p className="generation-intro-note" role="status">Needs review: {gaps.map(r => r.text).join(', ')} lack question coverage or a scheduled question. Deleted content will not be restored automatically.</p>}
    {editing ? <section className="panel kit-editor" aria-label="Course editor">
      <h2>Edit your course</h2><p className="field-help">Changes save automatically. Your additions, edits and pins are kept during regeneration. Hold Ctrl or Command to select multiple topics.</p>
      <div className="study-tabs" role="tablist" aria-label="Editor sections">{['Overview', 'Questions', 'Flashcards', 'Daily plan'].map(name => <button role="tab" aria-selected={tab === name} key={name} onClick={() => setTab(name)}>{name}</button>)}</div>
      {tab === 'Overview' && <div className="editor-fields">
        <label>Company summary<textarea aria-label="Company summary" value={draft.company_brief.summary} onChange={e => change(k => { k.company_brief.summary = e.target.value; })} /></label>
        <label>What the company does<textarea aria-label="What the company does" value={draft.company_brief.what_they_do} onChange={e => change(k => { k.company_brief.what_they_do = e.target.value; })} /></label>
        <label>Sources (one URL per line)<textarea aria-label="Sources (one URL per line)" value={draft.company_brief.sources.join('\n')} onChange={e => change(k => { k.company_brief.sources = e.target.value.split('\n').filter(Boolean); })} /></label>
        <button className="secondary" aria-pressed={pins.includes('company_brief')} onClick={() => pin('company_brief')}>{pins.includes('company_brief') ? 'Unpin company brief' : 'Pin company brief'}</button>
        <label>Role title<input aria-label="Role title" value={draft.role.title} onChange={e => change(k => { k.role.title = e.target.value; })} /></label>
        <label>Seniority<input aria-label="Seniority" value={draft.role.seniority} onChange={e => change(k => { k.role.seniority = e.target.value; })} /></label>
        <label>Responsibilities (one per line)<textarea aria-label="Responsibilities (one per line)" value={draft.role.responsibilities.join('\n')} onChange={e => change(k => { k.role.responsibilities = e.target.value.split('\n').filter(Boolean); })} /></label>
        <h3>Requirements</h3><button className="secondary" onClick={() => change(k => { k.role.requirements.push({ id: `manual_req_${crypto.randomUUID()}`, text: '', kind: 'technical', priority: 'must' }); })}>Add requirement</button>{draft.role.requirements.map((r, i) => <div className="editor-item" key={r.id}><label>Requirement {i + 1}<input value={r.text} onChange={e => change(k => { k.role.requirements[i].text = e.target.value; })} /></label><label>Priority<select aria-label="Priority" value={r.priority} onChange={e => change(k => { k.role.requirements[i].priority = e.target.value; })}><option value="must">Required</option><option value="nice">Preferred</option></select></label><label>Kind<select aria-label="Kind" value={r.kind} onChange={e => change(k => { k.role.requirements[i].kind = e.target.value; })}>{['technical', 'behavioural', 'domain'].map(kind => <option key={kind}>{kind}</option>)}</select></label><button className="text-link" onClick={() => change(k => { k.role.requirements = k.role.requirements.filter(item => item.id !== r.id); for (const item of [...k.questions, ...k.flashcards]) item.requirement_ids = item.requirement_ids.filter(id => id !== r.id); })}>Delete requirement</button></div>)}
      </div>}
      {tab === 'Questions' && <><button className="secondary" onClick={() => change(k => { k.questions.push({ id: `manual_${crypto.randomUUID()}`, prompt: '', answer_outline: '', category: 'technical', difficulty: 2, requirement_ids: [] }); })}>Add question</button>{draft.questions.map((q, i) => <article className="editor-item" key={q.id} aria-label={`Question ${i + 1}`}>
        <h3>Question {i + 1}</h3><p className="field-help">{course.kit_meta?.items?.[`questions:${q.id}`]?.origin === 'manual' ? 'Added by you' : course.kit_meta?.items?.[`questions:${q.id}`]?.edited ? 'Your edit ? kept during regeneration' : 'Generated question'}</p><label>Question prompt<textarea aria-label="Question prompt" value={q.prompt} onChange={e => change(k => { k.questions[i].prompt = e.target.value; })} /></label>
        <label>Answer outline<textarea aria-label="Answer outline" rows={5} value={q.answer_outline} onChange={e => change(k => { k.questions[i].answer_outline = e.target.value; })} /></label>
        <label>Category<select aria-label="Category" value={q.category} onChange={e => change(k => { k.questions[i].category = e.target.value; })}>{categories.map(category => <option key={category}>{category}</option>)}</select></label>
        <label>Difficulty<select aria-label="Difficulty" value={q.difficulty} onChange={e => change(k => { k.questions[i].difficulty = Number(e.target.value); })}>{[1, 2, 3].map(value => <option key={value}>{value}</option>)}</select></label>
        {referencePicker(q.requirement_ids, ids => change(k => { k.questions[i].requirement_ids = ids; }))}
        <div className="editor-actions"><button className="secondary" aria-pressed={pins.includes(`questions:${q.id}`)} onClick={() => pin(`questions:${q.id}`)}>{pins.includes(`questions:${q.id}`) ? 'Unpin' : 'Pin'}</button><button className="secondary" disabled={i === 0} onClick={() => change(k => { [k.questions[i - 1], k.questions[i]] = [k.questions[i], k.questions[i - 1]]; })}>Move up</button><button className="secondary" disabled={i === draft.questions.length - 1} onClick={() => change(k => { [k.questions[i + 1], k.questions[i]] = [k.questions[i], k.questions[i + 1]]; })}>Move down</button><button className="text-link" onClick={() => remove('questions', q.id)}>Delete question</button></div>
      </article>)}</>}
      {tab === 'Flashcards' && <><button className="secondary" onClick={() => change(k => { k.flashcards.push({ id: `manual_${crypto.randomUUID()}`, front: '', back: '', requirement_ids: [] }); })}>Add flashcard</button>{draft.flashcards.map((card, i) => <article className="editor-item" key={card.id} aria-label={`Flashcard ${i + 1}`}><label>Front<textarea aria-label="Front" value={card.front} onChange={e => change(k => { k.flashcards[i].front = e.target.value; })} /></label><label>Back<textarea aria-label="Back" rows={4} value={card.back} onChange={e => change(k => { k.flashcards[i].back = e.target.value; })} /></label>{referencePicker(card.requirement_ids, ids => change(k => { k.flashcards[i].requirement_ids = ids; }))}<div className="editor-actions"><button className="secondary" aria-pressed={pins.includes(`flashcards:${card.id}`)} onClick={() => pin(`flashcards:${card.id}`)}>{pins.includes(`flashcards:${card.id}`) ? 'Unpin' : 'Pin'}</button><button className="text-link" onClick={() => remove('flashcards', card.id)}>Delete flashcard</button></div></article>)}</>}
      {tab === 'Daily plan' && draft.schedule.days.map((day, i) => <article className="editor-item" key={day.day}><h3>Day {day.day}</h3><label>Day focus<input aria-label="Day focus" value={day.focus} onChange={e => change(k => { k.schedule.days[i].focus = e.target.value; })} /></label><label>Minutes<input aria-label="Minutes" type="number" min={0} max={course.daily_minutes} value={day.minutes} onChange={e => change(k => { k.schedule.days[i].minutes = Number(e.target.value); })} /></label><label>Scheduled questions<select aria-label="Scheduled questions" multiple value={day.question_ids} onChange={e => { const ids = Array.from(e.target.selectedOptions).map(o => o.value); change(k => { k.schedule.days[i].question_ids = ids; }); }}>{draft.questions.map(q => <option key={q.id} value={q.id}>{q.prompt}</option>)}</select></label></article>)}
    </section> : <KitResults kit={draft} shared={course.availability_scope === 'shared'} />}
    <section className="panel regeneration-controls"><h3>Refresh one section</h3><p className="field-help">Your edits, pins, manual items and deletions are kept. Other sections stay as they are.</p><label>Section to regenerate<select aria-label="Section to regenerate" value={section} onChange={e => { setSection(e.target.value); requestKey.current = null; }}><option value="company_brief">Company brief</option><option value="schedule">Study schedule</option>{categories.map(category => <option key={category} value={`questions_${category}`}>{category} questions</option>)}</select></label><button className="secondary" disabled={regenerating || course.status === 'generating' || !!error} onClick={regenerate}>{regenerating || course.status === 'generating' ? 'Generation in progress…' : 'Regenerate section'}</button></section>
  </>;
}
