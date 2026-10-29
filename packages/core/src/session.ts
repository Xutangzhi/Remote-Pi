import type { SessionInfo, SessionRef } from './pi';

export const sessionInput = (session: SessionRef): Record<string, unknown> => ({ id: session.id, cwd: session.cwd });
export const sessionKey = (session: SessionRef): string => `${session.cwd}\0${session.id}`;
export const sessionTitle = (session: SessionInfo): string => session.name || session.firstMessage?.replace(/\s+/g, ' ').slice(0, 80) || '新对话';
export const isWorking = (status?: { isStreaming: boolean; isCompacting: boolean; isBashRunning: boolean; pendingMessageCount?: number }): boolean => Boolean(status?.isStreaming || status?.isCompacting || status?.isBashRunning || (status?.pendingMessageCount ?? 0) > 0);
