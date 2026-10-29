export interface ServerProfile {
  id: string;
  name: string;
  host: string;
  username: string;
  port: number | null;
  identityFile: string;
  remotePort: number;
}

export type Theme = 'light' | 'dark';
export type ConnectionPhase = 'idle' | 'connecting' | 'authenticating' | 'checking' | 'connected' | 'error';
export interface ConnectionState {
  phase: ConnectionPhase;
  profileId?: string;
  message: string;
  errorCode?: 'ssh' | 'service' | 'cancelled';
  connectedAt?: number;
}
export interface AuthChallenge { id: string; prompt: string; kind: 'host' | 'secret'; }
export interface AppSettings { profiles: ServerProfile[]; theme: Theme; }
export interface AppBridge {
  getSettings(): Promise<AppSettings>;
  saveProfile(profile: ServerProfile): Promise<ServerProfile>;
  deleteProfile(id: string): Promise<void>;
  pickIdentity(): Promise<string | null>;
  connect(profile: ServerProfile): Promise<void>;
  disconnect(): Promise<void>;
  answerChallenge(id: string, answer: string | null): Promise<void>;
  setTheme(theme: Theme): Promise<void>;
  piRequest(operation: PiOperation, input?: Record<string, unknown>): Promise<unknown>;
  watchSession(session: SessionRef, subscriptionId: string): Promise<void>;
  unwatchSession(subscriptionId: string): Promise<void>;
  onWorkspace(listener: (packet: WorkspacePacket) => void): () => void;
  attachTerminal(projectId: string, workspaceId: string, subscriptionId: string, cols: number, rows: number): Promise<void>;
  terminalInput(subscriptionId: string, data: string): void;
  terminalResize(subscriptionId: string, cols: number, rows: number): void;
  detachTerminal(subscriptionId: string): Promise<void>;
  onTerminal(listener: (packet: TerminalPacket) => void): () => void;
  openLink(url: string): Promise<void>;
  onWorkspaceRefresh(listener: () => void): () => void;
  getConnection(): Promise<ConnectionState>;
  onConnection(listener: (state: ConnectionState) => void): () => void;
  onChallenge(listener: (challenge: AuthChallenge | null) => void): () => void;
}

import type { PiOperation, SessionRef, TerminalPacket, WorkspacePacket } from './pi';
