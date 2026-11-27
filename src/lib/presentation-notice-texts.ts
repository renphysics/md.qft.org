import applicationLicense from '../../LICENSE?raw';
import revealLicense from '../../node_modules/reveal.js/LICENSE?raw';
import highlightLicense from '../../node_modules/highlight.js/LICENSE?raw';
import sourceSansProLicense from '../../node_modules/reveal.js/css/theme/fonts/source-sans-pro/LICENSE?raw';
import katexLicense from 'katex/LICENSE?raw';
import type { DeckKind } from './deck-types';
import { presentationNotices, type PresentationNotice } from './presentation-notices';

/** The licence files, as the build reads them from the installed packages. */
export const PRESENTATION_LICENCE_TEXTS = Object.freeze({
  application: applicationLicense,
  reveal: revealLicense,
  highlight: highlightLicense,
  katex: katexLicense,
  sourceSansPro: sourceSansProLicense,
});

/** The notices for the standalone copy of a presentation (see presentation-notices.ts). */
export function noticesForExport(html: string, kind: DeckKind | undefined): PresentationNotice[] {
  return presentationNotices(html, kind, PRESENTATION_LICENCE_TEXTS);
}
