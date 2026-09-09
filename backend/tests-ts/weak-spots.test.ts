import { test } from 'node:test';
import assert from 'node:assert/strict';
import { course } from './fixture.js';
import { weakSpots, summary } from '../src/study-plan.js';
import { commandSchema, practiceCommand } from '../src/practice.js';

test('topic confidence distinguishes unseen, weak and stale reviews', () => {
  const c: any = course();
  assert.equal(weakSpots(c).find((t: any) => t.id === 'r1').confidence, null);
  const card = c.kit.flashcards[0];
  c.practice.reviews = { fc1: { confidence: 1, content: [card.front, card.back] } };
  assert.equal(weakSpots(c).find((t: any) => t.id === 'r1').confidence, 0);
  assert.equal(summary(c).coverage, 100);
  assert.equal(summary(c).confident, 0);
  c.practice.reviews.fc1.confidence = 3;
  assert.equal(weakSpots(c).find((t: any) => t.id === 'r1').confidence, 100);
  assert.equal(summary(c).confident, 1);
  card.back = 'Edited answer';
  assert.equal(weakSpots(c).find((t: any) => t.id === 'r1').confidence, null);
  assert.equal(summary(c).confident, 0);
});

test('focused sessions include only the selected topic and reject removed topics', () => {
  const c: any = course();
  c.kit.flashcards.push({ id: 'fc2', front: 'Risk?', back: 'Explain it.', requirement_ids: ['r2'] });
  const command = (item_id: string) => commandSchema.parse({ action: 'session', revision: 1, request_key: 'focused', item_id });
  const next = practiceCommand(c, command('r2'), []);
  assert.deepEqual(next.practice.session.queue, ['fc2']);
  assert.throws(() => practiceCommand(c, command('removed'), []), /topic was removed/);
});
