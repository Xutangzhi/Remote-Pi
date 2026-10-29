import type { AppBridge } from '@remote-pi/core/types';

export const getBridge = (): AppBridge => (window as Window & { desktop: AppBridge }).desktop;
