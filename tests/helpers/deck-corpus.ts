import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';

/**
 * The two AI-made Reveal.js decks from the research report, kept inside
 * docs/research/presentation-platform/prototypes.zip (read, never changed):
 *  - ai-deck-1: an agent with npm vendored Reveal.js 6.0.2 and KaTeX;
 *  - ai-deck-2: a chat model linked Reveal.js 5.2.1 and its math plugin from jsDelivr.
 */
export const RESEARCH_DECKS = Object.freeze({
  'ai-deck-1-vendored-reveal6': { slides: 9, slider: '#sim-wavelength', readout: 'output[data-sim="wavelength-value"]' },
  'ai-deck-2-cdn-reveal5': { slides: 9, slider: '#sr-speed', readout: '#sr-speed-out' },
} as const);

export type ResearchDeckName = keyof typeof RESEARCH_DECKS;

const ARCHIVE = fileURLToPath(new URL('../../docs/research/presentation-platform/prototypes.zip', import.meta.url));

/** The deck ZIP as a File, or undefined when the research archive is absent. */
export function researchDeck(name: ResearchDeckName): File | undefined {
  if (!existsSync(ARCHIVE)) return undefined;
  const path = `test-decks/${name}.zip`;
  const entries = unzipSync(new Uint8Array(readFileSync(ARCHIVE)), { filter: (file) => file.name === path });
  const bytes = entries[path];
  return bytes ? new File([new Uint8Array(bytes).buffer], `${name}.zip`, { type: 'application/zip' }) : undefined;
}
