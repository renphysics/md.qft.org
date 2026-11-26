import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, delimiter, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { convertSlidevFiles, createEsbuildBundler } from '../../src/lib/slidev-convert.ts';
import { SLIDEV_PROGRESS_TEXT } from '../../src/lib/slidev-convert-browser.ts';
import type { SlidevConverter } from '../../src/lib/deck-project.ts';
import type { DeckFiles } from '../../src/lib/deck-types.ts';

/** An ordinary `slidev build` (53.1.0, base "/", history router), zipped with its dist/ folder. See its NOTICE. */
export const SLIDEV_FIXTURE = fileURLToPath(new URL('../fixtures/slidev-default-build.zip', import.meta.url));

export function slidevFixtureFile(name = 'slidev-default-build.zip'): File {
  return new File([new Uint8Array(readFileSync(SLIDEV_FIXTURE)).buffer], name, { type: 'application/zip' });
}

/** The conversion's bundler on the native esbuild, as the Worker runs it on esbuild-wasm. */
export const nodeSlidevBundler = createEsbuildBundler(esbuild);

/** A BuildDeps.convertSlidev for Node: the same core as the Worker, in this thread. */
export function nodeSlidevConverter(): SlidevConverter {
  return async (files, detection, options) => {
    const { html, issues } = await convertSlidevFiles(files, detection, nodeSlidevBundler, {
      ...(options.signal ? { signal: options.signal } : {}),
      onProgress: (step) => options.onProgress?.(SLIDEV_PROGRESS_TEXT[step]),
    });
    return { html, issues };
  };
}

/** Every file below a folder, by POSIX path relative to it. */
export function filesFromFolder(folder: string, prefix = ''): DeckFiles {
  const files: DeckFiles = new Map();
  const walk = (directory: string) => {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) walk(path);
      else files.set(prefix + relative(folder, path).split('\\').join('/'), new Uint8Array(readFileSync(path)));
    }
  };
  walk(folder);
  return files;
}

/** Folders named by an environment variable, separated like PATH entries; none when it is unset. */
function folders(variable: string): string[] {
  return (process.env[variable] ?? '').split(delimiter).map((item) => item.trim()).filter(Boolean);
}

const isBuild = (folder: string) => existsSync(join(folder, 'index.html'));

/**
 * Further Slidev builds to convert, used only when QFT_SLIDEV_BUILDS names
 * them (for example the router and base-path variants and the Slidev 52
 * build from the research). Each listed folder is a build (it has
 * index.html), a project with its build in dist/, or a folder of those: its
 * subfolders that have index.html or dist/index.html.
 */
export function researchSlidevBuilds(): { name: string; folder: string }[] {
  const builds: { name: string; folder: string }[] = [];
  for (const root of folders('QFT_SLIDEV_BUILDS')) {
    if (isBuild(root)) { builds.push({ name: basename(root), folder: root }); continue; }
    if (isBuild(join(root, 'dist'))) { builds.push({ name: basename(root), folder: join(root, 'dist') }); continue; }
    if (!existsSync(root)) throw new Error(`QFT_SLIDEV_BUILDS names ${root}, which does not exist.`);
    for (const name of readdirSync(root).sort()) {
      const folder = join(root, name);
      if (!statSync(folder).isDirectory()) continue;
      if (isBuild(folder)) builds.push({ name, folder });
      else if (isBuild(join(folder, 'dist'))) builds.push({ name, folder: join(folder, 'dist') });
    }
  }
  return builds;
}

/**
 * The official create-slidev template built unchanged (Monaco, Web Workers,
 * 37 MB), from the dist folder that QFT_SLIDEV_MONACO_BUILD names. Undefined when unset.
 */
export function researchMonacoBuild(): string | undefined {
  const [folder] = folders('QFT_SLIDEV_MONACO_BUILD');
  if (!folder) return undefined;
  if (!isBuild(folder)) throw new Error(`QFT_SLIDEV_MONACO_BUILD names ${folder}, which has no index.html.`);
  return folder;
}
