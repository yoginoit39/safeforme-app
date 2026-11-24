import type { CapacitorConfig } from '@capacitor/cli';

/** Store builds: the same web app, bundled inside a native Android or iOS shell. */
const config: CapacitorConfig = {
  appId: 'io.github.yoginoit39.greenlit',
  appName: 'Greenlit',
  webDir: 'dist',
  backgroundColor: '#fff7e8',
  android: { backgroundColor: '#fff7e8' },
  ios: { backgroundColor: '#fff7e8', contentInset: 'never' },
};

export default config;
