import { native, type SocketPacket } from './native';
type Listener = (event: { data?: string }) => void;
export class NativeSocket {
  static readonly OPEN = 1;
  private static sockets = new Map<string, NativeSocket>();
  readonly id = crypto.randomUUID();
  readyState = 0;
  private listeners = new Map<string, Set<Listener>>();
  constructor(url: string) {
    const parsed = new URL(url);
    NativeSocket.sockets.set(this.id, this);
    void native.openSocket({ id: this.id, path: parsed.pathname + parsed.search }).catch(() => NativeSocket.receive({ id: this.id, type: 'error' }));
  }
  addEventListener(type: string, listener: Listener): void { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type)!.add(listener); }
  private emit(type: string, data?: string): void { for (const listener of this.listeners.get(type) || []) listener({ data }); }
  send(data: string): void {
    if (this.readyState !== 1) throw new Error('连接尚未就绪。');
    void native.sendSocket({ id: this.id, data }).catch(() => NativeSocket.receive({ id: this.id, type: 'error' }));
  }
  close(): void {
    if (this.readyState === 3) return;
    this.readyState = 3; NativeSocket.sockets.delete(this.id);
    void native.closeSocket({ id: this.id }).catch(() => {}); this.emit('close');
  }
  static receive(packet: SocketPacket): void {
    const socket = this.sockets.get(packet.id); if (!socket) return;
    if (packet.type === 'open') { socket.readyState = 1; socket.emit('open'); }
    else if (packet.type === 'message') socket.emit('message', packet.data);
    else if (packet.type === 'error') { socket.emit('error'); socket.close(); }
    else { socket.readyState = 3; this.sockets.delete(packet.id); socket.emit('close'); }
  }
}
