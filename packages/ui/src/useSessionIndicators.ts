import { getBridge } from './bridge';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MachineStatusSnapshot, SessionRef, UnreadCatalog } from '@remote-pi/core/pi';
import { isWorking, piRequest } from './api';
import { acceptUnreadSnapshot, applyUnreadEvent, runningSessionIds, unreadAcknowledgement, unreadSessionKeys } from '@remote-pi/core/session-indicators';

export function useSessionIndicators(onError: (error: unknown) => void) {
  const [running, setRunning] = useState<Set<string>>();
  const [unread, setUnread] = useState<UnreadCatalog>();
  const acknowledgeRef = useRef<(session: SessionRef) => Promise<void>>(async () => {});
  const refreshRef = useRef<() => void>(() => {});
  useEffect(() => {
    let alive = true;
    let machine: MachineStatusSnapshot | undefined;
    let catalog: UnreadCatalog | undefined;
    let machineVersion = 0; let unreadVersion = 0;
    let refreshing = false; let refreshAgain = false;
    const acknowledgements = new Set<string>();
    const installMachine = (next: MachineStatusSnapshot) => {
      if (machine?.epochId === next.epochId && machine.revision >= next.revision) return;
      machine = next; setRunning(runningSessionIds(next));
    };
    const installUnread = (next: UnreadCatalog) => {
      const accepted = acceptUnreadSnapshot(catalog, next);
      if (accepted !== catalog) { catalog = accepted; setUnread(accepted); }
    };
    // Join/rejoin reads are bounded catalogs. No historical sessions are opened
    // merely to find out whether they are running.
    const refresh = async () => {
      refreshAgain = true; if (refreshing) return;
      refreshing = true;
      do {
        refreshAgain = false;
        const observedMachine = machineVersion; const observedUnread = unreadVersion;
        await Promise.all([
          piRequest<MachineStatusSnapshot>('machine.status').then((snapshot) => { if (alive && observedMachine === machineVersion) installMachine(snapshot); }).catch((error) => { if (alive) onError(error); }),
          piRequest<UnreadCatalog>('sessions.unread').then((snapshot) => { if (alive && observedUnread === unreadVersion) installUnread(snapshot); }).catch((error) => { if (alive) onError(error); }),
        ]);
      } while (alive && refreshAgain);
      refreshing = false;
    };
    refreshRef.current = () => { void refresh(); };
    acknowledgeRef.current = async (session) => {
      const input = unreadAcknowledgement(catalog, session); if (!input) return;
      const key = JSON.stringify(input); if (acknowledgements.has(key)) return;
      acknowledgements.add(key); const observed = unreadVersion;
      try {
        const snapshot = await piRequest<UnreadCatalog>('session.acknowledgeUnread', input);
        if (alive) {
          // A new completion or epoch arriving while an acknowledgement is in
          // flight must survive its older HTTP response.
          if (observed === unreadVersion) installUnread(snapshot);
          else void refresh();
        }
      } catch (error) { if (alive) onError(`标记会话已读失败：${error instanceof Error ? error.message : String(error)}`); }
      finally { acknowledgements.delete(key); }
    };
    const off = getBridge().onWorkspace((packet) => {
      if (packet.type !== 'catalog') return;
      const event = packet.event;
      if (event.type === 'catalog.connected') { void refresh(); return; }
      if (event.type === 'machine.status') {
        machineVersion++;
        const epochChanged = machine && machine.epochId !== event.status.epochId;
        installMachine(event.status);
        if (epochChanged) { unreadVersion++; void refresh(); }
      } else if (event.type === 'sessions.unread') {
        const gap = !catalog || catalog.catalogId !== event.catalogId || event.catalogRevision > catalog.catalogRevision + 1;
        unreadVersion++;
        const next = applyUnreadEvent(catalog, event);
        if (next !== catalog) { catalog = next; setUnread(next); }
        if (gap) void refresh();
      } else if (!machine && (event.type === 'status.update' || event.type === 'activity.update')) {
        const id = event.type === 'status.update' ? event.status.sessionId : event.activity.sessionId;
        const active = event.type === 'status.update' ? isWorking(event.status) : event.activity.phase === 'active' && event.activity.startup !== true;
        setRunning((previous) => { const next = new Set(previous); if (active) next.add(id); else next.delete(id); return next; });
      }
    });
    const offRefresh = getBridge().onWorkspaceRefresh(() => { void refresh(); });
    // A connected socket can miss a publication without triggering reconnect.
    // Reconcile bounded catalogs while visible and immediately on return.
    const refreshVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    const timer = window.setInterval(refreshVisible, 5000);
    window.addEventListener('focus', refreshVisible);
    document.addEventListener('visibilitychange', refreshVisible);
    void refresh();
    return () => { alive = false; off(); offRefresh(); window.clearInterval(timer); window.removeEventListener('focus', refreshVisible); document.removeEventListener('visibilitychange', refreshVisible); acknowledgeRef.current = async () => {}; refreshRef.current = () => {}; };
  }, [onError]);
  const acknowledge = useCallback((session: SessionRef) => acknowledgeRef.current(session), []);
  const refresh = useCallback(() => refreshRef.current(), []);
  return { running, unread, unreadKeys: unreadSessionKeys(unread), acknowledge, refresh };
}
