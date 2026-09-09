import { test } from 'node:test';
import assert from 'node:assert/strict';
import { course, lessonFixture } from './fixture.js';
import { learnerProfile } from '../src/learner.js';
import { tasks, allocate } from '../src/study-plan.js';
import { commandSchema, practiceCommand, preparePractice, generateSchema, practiceSteps, finishPractice, practiceView } from '../src/practice.js';
import { allocateSchedule } from '../src/pipeline.js';

test('beginner plans allocate extra time without dropping required topics or exceeding daily capacity', () => {
  const c: any = course();
  const ordinary = allocateSchedule(c, c.kit.role.requirements, c.kit.questions);
  c.learner_profile = learnerProfile.parse({ level: 'beginner' });
  const beginner = allocateSchedule(c, c.kit.role.requirements, c.kit.questions);
  assert.equal(beginner.days.length, c.days);
  assert.ok(beginner.days.every(d => d.minutes <= c.daily_minutes));
  assert.ok(beginner.days[0].minutes > ordinary.days[0].minutes);
  assert.ok(beginner.days[0].focus.startsWith('Foundations'));
  assert.ok(c.kit.questions.every((q: any) => beginner.days.some(d => d.question_ids.includes(q.id))));
});

test('topic self assessment changes practice time and preserves completed work', () => {
  let c: any = course();
  c.learning.lessons = [lessonFixture('r1'), lessonFixture('r2')];
  c.practice.plan = allocate(c);
  c.practice.completed = { 'read:r1': new Date().toISOString() };
  const before = tasks(c).find(t => t.id === 'answer:q1').minutes;
  c = practiceCommand(c, commandSchema.parse({ action: 'profile', revision: 1, request_key: 'profile', learner_profile: { level: 'advanced', topics: { r1: 'new', r2: 'comfortable' } } }), []);
  assert.equal(tasks(c).find(t => t.id === 'answer:q1').minutes, before + 10);
  assert.ok(c.practice.completed['read:r1']);
  assert.equal(practiceView(c).learner_profile.topics.r1, 'new');
  assert.throws(() => practiceCommand(c, commandSchema.parse({ action: 'profile', revision: c.practice_revision, request_key: 'bad', learner_profile: { topics: { removed: 'new' } } }), []), /topics changed/);
});

test('lessons receive learner context and reject a stale level when generation finishes', async () => {
  const c: any = course();
  c.learner_profile = learnerProfile.parse({ level: 'beginner', experience_years: 0, focus: 'Explain terminology', topics: { r1: 'new' } });
  const snapshot = preparePractice(c, generateSchema.parse({ kind: 'lessons', revision: 1, request_key: 'lesson' }));
  await practiceSteps(snapshot)[0].run({ input: c, outputs: {}, deadline: Date.now() + 1000, llm: { json: async (schema, _prompt, input: any) => { assert.equal(input.learner_profile.level, 'beginner'); assert.equal(input.topic_confidence, 'new'); return schema.parse(lessonFixture('r1')); } } });
  c.practice.learner_profile = learnerProfile.parse({ level: 'advanced' });
  assert.throws(() => finishPractice(c, snapshot, { save_lessons: { lessons: [] } }, []), /preparation level changed/);
});


test('legacy feedback loads with its submitted answer, not a later edited draft', () => {
  const c: any = course();
  const feedback = { verdict: 'developing', explanation: 'Explain the failure.', correct_approach: 'Reproduce first.', revision_tasks: ['Read the traceback.'] };
  c.practice.feedback = { 'answer:q1': feedback };
  c.practice.drafts = { 'answer:q1': 'A newer draft' };
  c.practice_history = [{ kind: 'feedback', payload: { item_id: 'answer:q1', answer: 'Original answer', feedback } }];
  assert.deepEqual(practiceView(c).state.feedback['answer:q1'], { answer: 'Original answer', feedback });
  assert.deepEqual(c.practice.feedback['answer:q1'], feedback);
  c.practice_history = [];
  assert.equal(practiceView(c).state.feedback['answer:q1'].answer, null);
  c.practice.feedback['answer:q1'] = { answer: 'New submission', feedback };
  assert.deepEqual(practiceView(c).state.feedback['answer:q1'], { answer: 'New submission', feedback });
});
