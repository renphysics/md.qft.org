import { createGlobVendorProvider, type VendorProvider } from './deck-vendor';

/**
 * The site's copies of Reveal.js and KaTeX for linked decks. Each script and
 * stylesheet is a separate lazy chunk, so a deck loads only what it uses, and
 * fonts are the site's own asset files. Nothing comes from a third party.
 * Keep this module out of Node tests: import.meta.glob exists only in Vite.
 */
const text = import.meta.glob([
  '../../node_modules/reveal.js/dist/reveal.js',
  '../../node_modules/reveal.js/dist/reset.css',
  '../../node_modules/reveal.js/dist/reveal.css',
  '../../node_modules/reveal.js/dist/theme/*.css',
  '../../node_modules/reveal.js/dist/plugin/{markdown,highlight,notes,search,zoom}.js',
  '../../node_modules/reveal.js/dist/plugin/highlight/*.css',
  '../../node_modules/katex/dist/katex.min.js',
  '../../node_modules/katex/dist/katex.min.css',
  '../../node_modules/katex/dist/contrib/{auto-render,mhchem,copy-tex}.min.js',
], {
  query: '?raw',
  import: 'default',
  // Vite otherwise excludes node_modules from glob matches.
  exhaustive: true,
}) as Record<string, () => Promise<unknown>>;

const urls = import.meta.glob('../../node_modules/katex/dist/fonts/*.woff2', {
  eager: true,
  exhaustive: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

/** A bundled font is small; anything larger is not one of ours. */
const MAX_FONT_BYTES = 1024 * 1024;

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { credentials: 'same-origin', cache: 'force-cache' });
  if (!response.ok) throw new Error('A bundled font could not be loaded. Reload the page and try again.');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > MAX_FONT_BYTES) throw new Error('A bundled font is unexpectedly large.');
  return bytes;
}

let provider: VendorProvider | undefined;

export function browserVendorProvider(): VendorProvider {
  provider ??= createGlobVendorProvider({ text, urls, fetchBytes });
  return provider;
}
