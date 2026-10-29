import type { AppBridge } from '@remote-pi/core/types';
export type { ServerProfile, Theme, ConnectionPhase, ConnectionState, AuthChallenge, AppSettings } from '@remote-pi/core/types';

export interface EnvironmentRefresh { phase: 'checking' | 'reading' | 'syncing' | 'restarting' | 'verifying' | 'rollback' | 'done' | 'error'; message: string; }
export interface DesktopBridge extends AppBridge {
  refreshEnvironment(): Promise<void>;
  getEnvironmentRefresh(): Promise<EnvironmentRefresh | null>;
  onEnvironmentRefresh(listener: (state: EnvironmentRefresh) => void): () => void;
}

declare global { interface Window { desktop: DesktopBridge; } }
