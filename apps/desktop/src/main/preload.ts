import { contextBridge, ipcRenderer } from 'electron';
import type { AuthChallenge, ConnectionState, DesktopBridge, EnvironmentRefresh } from '../shared/types';
import type { TerminalPacket, WorkspacePacket } from '../shared/pi';

const bridge: DesktopBridge = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveProfile: (profile) => ipcRenderer.invoke('profile:save', profile),
  deleteProfile: (id) => ipcRenderer.invoke('profile:delete', id),
  pickIdentity: () => ipcRenderer.invoke('identity:pick'),
  connect: (profile) => ipcRenderer.invoke('connection:connect', profile),
  disconnect: () => ipcRenderer.invoke('connection:disconnect'),
  refreshEnvironment: () => ipcRenderer.invoke('environment:refresh'),
  getEnvironmentRefresh: () => ipcRenderer.invoke('environment:get'),
  onEnvironmentRefresh(listener) {
    const handler = (_event: Electron.IpcRendererEvent, state: EnvironmentRefresh) => listener(state);
    ipcRenderer.on('environment:state', handler);
    return () => ipcRenderer.removeListener('environment:state', handler);
  },
  answerChallenge: (id, answer) => ipcRenderer.invoke('auth:answer', id, answer),
  setTheme: (theme) => ipcRenderer.invoke('theme:set', theme),
  piRequest: (operation, input) => ipcRenderer.invoke('pi:request', operation, input),
  watchSession: (session, subscriptionId) => ipcRenderer.invoke('pi:watch', session, subscriptionId),
  unwatchSession: (subscriptionId) => ipcRenderer.invoke('pi:unwatch', subscriptionId),
  attachTerminal: (projectId, workspaceId, subscriptionId, cols, rows) => ipcRenderer.invoke('pi:terminal:attach', projectId, workspaceId, subscriptionId, cols, rows),
  terminalInput: (subscriptionId, data) => ipcRenderer.send('pi:terminal:input', subscriptionId, data),
  terminalResize: (subscriptionId, cols, rows) => ipcRenderer.send('pi:terminal:resize', subscriptionId, cols, rows),
  detachTerminal: (subscriptionId) => ipcRenderer.invoke('pi:terminal:detach', subscriptionId),
  openLink: (url) => ipcRenderer.invoke('link:open', url),
  onWorkspaceRefresh(listener) {
    ipcRenderer.on('workspace:refresh', listener);
    return () => ipcRenderer.removeListener('workspace:refresh', listener);
  },
  onWorkspace(listener) {
    const handler = (_event: Electron.IpcRendererEvent, packet: WorkspacePacket) => listener(packet);
    ipcRenderer.on('pi:workspace', handler);
    return () => ipcRenderer.removeListener('pi:workspace', handler);
  },
  onTerminal(listener) {
    const handler = (_event: Electron.IpcRendererEvent, packet: TerminalPacket) => listener(packet);
    ipcRenderer.on('pi:terminal', handler);
    return () => ipcRenderer.removeListener('pi:terminal', handler);
  },
  getConnection: () => ipcRenderer.invoke('connection:get'),
  onConnection(listener) {
    const handler = (_event: Electron.IpcRendererEvent, state: ConnectionState) => listener(state);
    ipcRenderer.on('connection:state', handler);
    return () => ipcRenderer.removeListener('connection:state', handler);
  },
  onChallenge(listener) {
    const handler = (_event: Electron.IpcRendererEvent, challenge: AuthChallenge | null) => listener(challenge);
    ipcRenderer.on('auth:challenge', handler);
    return () => ipcRenderer.removeListener('auth:challenge', handler);
  },
};
contextBridge.exposeInMainWorld('desktop', bridge);
