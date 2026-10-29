import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { AppSettings, AuthChallenge, ConnectionState, ServerProfile, Theme } from '../shared/types';
export interface SocketPacket { id: string; type: 'open' | 'message' | 'close' | 'error'; data?: string; message?: string; }
interface NativePlugin {
  settings(): Promise<{ settings: AppSettings }>;
  saveProfile(options: { profile: ServerProfile }): Promise<{ profile: ServerProfile }>;
  deleteProfile(options: { id: string }): Promise<void>;
  pickIdentity(): Promise<{ identity: string | null }>;
  setTheme(options: { theme: Theme }): Promise<void>;
  connection(): Promise<{ state: ConnectionState }>;
  connect(options: { profile: ServerProfile }): Promise<{ connected: boolean }>;
  disconnect(): Promise<void>;
  answer(options: { id: string; answer: string | null }): Promise<void>;
  request(options: { path: string; method: string; body?: unknown; image?: boolean; timeoutMs?: number }): Promise<{ data: string }>;
  openSocket(options: { id: string; path: string }): Promise<void>;
  sendSocket(options: { id: string; data: string }): Promise<void>;
  closeSocket(options: { id: string }): Promise<void>;
  openPage(options: { url: string }): Promise<void>;
  addListener(name: 'connection', callback: (event: { state: ConnectionState }) => void): Promise<PluginListenerHandle>;
  addListener(name: 'challenge', callback: (event: { challenge: AuthChallenge | null }) => void): Promise<PluginListenerHandle>;
  addListener(name: 'transport', callback: (event: SocketPacket) => void): Promise<PluginListenerHandle>;
  addListener(name: 'resume', callback: () => void): Promise<PluginListenerHandle>;
}
export const native = registerPlugin<NativePlugin>('RemotePi');
