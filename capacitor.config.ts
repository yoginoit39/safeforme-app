import type { CapacitorConfig } from '@capacitor/cli';

/** Store builds: the same web app, bundled inside a native Android (and later iOS) shell. */
const config: CapacitorConfig = {
  appId: 'io.github.yoginoit39.safeforme',
  appName: 'SafeForMe',
  webDir: 'dist',
  backgroundColor: '#fff7e8',
  android: { backgroundColor: '#fff7e8' },
};

export default config;
