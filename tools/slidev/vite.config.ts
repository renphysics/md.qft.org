import { defineConfig } from 'vite'

// This profile makes the production output suitable for pack.mjs. A source
// project still needs a Slidev build; the ZIP player does not compile Vue.
export default defineConfig({
  build: {
    cssCodeSplit: false,
    modulePreload: false,
    assetsInlineLimit: 128 * 1024 * 1024,
  },
})
