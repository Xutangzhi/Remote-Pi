import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCompletion, commandCompletions, completionTrigger, fileCompletion } from '../src/renderer/workspace/prompt-completions';

test('remote skills, extension commands and templates retain invocation names and argument hints', () => {
  const items = commandCompletions([
    { name: 'skill:review', source: 'skill', description: 'Review code' },
    { name: 'review-pr', source: 'prompt', argumentHint: '<PR URL>' },
    { name: 'review-extension', source: 'extension' },
  ], 'review');
  assert.equal(items[0]!.text, '/skill:review');
  assert.equal(items[0]!.detail, 'Skill');
  assert.match(items[1]!.detail!, /<PR URL>/);
  const input = '  /skill:rev';
  assert.equal(applyCompletion(input, completionTrigger(input, input.length)!, items[0]!).text, '  /skill:review ');
  assert.equal(completionTrigger('tell me /review', 15), undefined);
});

test('@ paths preserve suffix text, quote spaces and never trigger inside an email address', () => {
  const value = 'read @src/ then summarize';
  const trigger = completionTrigger(value, 10)!;
  const next = applyCompletion(value, trigger, fileCompletion('src/my file.ts', trigger));
  assert.equal(next.text, 'read @"src/my file.ts"  then summarize');
  assert.equal(next.cursor, 'read @"src/my file.ts" '.length);
  assert.equal(completionTrigger('email@example.com', 17), undefined);
  assert.equal(completionTrigger('read @"my file.ts" ', 19), undefined);
});

test('all-file scopes and quoted directory continuation match Pi Web conventions', () => {
  for (const value of ['@ local', '!@local']) assert.equal(completionTrigger(value, value.length)?.scope, 'all');
  const value = 'read @"my folder/"';
  const trigger = completionTrigger(value, value.length - 1)!;
  const next = applyCompletion(value, trigger, fileCompletion('my folder/file.ts', trigger));
  assert.equal(next.text, 'read @"my folder/file.ts" ');
  const directory = applyCompletion('@ fo', completionTrigger('@ fo', 4)!, fileCompletion('folder name/', completionTrigger('@ fo', 4)!));
  assert.equal(directory.text, '@ "folder name/"');
  assert.equal(completionTrigger(directory.text, directory.cursor)?.scope, 'all');
});

test('completion from the middle of a reference replaces its remaining token without touching following text', () => {
  const examples = [
    { marked: '/ski|ll:old argument', item: { text: '/skill:review', label: '/skill:review' }, expected: '/skill:review  argument' },
    { marked: 'read @REA|DME.md then summarize', item: { text: '@README.md', label: 'README.md' }, expected: 'read @README.md  then summarize' },
    { marked: 'use #fixture/fi|rst-model next', item: { text: '#fixture/second-model', label: 'Second model' }, expected: 'use #fixture/second-model  next' },
    { marked: 'read @"docs/ol|d file.md" then summarize', item: { text: '@"docs/my file.md"', label: 'docs/my file.md' }, expected: 'read @"docs/my file.md"  then summarize' },
  ];
  for (const example of examples) {
    const cursor = example.marked.indexOf('|'); const value = example.marked.replace('|', '');
    const next = applyCompletion(value, completionTrigger(value, cursor)!, example.item);
    assert.equal(next.text, example.expected);
    assert.equal(next.text.slice(next.cursor).trimStart(), example.expected.slice(example.expected.indexOf('  ') + 2));
  }
});
