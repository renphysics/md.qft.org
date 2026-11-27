import { defineConfig } from 'astro/config';
import { resolveSiteUrl } from './scripts/site-url.mjs';

export default defineConfig({
  ...resolveSiteUrl(process.env.SITE_URL || undefined),
  output: 'static',
  trailingSlash: 'always',
  server: { allowedHosts: ['terminal.local'] },
  devToolbar: { enabled: false },
  build: { inlineStylesheets: 'never' },
  vite: {
    build: { assetsInlineLimit: 0 },
    // The Slidev converter runs as a module Worker (src/workers/slidev-convert.worker.ts).
    worker: { format: 'es' },
  },
});
