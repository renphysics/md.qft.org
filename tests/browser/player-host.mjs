/**
 * A bare host page for the presentation player, shared by browser suites: the
 * runtime from src/lib/presentation-runtime.ts, bundled as the site bundles
 * it, playing through the production runner page (presentation-sandbox.html)
 * and its opaque sandbox. Suites drive it with window.play(), window.update()
 * and window.begin(), and read what the player reported from window.events.
 */
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { until } from './harness.mjs';

export async function runtimeBundle() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../../src/lib/presentation-runtime.ts', import.meta.url))],
    bundle: true, write: false, format: 'iife', globalName: 'QftRuntime', platform: 'browser', target: 'es2022',
  });
  return result.outputFiles[0].text;
}

/**
 * Each of play(), update() and begin() resolves with 'ready', or with
 * "<origin>: <message>" when the player reports an error. A fullscreen request
 * from the deck is carried out on #stage, as the library does, and recorded
 * with whether the page had user activation when it arrived. The #present
 * button shows the stage in fullscreen and hands the keyboard to the deck.
 */
export function hostPage(runtime) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Player test host</title>
<style>html,body{margin:0}#present{position:fixed;right:4px;bottom:4px}#stage{width:1280px;height:720px;background:#fff}#stage:fullscreen{width:100vw;height:100vh}#host{width:100%;height:100%}</style></head>
<body><button id="present" type="button">Present</button><main id="stage"><div id="host"></div></main><script>${runtime.replace(/<\/script/gi, '<\\/script')}</script><script>
const fresh = () => ({ states: [], errors: [], warnings: [], positions: [], slides: [], fullscreen: [] });
window.events = fresh();
let settle;
const pending = () => new Promise((resolve) => { settle = resolve; });
window.play = (html, profile = 'strict', start = {}) => {
  window.player?.destroy();
  window.events = fresh();
  const done = pending();
  const events = window.events;
  window.player = QftRuntime.createPresentationPlayer(document.getElementById('host'), html, {
    title: 'Test deck', profile,
    sandboxUrl: new URL('../presentation-sandbox.html', location.href).href,
    onState(state) { events.states.push(state); if (state === 'ready') settle?.('ready'); },
    onError(message, origin) { events.errors.push(origin + ': ' + message); settle?.(origin + ': ' + message); },
    onWarning(message) { events.warnings.push(message); },
    onPosition(position) { events.positions.push(position); },
    onSlides(count) { events.slides.push(count); },
    async onFullscreenRequest(request) {
      const entry = { request, active: navigator.userActivation.isActive, result: 'pending' };
      events.fullscreen.push(entry);
      try {
        if (request === 'enter' && !document.fullscreenElement) await document.getElementById('stage').requestFullscreen();
        else if (request === 'exit' && document.fullscreenElement) await document.exitFullscreen();
        entry.result = 'done';
        window.player.focus();
      } catch (error) { entry.result = error.message; }
    },
  });
  window.player.start(start);
  return done;
};
// As the library's Present button does: fullscreen for the stage, then the keyboard to the deck.
document.getElementById('present').addEventListener('click', () => document.getElementById('stage').requestFullscreen().then(() => window.player.focus()));
window.update = (html, options) => { const done = pending(); window.player.update(html, options); return done; };
window.begin = (options) => { const done = pending(); if (options === 'restart') window.player.restart(); else window.player.start(options); return done; };
</script></body></html>`;
}

/** Serve the host page at a private address under the preview server and open it. */
export async function openHost(t, context, page, path = '__player-host__/') {
  const url = new URL(path, t.baseUrl).href;
  const html = hostPage(await runtimeBundle());
  await context.route(url, (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
  await page.goto(url, { waitUntil: 'load' });
}

/** The live deck document: a blob: frame that contains `selector`. */
export async function deckFrame(page, selector = 'body > *') {
  return until(async () => {
    for (const frame of page.frames()) {
      if (!frame.isDetached() && frame.url().startsWith('blob:') && await frame.evaluate((query) => !!document.querySelector(query), selector).catch(() => false)) return frame;
    }
    return false;
  }, 'the deck frame');
}
