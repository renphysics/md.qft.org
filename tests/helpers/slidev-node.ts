import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { createEsbuildBundler } from '../../src/lib/slidev-convert.ts';
import type { DeckFiles } from '../../src/lib/deck-types.ts';

/** An ordinary `slidev build` (53.1.0, base "/", history router), zipped with its dist/ folder. See its NOTICE. */
export const SLIDEV_FIXTURE = fileURLToPath(new URL('../fixtures/slidev-default-build.zip', import.meta.url));

export function slidevFixtureFile(name = 'slidev-default-build.zip'): File {
  return new File([new Uint8Array(readFileSync(SLIDEV_FIXTURE)).buffer], name, { type: 'application/zip' });
}

/** The conversion's bundler on the native esbuild, as the Worker runs it on esbuild-wasm. */
export const nodeSlidevBundler = createEsbuildBundler(esbuild);

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

const RESEARCH = '/tmp/claude-0/-home-user-md-qft-org/62b03238-2ec2-5a4f-bd5c-e84ccde76ebd/scratchpad/research/proto';

/**
 * Slidev builds from the research, used only when present on this machine:
 * seven router and base-path variants of one deck (53.1.0), a new deck, the
 * same deck with a Mermaid diagram, and the deck built with Slidev 52.11.5.
 */
export function researchSlidevBuilds(): { name: string; folder: string }[] {
  const builds: { name: string; folder: string }[] = [];
  const coldInstall = join(RESEARCH, 'B2/cold-install');
  if (existsSync(coldInstall)) {
    for (const name of readdirSync(coldInstall).filter((item) => item.startsWith('dist-')).sort()) {
      builds.push({ name, folder: join(coldInstall, name) });
    }
  }
  for (const name of ['newdeck', 'newdeck-mermaid', 'old52']) {
    const folder = join(RESEARCH, 'V3', name, 'dist');
    if (existsSync(join(folder, 'index.html'))) builds.push({ name: `V3 ${name}`, folder });
  }
  return builds;
}

/** The official create-slidev template built unchanged: Monaco, Web Workers, 37 MB. Undefined when absent. */
export function researchMonacoBuild(): string | undefined {
  const folder = join(RESEARCH, 'B2/starter-deck/dist');
  return existsSync(join(folder, 'index.html')) ? folder : undefined;
}
