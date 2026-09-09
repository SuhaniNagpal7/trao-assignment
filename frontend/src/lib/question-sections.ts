import type { Kit } from '@/components/kit-results';

export const categoryLabels: Record<string, string> = {
  technical: 'Role skills', behavioural: 'Behavioural', 'system-design': 'System Design', 'company-fit': 'Company Fit',
};

// Keep the assignment's exported categories while presenting actual role topics.
export function questionSections(kit: Kit) {
  const sections: { id: string; label: string; questionIds: string[] }[] = [];
  const skills = kit.questions.filter(q => q.category === 'technical');
  const assigned = new Set<string>();
  for (const requirement of kit.role.requirements) {
    const questions = skills.filter(q => q.requirement_ids.includes(requirement.id));
    if (!questions.length) continue;
    sections.push({ id: 'topic:' + requirement.id, label: requirement.text, questionIds: questions.map(q => q.id) });
    questions.forEach(q => assigned.add(q.id));
  }
  const other = skills.filter(q => !assigned.has(q.id));
  if (other.length) sections.push({ id: 'technical', label: 'Role skills', questionIds: other.map(q => q.id) });
  for (const category of ['behavioural', 'system-design', 'company-fit']) {
    const questions = kit.questions.filter(q => q.category === category);
    if (questions.length) sections.push({ id: category, label: categoryLabels[category], questionIds: questions.map(q => q.id) });
  }
  return sections;
}
