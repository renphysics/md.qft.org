import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';
import type { DeckFiles } from '../../src/lib/deck-types.ts';

/** Small hand-written decks; none contains third-party library files. */
export const FIXTURE_DECKS = Object.freeze([
  'cdn-reveal5-single',
  'cdn-reveal4-cdnjs',
  'cdn-reveal6-unpkg',
  'local-project',
  'esm-project',
  'plain-html',
  'slidev-source',
  'not-a-deck',
] as const);

export type FixtureDeckName = typeof FIXTURE_DECKS[number];

export const FIXTURE_ROOT = fileURLToPath(new URL('../fixtures/decks/', import.meta.url));

function walk(folder: string, root: string, files: DeckFiles): void {
  for (const item of readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(folder, item.name);
    if (item.isDirectory()) walk(path, root, files);
    else if (item.isFile()) files.set(relative(root, path).split(sep).join('/'), new Uint8Array(readFileSync(path)));
  }
}

/** A fixture as deck files: POSIX paths relative to its folder, sorted. */
export function loadFixtureDeck(name: FixtureDeckName): DeckFiles {
  const root = join(FIXTURE_ROOT, name);
  const files: DeckFiles = new Map();
  walk(root, root, files);
  if (!files.size) throw new Error(`Fixture deck "${name}" is empty.`);
  return files;
}

export interface ZipFixtureOptions {
  /** Put every file under this folder, as archivers do when zipping a folder. */
  wrap?: string;
  /** Extra or replacement entries, by archive path (applied after wrapping). */
  extra?: Record<string, Uint8Array>;
  fileName?: string;
  level?: 0 | 6;
}

/** A fixture zipped into a File, as a person would choose it in the browser. */
export function zipFixture(name: FixtureDeckName, options: ZipFixtureOptions = {}): File {
  const prefix = options.wrap ? options.wrap.replace(/\/?$/, '/') : '';
  const entries: Record<string, Uint8Array> = {};
  for (const [path, bytes] of loadFixtureDeck(name)) entries[prefix + path] = bytes;
  Object.assign(entries, options.extra);
  const zip = zipSync(entries, { level: options.level ?? 6 });
  return new File([new Uint8Array(zip).buffer], options.fileName ?? `${name}.zip`, { type: 'application/zip' });
}

/** A single-file fixture's HTML as a File, as a person would choose it. */
export function htmlFixture(name: FixtureDeckName, path = 'index.html', fileName = `${name}.html`): File {
  const bytes = loadFixtureDeck(name).get(path);
  if (!bytes) throw new Error(`Fixture deck "${name}" has no ${path}.`);
  return new File([new Uint8Array(bytes).buffer], fileName, { type: 'text/html' });
}
