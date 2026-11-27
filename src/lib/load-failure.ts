/**
 * A part of the site that loads on demand (a script chunk or its stylesheet)
 * could not be fetched. The usual cause is a tab left open while a new
 * version was published: the old hashed file names are gone. A lost
 * connection looks the same. The browsers' own texts for this are technical
 * ("Failed to fetch dynamically imported module: …/_astro/x.js"), so every
 * place that turns a caught error into a notice asks this module first and
 * shows one fixed sentence instead. Nothing reloads by itself: the person may
 * have unsaved work on the page.
 */

export const LOAD_FAILURE_TEXT = 'A part of this site could not be loaded: the site was updated while this page was open, or the connection was lost. Reload the page to continue. Your saved presentations and documents are kept.';

/**
 * Chrome: "Failed to fetch dynamically imported module"; Firefox: "error
 * loading dynamically imported module"; Safari: "Importing a module script
 * failed"; Vite's preload helper: "Unable to preload CSS for …".
 */
const LOAD_FAILURE_MESSAGE = /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|unable to preload css/i;

/** True when the error says that a part of the site could not be fetched. */
export function isLoadFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { name, message } = error as { name?: unknown; message?: unknown };
  if (name === 'ChunkLoadError') return true;
  return typeof message === 'string' && LOAD_FAILURE_MESSAGE.test(message.slice(0, 300));
}

/** The text to show for a caught error: the fixed sentence for a load failure, else its own message, else the fallback. */
export function errorMessage(error: unknown, fallback: string): string {
  if (isLoadFailure(error)) return LOAD_FAILURE_TEXT;
  // Read like an Error from any realm (a frame, a test sandbox), not only by instanceof.
  const message = error && typeof error === 'object' ? (error as { message?: unknown }).message : undefined;
  return typeof message === 'string' && message ? message : fallback;
}

let watching = false;

/**
 * Vite announces a failed preload with a `vite:preloadError` event on window
 * before the import rejects. Listen once per page and tell the person; the
 * import still rejects, so the code that asked for it stops as well.
 */
export function watchLoadFailures(show: (text: string) => void): void {
  if (watching || typeof window === 'undefined') return;
  watching = true;
  window.addEventListener('vite:preloadError', () => show(LOAD_FAILURE_TEXT));
}
