import { test } from 'node:test';
import assert from 'node:assert/strict';

const sockets = new Set<string>();
let finishOpen: () => void;
Object.assign(globalThis, { Capacitor: {
  PluginHeaders: [{ name: 'RemotePi', methods: ['openSocket', 'closeSocket'].map((name) => ({ name, rtype: 'promise' })) }],
  nativePromise: async (_plugin: string, method: string, { id }: { id: string }) => {
    if (method === 'openSocket') await new Promise<void>((resolve) => { finishOpen = () => { sockets.add(id); resolve(); }; });
    if (method === 'closeSocket') sockets.delete(id);
  },
} });
const { NativeSocket } = await import('../src/platform/native-socket');
const settle = () => new Promise((resolve) => setImmediate(resolve));

test('closing while the native open job is pending also closes the late native socket', async () => {
  const socket = new NativeSocket('ws://127.0.0.1/api/machines/local/events');
  let opened = 0; let closed = 0;
  socket.addEventListener('open', () => opened++); socket.addEventListener('close', () => closed++);
  await settle(); socket.close(); await settle();
  finishOpen(); await settle(); await settle();
  NativeSocket.receive({ id: socket.id, type: 'open' });
  assert.equal(sockets.size, 0);
  assert.equal(socket.readyState, 3); assert.equal(opened, 0); assert.equal(closed, 1);
});
