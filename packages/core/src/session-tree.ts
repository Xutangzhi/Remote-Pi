import type { SessionInfo, Workspace } from './pi';
import { sessionTitle } from './session';

export interface SessionEntry { workspace: Workspace; session: SessionInfo; }
export interface SessionNode extends SessionEntry { children: SessionNode[]; missingParent: boolean; contextOnly?: boolean; }
const normalizePath = (path: string) => path.replace(/[/\\]+$/u, '');

export function buildSessionTree(entries: SessionEntry[]): SessionNode[] {
  const nodes = entries.map((entry): SessionNode => ({ ...entry, children: [], missingParent: false }))
    .sort((a, b) => b.session.modified.localeCompare(a.session.modified));
  const byPath = new Map(nodes.flatMap((node) => node.session.path ? [[normalizePath(node.session.path), node] as const] : []));
  const parents = new Map<SessionNode, SessionNode>();
  const roots: SessionNode[] = [];
  for (const node of nodes) {
    const parent = node.session.parentSessionPath ? byPath.get(normalizePath(node.session.parentSessionPath)) : undefined;
    // A malformed parent cycle must never hide conversations or recurse forever.
    let ancestor = parent;
    while (ancestor && ancestor !== node) ancestor = parents.get(ancestor);
    if (parent && ancestor !== node) { parents.set(node, parent); parent.children.push(node); }
    else { node.missingParent = Boolean(node.session.parentSessionPath || node.session.agentSubsession); roots.push(node); }
  }
  return roots;
}

export function filterSessionTree(nodes: SessionNode[], archived: boolean, query: string, projectMatches: boolean): SessionNode[] {
  const needle = query.trim().toLocaleLowerCase();
  return nodes.flatMap((node) => {
    const children = filterSessionTree(node.children, archived, needle, projectMatches);
    const matches = Boolean(node.session.archived) === archived && (!needle || projectMatches || sessionTitle(node.session).toLocaleLowerCase().includes(needle));
    return matches || children.length ? [{ ...node, children, contextOnly: !matches }] : [];
  });
}
