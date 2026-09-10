'use client';
import { useState } from 'react';
import { categoryLabels } from '@/lib/question-sections';

export type Kit = {
  company_brief: { summary: string; what_they_do: string; sources: string[] };
  role: { title: string; seniority: string; responsibilities: string[]; requirements: { id: string; text: string; priority: string; kind: string }[] };
  questions: { id: string; prompt: string; answer_outline: string; category: string; difficulty: number; requirement_ids: string[] }[];
  flashcards: { id: string; front: string; back: string; requirement_ids: string[] }[];
  schedule: { days_available: number; days: { day: number; focus: string; question_ids: string[]; minutes: number }[] };
  coverage: { uncovered_requirement_ids: string[]; passes: number };
};

export default function KitResults({ kit, shared }: { kit: Kit; shared: boolean }) {
  const [tab, setTab] = useState('Overview');
  const [dayNumber, setDayNumber] = useState(1);
  const [showSources, setShowSources] = useState(false);
  const day = kit.schedule.days.find(day => day.day === dayNumber) || kit.schedule.days[0];
  const covered = new Set(kit.questions.flatMap(q => q.requirement_ids));
  const missing = kit.role.requirements.some(r => r.priority === 'must' && !covered.has(r.id));
  const labels = new Map(kit.role.requirements.map(requirement => [requirement.id, requirement.text]));
  const question = (item: Kit['questions'][number]) => <details className="study-question" key={item.id}><summary>{item.prompt}</summary><span className="research-meta">{categoryLabels[item.category] || item.category} · Difficulty {item.difficulty}/3 · {item.requirement_ids.map(id => labels.get(id)).join(', ')}</span><h4>How to approach it</h4><p className="study-answer">{item.answer_outline}</p></details>;
  return <section className="panel kit-results" aria-label="Generated preparation kit">
    <div className="study-tabs" role="tablist" aria-label="Preparation sections">{['Overview', 'Schedule'].map(name => <button key={name} role="tab" aria-selected={tab === name} onClick={() => setTab(name)}>{name}</button>)}</div>
    <div role="tabpanel" aria-label={tab}>
      {tab === 'Overview' && <>
        <h3>{kit.role.title || 'Your role'}{kit.role.seniority ? ` · ${kit.role.seniority}` : ''}</h3>
        {(kit.company_brief.summary || kit.company_brief.what_they_do) && <p>{[kit.company_brief.summary, kit.company_brief.what_they_do].filter(Boolean).join(' ')}</p>}
        {!!kit.company_brief.sources.length && <p className="field-help"><button type="button" className="text-link" onClick={() => setShowSources(v => !v)}>{showSources ? 'Hide sources' : `${kit.company_brief.sources.length} sources`}</button></p>}
        {showSources && <p className="study-sources">{kit.company_brief.sources.map((url, i) => <a href={url} target="_blank" rel="noopener noreferrer" key={url}>Source {i + 1}</a>)}</p>}
        {!!kit.role.responsibilities.length && <><h3>What the role involves</h3><ul>{kit.role.responsibilities.map((text, i) => <li key={i}>{text}</li>)}</ul></>}
        <h3>Topics to prepare <span className="count">{kit.role.requirements.length}</span></h3>
        {kit.role.requirements.length ? <ul>{kit.role.requirements.map(r => <li key={r.id}>{r.text} <span className="research-meta">{r.priority === 'must' ? 'Required' : 'Preferred'} · {r.kind}</span></li>)}</ul> : <p>No explicit requirements were found. This is a light review plan; a fuller JD will produce a more useful kit.</p>}
        <p className="field-help">{kit.questions.length} practice questions · {kit.flashcards.length} flashcards · {missing ? 'some required topics need attention' : 'all required topics covered'}</p>
        {!!kit.coverage.uncovered_requirement_ids.length && <p className="generation-intro-note">Topics without practice questions: {kit.coverage.uncovered_requirement_ids.map(id => labels.get(id)).join(', ')}.</p>}
      </>}
      {tab === 'Schedule' && <>
        <label className="run-select">Study day<select aria-label="Study day" value={dayNumber} onChange={event => setDayNumber(Number(event.target.value))}>{kit.schedule.days.map(day => <option value={day.day} key={day.day}>Day {day.day} · {day.minutes} minutes</option>)}</select></label>
        {shared && <p className="field-help">This plan uses this course’s time allowance. Open practice to balance dated activities across your courses.</p>}
        <h3>Day {day.day}</h3><p>{day.focus}</p><p className="field-help">{day.minutes} minutes of suggested practice. Think through each answer before opening the explanation.</p>
        {day.question_ids.map(id => kit.questions.find(q => q.id === id)).filter((q): q is Kit['questions'][number] => !!q).map(question)}
      </>}
    </div>
  </section>;
}
