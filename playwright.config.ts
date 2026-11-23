import { defineConfig } from '@playwright/test';

/**
 * One codebase, two platforms, many screen sizes.
 * webkit   = the engine behind Safari on iPhone
 * chromium = the engine behind Chrome on Android
 */
const IOS_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';

type Device = [name: string, engine: 'webkit' | 'chromium', width: number, height: number, largeText?: boolean];

const DEVICES: Device[] = [
  ['iphone-se-old-320', 'webkit', 320, 568],
  ['iphone-se-375', 'webkit', 375, 667],
  ['iphone-16-393', 'webkit', 393, 852],
  ['iphone-pro-max-440', 'webkit', 440, 956],
  ['iphone-landscape', 'webkit', 852, 393],
  ['ipad-768', 'webkit', 768, 1024],
  ['android-small-360', 'chromium', 360, 640],
  ['android-small-large-text', 'chromium', 360, 640, true],
  ['pixel-412', 'chromium', 412, 915],
  ['android-big-480', 'chromium', 480, 1040],
  ['android-landscape', 'chromium', 915, 412],
  ['android-fold-open-673', 'chromium', 673, 841],
];

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'e2e-results/artifacts',
  fullyParallel: true,
  workers: 6,
  timeout: 60_000,
  reporter: [['list']],
  webServer: {
    command: 'npm run build && npx vite preview --port 4188 --strictPort',
    url: 'http://localhost:4188/',
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: DEVICES.map(([name, engine, width, height, largeText]) => ({
    name,
    use: {
      browserName: engine,
      baseURL: 'http://localhost:4188/',
      viewport: { width, height },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      userAgent: engine === 'webkit' ? IOS_UA : ANDROID_UA,
      serviceWorkers: 'block' as const,
      colorScheme: 'dark' as const, // the app must stay light even when the phone is in dark mode
    },
    metadata: { largeText: !!largeText },
  })),
});
