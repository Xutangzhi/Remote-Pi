import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSessionTree, filterSessionTree, type SessionEntry, type SessionNode } from '../src/renderer/workspace/session-tree';
const entry = (id: string, options: Partial<SessionEntry['session']> = {}, cwd = '/repo'): SessionEntry => ({
  workspace: { id: cwd, projectId: 'project', path: cwd, label: 'main', isMain: true },
  session: { id, cwd, path: `/sessions/${id}.jsonl`, name: id, firstMessage: '', created: '2026-10-01', modified: '2026-10-01', messageCount: 1, ...options },
});
const ids = (nodes: SessionNode[]): unknown[] => nodes.map((node) => [node.session.id, ids(node.children)]);

test('newer subagents stay below their parent instead of becoming recent root conversations', () => {
  const tree = buildSessionTree([entry('child', { parentSessionPath: '/sessions/parent.jsonl', agentSubsession: true, modified: '2026-10-03' }), entry('other', { modified: '2026-10-02' }), entry('parent')]);
  assert.deepEqual(ids(tree), [['other', []], ['parent', [['child', []]]]]);
});

test('nested agents keep multiple levels and match parent paths from another workspace', () => {
  const tree = buildSessionTree([entry('child', { agentSubsession: true, parentSessionPath: '/sessions/parent.jsonl/' }, '/worktree'), entry('grandchild', { agentSubsession: true, parentSessionPath: '/sessions/child.jsonl' }), entry('parent', { path: '/sessions/parent.jsonl/' })]);
  assert.deepEqual(ids(tree), [['parent', [['child', [['grandchild', []]]]]]]);
  assert.equal(tree[0]?.children[0]?.workspace.path, '/worktree');
});

test('searching a child retains its ancestors and hides unrelated siblings', () => {
  const tree = buildSessionTree([entry('parent'), entry('child', { name: 'Review authentication', parentSessionPath: '/sessions/parent.jsonl', agentSubsession: true }), entry('unrelated', { parentSessionPath: '/sessions/parent.jsonl' })]);
  const result = filterSessionTree(tree, false, 'AUTHENTICATION', false);
  assert.deepEqual(ids(result), [['parent', [['child', []]]]]);
  assert.equal(result[0]?.contextOnly, true);
});

test('archive filtering keeps the parent chain even when parent and child archive states differ', () => {
  const tree = buildSessionTree([entry('parent'), entry('archived-child', { archived: true, parentSessionPath: '/sessions/parent.jsonl' }), entry('active-child', { parentSessionPath: '/sessions/parent.jsonl' })]);
  assert.deepEqual(ids(filterSessionTree(tree, true, '', false)), [['parent', [['archived-child', []]]]]);
  assert.equal(filterSessionTree(tree, true, '', false)[0]?.contextOnly, true);
  assert.deepEqual(ids(filterSessionTree(tree, false, '', false)), [['parent', [['active-child', []]]]]);
  const archivedParent = buildSessionTree([entry('parent', { archived: true }), entry('child', { parentSessionPath: '/sessions/parent.jsonl' })]);
  assert.deepEqual(ids(filterSessionTree(archivedParent, false, '', false)), [['parent', [['child', []]]]]);
});

test('a missing parent remains visible as an orphan instead of dropping the subagent', () => {
  const tree = buildSessionTree([entry('child', { parentSessionPath: '/unavailable/parent.jsonl', agentSubsession: true })]);
  assert.equal(tree[0]?.missingParent, true);
  assert.deepEqual(ids(filterSessionTree(tree, false, '', false)), [['child', []]]);
});

test('parent cycles cannot hide sessions or recurse forever', () => {
  const tree = buildSessionTree([entry('a', { parentSessionPath: '/sessions/b.jsonl' }), entry('b', { parentSessionPath: '/sessions/a.jsonl' }), entry('self', { parentSessionPath: '/sessions/self.jsonl' })]);
  assert.deepEqual(ids(tree), [['b', [['a', []]]], ['self', []]]);
  assert.equal(filterSessionTree(tree, false, '', false).length, 2);
});

test('names and creation time never invent a parent relationship', () => {
  const tree = buildSessionTree([entry('ordinary', { name: 'subagent review' }), entry('no-path', { path: undefined })]);
  assert.deepEqual(ids(tree), [['ordinary', []], ['no-path', []]]);
});
