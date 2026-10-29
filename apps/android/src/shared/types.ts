import type { AppBridge } from '@remote-pi/core/types';
export type { ServerProfile, Theme, ConnectionPhase, ConnectionState, AuthChallenge, AppSettings } from '@remote-pi/core/types';

export interface DesktopBridge extends AppBridge {}

declare global { interface Window { desktop: DesktopBridge; } }
