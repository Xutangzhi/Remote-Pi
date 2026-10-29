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

test('a user echo, runtime completion and durable append render as one message', () => {
  let state = fromSnapshot(snapshot());
  state = applyEvent(state, { type: 'message.append', seq: 11, message: { role: 'user', content: '只发送一次' } });
  state = applyEvent(state, { type: 'message.end', seq: 12, message: { role: 'user', timestamp: 1000, content: [{ type: 'text', text: '只发送一次' }] } });
  state = applyEvent(state, { type: 'message.append', seq: 13, message: { role: 'user', entryId: 'u1', timestamp: 1000, content: [{ type: 'text', text: '只发送一次' }] } });
  assert.equal(state.items.length, 1); assert.equal(state.items[0]?.id, 'u1');
});

test('an echo recovered from a snapshot is replaced by its confirmed user message', () => {
  let state = fromSnapshot(snapshot([{ role: 'user', content: '恢复中的消息' }]));
  state = applyEvent(state, { type: 'message.end', seq: 11, message: { role: 'user', timestamp: 0, content: '恢复中的消息' } });
  state = applyEvent(state, { type: 'message.append', seq: 12, message: { role: 'user', timestamp: 0, entryId: 'restored', content: '恢复中的消息' } });
  assert.equal(state.items.length, 1); assert.equal(state.items[0]?.id, 'restored');
});

test('two real sends of identical text remain separate even at the same timestamp', () => {
  let state = fromSnapshot(snapshot());
  for (const entryId of ['u1', 'u2']) {
    state = applyEvent(state, { type: 'message.append', message: { role: 'user', content: '继续' } });
    state = applyEvent(state, { type: 'message.end', message: { role: 'user', timestamp: 1000, content: '继续' } });
    state = applyEvent(state, { type: 'message.append', message: { role: 'user', entryId, timestamp: 1000, content: '继续' } });
  }
  assert.deepEqual(state.items.map((item) => item.id), ['u1', 'u2']);
  const history = fromSnapshot(snapshot(['u1', 'u2'].map((entryId) => ({ role: 'user', entryId, timestamp: 1000, content: '继续' }))));
  assert.equal(history.items.length, 2);
});

test('confirming one of two equal pending echoes does not consume both', () => {
  let state = fromSnapshot(snapshot());
  for (let i = 0; i < 2; i++) state = applyEvent(state, { type: 'message.append', message: { role: 'user', content: '继续' } });
  for (const timestamp of [1, 2]) {
    state = applyEvent(state, { type: 'message.end', message: { role: 'user', timestamp, content: '继续' } });
    state = applyEvent(state, { type: 'message.append', message: { role: 'user', entryId: `u${timestamp}`, timestamp, content: '继续' } });
  }
  assert.deepEqual(state.items.map((item) => item.id), ['u1', 'u2']);
});

test('user echo matching includes image identity as well as text', () => {
  let state = fromSnapshot(snapshot());
  const content = (mediaId: string) => [{ type: 'text', text: '看这张图' }, { type: 'image', mimeType: 'image/png', mediaId }];
  for (const image of ['a', 'b']) state = applyEvent(state, { type: 'message.append', message: { role: 'user', content: content(image) } });
  for (const [image, timestamp] of [['b', 2], ['a', 1]] as const) {
    state = applyEvent(state, { type: 'message.end', message: { role: 'user', timestamp, content: content(image) } });
    state = applyEvent(state, { type: 'message.append', message: { role: 'user', timestamp, entryId: image, content: content(image) } });
  }
  assert.deepEqual(state.items.map((item) => item.id), ['a', 'b']);
  assert.deepEqual(state.items.filter((item): item is MessageItem => item.kind === 'message').map((item) => item.images[0]?.mediaId), ['a', 'b']);
});
