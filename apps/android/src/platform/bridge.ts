import { App as CapacitorApp } from '@capacitor/app';
import { native } from './native';
import { NativeSocket } from './native-socket';
import { Events } from './events';
import { PiClient } from './pi-client';
import type { DesktopBridge } from '../shared/types';

export async function createAndroidBridge(): Promise<DesktopBridge> {
  const events = new Events(); const pi = new PiClient();
  const ready = () => { if (!pi.url) pi.connect('http://127.0.0.1'); };
  pi.on('workspace', (packet) => events.emit('workspace', packet)); pi.on('terminal', (packet) => events.emit('terminal', packet));
  await native.addListener('transport', NativeSocket.receive.bind(NativeSocket));
  await native.addListener('challenge', ({ challenge }) => events.emit('challenge', challenge));
  await native.addListener('connection', ({ state }) => {
    if (state.phase === 'connected') ready(); else if (['connecting', 'error', 'idle'].includes(state.phase)) pi.disconnect();
    events.emit('connection', state);
  });
  await native.addListener('resume', () => events.emit('refresh', null));
  await CapacitorApp.addListener('backButton', () => {
    const handled = !window.dispatchEvent(new Event('remote-pi:back', { cancelable: true }));
    if (!handled) void CapacitorApp.minimizeApp();
  });
  return {
    getSettings: async () => (await native.settings()).settings,
    saveProfile: async (profile) => (await native.saveProfile({ profile })).profile,
    deleteProfile: (id) => native.deleteProfile({ id }),
    pickIdentity: async () => (await native.pickIdentity()).identity,
    setTheme: (theme) => native.setTheme({ theme }),
    getConnection: async () => { const { state } = await native.connection(); if (state.phase === 'connected') ready(); return state; },
    connect: async (profile) => { if ((await native.connect({ profile })).connected) ready(); },
    disconnect: async () => { pi.disconnect(); await native.disconnect(); },
    answerChallenge: (id, answer) => native.answer({ id, answer }),
    onConnection: (listener) => events.on('connection', listener),
    onChallenge: (listener) => events.on('challenge', listener),
    piRequest: (operation, input) => pi.request(operation, input),
    watchSession: (session, id) => pi.watchSession(session, id),
    unwatchSession: async (id) => pi.unwatch(id),
    onWorkspace: (listener) => events.on('workspace', listener),
    onWorkspaceRefresh: (listener) => events.on('refresh', listener),
    attachTerminal: (projectId, workspaceId, id, cols, rows) => pi.attachTerminal(projectId, workspaceId, id, cols, rows),
    detachTerminal: async (id) => pi.detachTerminal(id),
    terminalInput: (id, data) => pi.terminalFrame(id, { type: 'input', data }),
    terminalResize: (id, cols, rows) => pi.terminalFrame(id, { type: 'resize', cols, rows }),
    onTerminal: (listener) => events.on('terminal', listener),
    openLink: (url) => native.openPage({ url }),
  };
}
