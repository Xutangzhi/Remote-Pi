import type { MachineStatusSnapshot, SessionRef, UnreadCatalog, UnreadEvent } from './pi';
import { sessionKey } from './session';

export function runningSessionIds(snapshot: MachineStatusSnapshot): Set<string> {
  return new Set(Object.entries(snapshot.sessions).filter(([, flags]) => flags['core:working'] === true).map(([id]) => id));
}

export function applyUnreadEvent(current: UnreadCatalog | undefined, event: UnreadEvent): UnreadCatalog {
  if (current?.catalogId === event.catalogId && current.catalogRevision >= event.catalogRevision) return current;
  const sessions = current?.catalogId === event.catalogId ? current.sessions : [];
  const remaining = sessions.filter((item) => item.sessionId !== event.sessionId || item.cwd !== event.cwd);
  return { catalogId: event.catalogId, catalogRevision: event.catalogRevision, sessions: event.unread ? [event.unread, ...remaining] : remaining };
}

export function acceptUnreadSnapshot(current: UnreadCatalog | undefined, next: UnreadCatalog): UnreadCatalog {
  return current?.catalogId === next.catalogId && current.catalogRevision > next.catalogRevision ? current : next;
}

export const unreadSessionKeys = (catalog?: UnreadCatalog): Set<string> => new Set(catalog?.sessions.map((item) => sessionKey({ id: item.sessionId, cwd: item.cwd })));
export function unreadAcknowledgement(catalog: UnreadCatalog | undefined, session: SessionRef): Record<string, unknown> | undefined {
  const summary = catalog?.sessions.find((item) => item.sessionId === session.id && item.cwd === session.cwd);
  return summary && catalog ? { id: session.id, cwd: session.cwd, catalogId: catalog.catalogId, throughCompletionOrder: summary.completionOrder } : undefined;
}
