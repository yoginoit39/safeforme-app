import { mkdirSync, writeFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vitest/config';

// Production-only Content-Security-Policy: the browser itself refuses any
// network call that is not one of the product databases or Google's Gemini API host.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "worker-src 'self'",
  "font-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob:",
  'connect-src https://world.openfoodfacts.org https://search.openfoodfacts.org https://world.openbeautyfacts.org https://world.openpetfoodfacts.org https://api.nal.usda.gov https://api.ods.od.nih.gov https://api.fda.gov https://generativelanguage.googleapis.com',
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

/** Local development only: receives the self-test report from the browser and saves it to a file. */
function selfTestPlugin(): Plugin {
  return {
    name: 'selftest-report',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__selftest', (req, res) => {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          mkdirSync('e2e-results', { recursive: true });
          writeFileSync('e2e-results/selftest.json', body);
          res.end('ok');
        });
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [cspPlugin(), selfTestPlugin()],
  test: { include: ['tests/**/*.test.ts'] },
});
