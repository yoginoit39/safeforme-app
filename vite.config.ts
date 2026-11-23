import { defineConfig, type Plugin } from 'vitest/config';

// Production-only Content-Security-Policy: the browser itself refuses any
// network call that is not Open Food Facts or Google's Gemini API host.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "worker-src 'self'",
  "font-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob:",
  'connect-src https://world.openfoodfacts.org https://generativelanguage.googleapis.com',
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

function cspPlugin(): Plugin {
  return {
    name: 'inject-csp',
    apply: 'build',
    transformIndexHtml(html, ctx) {
      // Fetch the headline font alongside the page instead of after the stylesheet.
      const font = Object.keys(ctx.bundle ?? {}).find((f) => /fraunces-latin-wght-normal.*\.woff2$/.test(f));
      const preload = font ? `\n    <link rel="preload" href="./${font}" as="font" type="font/woff2" crossorigin />` : '';
      return html.replace(
        '<!--CSP-->',
        `<meta http-equiv="Content-Security-Policy" content="${CSP}" />${preload}`,
      );
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [cspPlugin()],
  test: { include: ['tests/**/*.test.ts'] },
});
