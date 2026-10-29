import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptUnreadSnapshot, applyUnreadEvent, runningSessionIds, unreadAcknowledgement, unreadSessionKeys } from '../src/renderer/workspace/session-indicators';
import type { UnreadCatalog, UnreadEvent, UnreadSummary } from '../src/shared/pi';
const summary = (sessionId: string, completionOrder: number, cwd = '/repo'): UnreadSummary => ({ sessionId, cwd, completionOrder, completedAt: '2026-10-19T00:00:00Z' });
const catalog = (revision: number, sessions: UnreadSummary[] = []): UnreadCatalog => ({ catalogId: 'epoch-1', catalogRevision: revision, sessions });
const event = (revision: number, unread: UnreadSummary | null): UnreadEvent => ({ type: 'sessions.unread', catalogId: 'epoch-1', catalogRevision: revision, sessionId: unread?.sessionId || 's1', cwd: unread?.cwd || '/repo', unread });

test('running indicators come from the complete machine catalog, including unselected sessions', () => {
  assert.deepEqual([...runningSessionIds({ epochId: 'machine', revision: 3, sessions: { idle: {}, child: { 'core:working': true }, unread: { 'core:unread': true }, finished: { 'core:working': false } } })], ['child']);
});

test('completion adds unread, authoritative acknowledgement clears only the matching conversation', () => {
  const initial = catalog(1, [summary('other', 1)]);
  const completed = applyUnreadEvent(initial, event(2, summary('s1', 2)));
  assert.equal(unreadSessionKeys(completed).size, 2);
  const cleared = applyUnreadEvent(completed, event(3, null));
  assert.deepEqual(cleared.sessions.map((item) => item.sessionId), ['other']);
});

test('a late acknowledgement response cannot clear a more recent completion', () => {
  const nextCompletion = applyUnreadEvent(catalog(5), event(6, summary('s1', 6)));
  assert.equal(acceptUnreadSnapshot(nextCompletion, catalog(5)), nextCompletion);
  assert.equal(applyUnreadEvent(nextCompletion, event(5, null)), nextCompletion);
});

test('a full snapshot at the same revision fills entries missed during a socket gap', () => {
  const partial = applyUnreadEvent(undefined, event(9, summary('s1', 9)));
  const full = catalog(9, [summary('s1', 9), summary('other', 7)]);
  assert.deepEqual(acceptUnreadSnapshot(partial, full).sessions, full.sessions);
});

test('read receipts use the observed catalog epoch, completion order and working directory', () => {
  const current = catalog(4, [summary('same-id', 3, '/a'), summary('same-id', 4, '/b')]);
  assert.equal(unreadSessionKeys(current).size, 2);
  assert.deepEqual(unreadAcknowledgement(current, { id: 'same-id', cwd: '/a' }), { id: 'same-id', cwd: '/a', catalogId: 'epoch-1', throughCompletionOrder: 3 });
  assert.equal(unreadAcknowledgement(current, { id: 'same-id', cwd: '/missing' }), undefined);
});

test('a new unread epoch removes marks belonging to the previous catalog', () => {
  const next = applyUnreadEvent(catalog(100, [summary('old', 100)]), { ...event(1, summary('new', 1)), catalogId: 'epoch-2' });
  assert.equal(next.catalogId, 'epoch-2');
  assert.deepEqual(next.sessions.map((item) => item.sessionId), ['new']);
});
