type Fact = { text: string; evidence: string };
type Requirement = Fact & { id: string; kind: string; priority: string };
type Source = { url: string; text: string; title?: string; kind: string; fetched_at: string };
type Research = {
  extract_job?: { title: Fact | null; seniority: Fact | null; responsibilities: Fact[]; requirements: Requirement[]; warnings: string[] };
  research_company?: { sources: Source[]; skipped: { url?: string; reason: string }[]; limitations?: string[] };
  search_interviews?: { sources: Source[]; skipped: { url?: string; reason: string }[]; limitations?: string[] };
};

export default function ResearchResults({ research }: { research?: Research }) {
  if (!research || !Object.keys(research).length) return null;
  const role = research.extract_job;
  return <div className="research-results"><h3>Your research</h3>
    {role && <details open><summary>Job requirements{role.title ? ` · ${role.title.text}` : ''}</summary>
      {role.seniority && <p>{role.seniority.text}</p>}
      {role.warnings.map(warning => <p key={warning}>{warning}</p>)}
      <ul>{role.requirements.map(requirement => <li key={requirement.id}><strong>{requirement.text}</strong><span className="research-meta">{requirement.priority === 'must' ? 'Required' : 'Preferred'} · {requirement.kind}</span><blockquote>{requirement.evidence}</blockquote></li>)}</ul>
      {role.responsibilities.length > 0 && <><h4>Responsibilities</h4><ul>{role.responsibilities.map((fact, i) => <li key={i}>{fact.text}<blockquote>{fact.evidence}</blockquote></li>)}</ul></>}
    </details>}
    {([['Company sources', research.research_company], ['Interview experiences', research.search_interviews]] as const).map(([label, section]) => section && <details key={label}><summary>{label} · {section.sources.length} sources</summary>
      {section.limitations?.map(message => <p className="field-help" key={message}>{message}</p>)}
      {section.sources.map((source, i) => <article key={`${source.url}:${i}`}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title || new URL(source.url).hostname}</a><span className="research-meta">{source.kind.replaceAll('_', ' ')} · {new Date(source.fetched_at).toLocaleDateString()}</span><p className="research-excerpt">{source.text.slice(0, 700)}{source.text.length > 700 ? '…' : ''}</p></article>)}
      {section.skipped.map((item, i) => <p className="field-help" key={i}>{item.url ? `${item.url}: ` : ''}{item.reason}</p>)}
    </details>)}
  </div>;
}
