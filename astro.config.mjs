import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://md.qft.org',
  output: 'static',
  server: { allowedHosts: ['terminal.local'] },
  devToolbar: { enabled: false },
  build: { inlineStylesheets: 'never' },
  vite: {
    build: { assetsInlineLimit: 0 },
  },
});
