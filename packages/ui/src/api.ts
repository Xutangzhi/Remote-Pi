import type { PiOperation } from '@remote-pi/core/pi';
import { getBridge } from './bridge';

export { sessionInput, sessionKey, sessionTitle, isWorking } from '@remote-pi/core/session';
export const piRequest = <T,>(operation: PiOperation, input?: Record<string, unknown>): Promise<T> => getBridge().piRequest(operation, input) as Promise<T>;
