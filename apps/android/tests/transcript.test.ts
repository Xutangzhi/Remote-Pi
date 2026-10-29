import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyEvent, fromSnapshot, prependHistory, type MessageItem } from '../src/renderer/workspace/transcript';
import type { TranscriptSnapshot } from '../src/shared/pi';
const snapshot = (messages: unknown[] = [], partial: unknown = null): TranscriptSnapshot => ({ page: { messages, start: 0, total: messages.length }, seq: 10, partial, status: {} }) as TranscriptSnapshot;

test('snapshot coalesces tool calls/results and keeps separate assistant turns', () => {
  const state = fromSnapshot(snapshot([
    { role: 'user', entryId: 'u1', content: 'Read the file' },
    { role: 'assistant', entryId: 'a1', content: [{ type: 'text', text: 'Checking.' }, { type: 'toolCall', id: 't1', name: 'read', arguments: { path: 'README.md' } }] },
    { role: 'toolResult', toolCallId: 't1', toolName: 'read', content: [{ type: 'text', text: 'Hello' }], isError: false },
    { role: 'assistant', entryId: 'a2', content: [{ type: 'text', text: 'Done.' }] },
  ]));
  assert.equal(state.items.length, 4);
  const tool = state.items.find((item) => item.kind === 'tool');
  assert.equal(tool?.state, 'success'); assert.equal(tool?.output, 'Hello'); assert.equal(tool?.summary, 'README.md');
  assert.deepEqual(state.items.filter((item) => item.kind === 'message').map((item) => item.text), ['Read the file', 'Checking.', 'Done.']);
});

test('partial snapshot resumes deltas and final message replaces its stream instead of duplicating it', () => {
  let state = fromSnapshot(snapshot([], { role: 'assistant', streamId: 'stream-1', content: [{ type: 'text', text: 'Hello' }] }));
  state = applyEvent(state, { type: 'assistant.delta', streamId: 'stream-1', seq: 11, text: ' world' });
  state = applyEvent(state, { type: 'message.end', seq: 12, message: { role: 'assistant', streamId: 'stream-1', entryId: 'a1', content: 'Hello world' } });
  state = applyEvent(state, { type: 'message.append', seq: 13, message: { role: 'assistant', streamId: 'stream-1', entryId: 'a1', content: 'Hello world' } });
  assert.equal(state.items.length, 1); assert.equal((state.items[0] as MessageItem).text, 'Hello world');
  assert.equal((state.items[0] as MessageItem).live, false);
});

test('tool updates replace cumulative output, tool result does not add a second card', () => {
  let state = fromSnapshot(snapshot());
  state = applyEvent(state, { type: 'tool.start', toolCallId: 't1', toolName: 'bash', args: { command: 'ls' } });
  state = applyEvent(state, { type: 'tool.update', toolCallId: 't1', text: 'a' });
  state = applyEvent(state, { type: 'tool.update', toolCallId: 't1', text: 'a\nb' });
  state = applyEvent(state, { type: 'tool.end', toolCallId: 't1', text: 'a\nb', isError: false });
  state = applyEvent(state, { type: 'message.append', message: { role: 'toolResult', toolCallId: 't1', toolName: 'bash', content: [{ type: 'text', text: 'a\nb' }] } });
  assert.equal(state.items.length, 1); assert.equal(state.items[0]?.kind, 'tool');
  assert.equal(state.items[0]?.kind === 'tool' && state.items[0].output, 'a\nb');
});

test('prepending history preserves the live stream and deduplicates durable entries', () => {
  const state = fromSnapshot(snapshot([{ role: 'user', entryId: 'u2', content: 'Second' }], { role: 'assistant', streamId: 'live', content: [{ type: 'text', text: 'Working' }] }));
  const next = prependHistory(state, [{ role: 'user', entryId: 'u1', content: 'First' }, { role: 'user', entryId: 'u2', content: 'Second' }], 0);
  assert.equal(next.items.length, 3); assert.equal(next.active, 'live');
});

test('tool call on an older page joins a newer result without reverting it to running', () => {
  const current = fromSnapshot(snapshot([{ role: 'toolResult', toolCallId: 't1', toolName: 'read', content: [{ type: 'text', text: 'finished' }] }]));
  const next = prependHistory(current, [{ role: 'assistant', entryId: 'a1', content: [{ type: 'toolCall', id: 't1', name: 'read', arguments: { path: 'README.md' } }] }], 0);
  const tool = next.items.find((item) => item.kind === 'tool');
  assert.equal(tool?.state, 'success'); assert.equal(tool?.output, 'finished'); assert.equal(tool?.summary, 'README.md');
});
