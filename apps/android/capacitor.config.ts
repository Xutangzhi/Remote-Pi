import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = { appId: 'dev.remotepi.android', appName: 'Remote Pi', webDir: 'dist', loggingBehavior: 'none', server: { androidScheme: 'https' }, android: { allowMixedContent: false, webContentsDebuggingEnabled: false }, plugins: { SystemBars: { insetsHandling: 'native' } } };
export default config;
