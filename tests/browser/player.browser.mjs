/**
 * The player's tolerant profile, end to end in Chromium: a small Reveal.js 6
 * deck, made by inlining node_modules/reveal.js/dist into one HTML string,
 * plays through the real runtime, the production runner page and its opaque
 * sandbox, with every request to another origin blocked. The same deck under
 * the strict profile still stops, as packages made with the site's tool do.
 *
 * Firefox is not run here. There, assigning location.hash inside the deck
 * throws a TypeError instead of being ignored; under the tolerant profile any
 * uncaught error is only a warning, which the "errors are warnings" step
 * checks with the same message.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tsImport } from 'tsx/esm/api';
import { until } from './harness.mjs';
import { deckFrame, openHost } from './player-host.mjs';

export const title = 'Tolerant presentation player';

const revealFile = (path) => readFile(fileURLToPath(new URL(`../../node_modules/reveal.js/dist/${path}`, import.meta.url)), 'utf8');
const scriptText = (code) => code.replace(/<\/script/gi, '<\\/script');

/**
 * Reveal's own template: hash: true, no id on the first slide, the notes
 * plugin. The deck also carries what the player must keep (title, body id and
 * a class with ">", attributes on <html>, the deck's own box model) and what
 * it must not trust: a "<body" string in a script, an inline handler, and a
 * picture that cannot be decoded.
 */
async function revealDeck({ heading = 'Waves', note = 'In phase', handler = true } = {}) {
  const [reset, styles, core, notes] = await Promise.all(['reset.css', 'reveal.css', 'reveal.js', 'plugin/notes.js'].map(revealFile));
  return `<!doctype html><html lang="en" data-deck="waves"><head><meta charset="utf-8"><title>Tolerant deck</title>
<script>window.decoy = '<body class="from-a-script-string" id="wrong">';</script>
<style>${reset}</style><style>${styles}</style><style>.probe{width:200px;padding:50px}</style></head>
<body id="deck-body" class="deck [&>p]:mt-2"${handler ? ' onload="window.inlineHandler = true"' : ''}>
<div class="reveal"><div class="slides">
<section><h1>${heading}</h1><p>First slide, without an id.</p></section>
<section><h2>Amplitudes add</h2><p class="fragment">${note}</p><p class="fragment">Out of phase</p><aside class="notes">Speaker note.</aside></section>
<section><section><h2>Stack top</h2></section><section><h2>Stack bottom</h2></section></section>
<section><h2>A broken picture</h2><img alt="Broken" src="data:image/png;base64,iVBORw0KGgo="></section>
</div></div>
<div class="probe" id="probe"></div>
<script>${scriptText(core)}</script><script>${scriptText(notes)}</script>
<script>Reveal.initialize({ hash: true, transition: 'none', plugins: [RevealNotes] });</script>
</body></html>`;
}

const events = (page) => page.evaluate(() => /** @type {any} */ (window).events);

/** The codes of the limits the player reported, with their host where they have one. */
const limitCodes = (reported) => reported.limits.map((limit) => (limit.host ? `${limit.code} ${limit.host}` : limit.code));

/**
 * A Reveal.js deck that does what AI-made lessons often do: read and write
 * document.cookie and call crypto.randomUUID before Reveal.initialize, give
 * feedback with alert(), ask with confirm() and prompt(), carry a caption
 * <track> whose file the linker could not keep, and a <noscript> fallback
 * with a web-font stylesheet and a picture.
 */
async function quizDeck() {
  const [reset, styles, core] = await Promise.all(['reset.css', 'reveal.css', 'reveal.js'].map(revealFile));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Quiz deck</title>
<style>${reset}</style><style>${styles}</style>
<noscript><link rel="stylesheet" href="https://fonts.example.invalid/css?family=Inter"><img src="fallback.png" alt=""></noscript></head>
<body><div class="reveal"><div class="slides">
<section><h1>Quiz</h1><button id="hint" type="button">Show hint</button><button id="two" type="button">Two hints</button>
<button id="ask" type="button">Your name</button><p id="answer"></p><video muted><track kind="captions" srclang="en" label="English" default></video></section>
<section><h2>Second slide</h2></section>
</div></div>
<script>${scriptText(core)}</script>
<script>
const visits = Number((document.cookie.match(/visits=(\\d+)/) || [0, 0])[1]) + 1;
document.cookie = 'visits=' + visits + '; path=/; max-age=31536000';
window.started = { cookie: document.cookie, uuid: crypto.randomUUID() };
document.getElementById('hint').addEventListener('click', () => { window.alertReturned = alert('Think about <b>phase</b>.\\nThen try again.'); });
document.getElementById('two').addEventListener('click', () => { alert('First hint'); alert('Second hint'); });
document.getElementById('ask').addEventListener('click', () => {
  const sure = confirm('Ready?');
  const name = prompt('Your name?');
  document.getElementById('answer').textContent = 'Hello ' + (name || '(nobody)') + (sure ? '' : ', not sure');
});
Reveal.initialize({ hash: true, transition: 'none' });
</script></body></html>`;
}

/**
 * The message box lives in a closed shadow root, which page scripts and
 * Playwright locators cannot enter; the DevTools protocol can. Returns the
 * box's text and whether its OK button has focus, or undefined without a box.
 */
async function messageBox(page, frame) {
  // The opaque deck frame usually runs in its own process, with its own session.
  const session = await page.context().newCDPSession(frame).catch(() => page.context().newCDPSession(page));
  try {
    const { root } = await session.send('DOM.getDocument', { depth: -1, pierce: true });
    const find = (node) => {
      if (node.nodeName === 'QFT-MESSAGE') return node;
      for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? []), ...(node.contentDocument ? [node.contentDocument] : [])]) {
        const found = find(child);
        if (found) return found;
      }
      return undefined;
    };
    const host = find(root);
    if (!host) return undefined;
    const shadow = host.shadowRoots?.[0];
    const texts = [];
    let button;
    const walk = (node, inText) => {
      if (node.nodeName === 'BUTTON') button = node;
      const text = inText || (node.attributes ?? []).some((value, index, list) => index % 2 === 0 && value === 'class' && list[index + 1] === 'text');
      if (node.nodeType === 3 && inText) texts.push(node.nodeValue);
      for (const child of node.children ?? []) walk(child, text);
    };
    walk(shadow, false);
    return { mode: shadow?.shadowRootType, text: texts.join(''), button: Boolean(button) };
  } finally { await session.detach(); }
}

async function revealFrame(page) {
  const frame = await deckFrame(page, '.reveal .slides');
  await until(() => frame.evaluate(() => /** @type {any} */ (window).Reveal?.isReady?.()), 'Reveal.js to be ready');
  return frame;
}

const indices = (frame) => frame.evaluate(() => Reveal.getIndices());

/** Press a key as a presenter does: no click into the deck first. */
async function press(page, key, position) {
  await page.keyboard.press(key);
  if (position) await until(async () => (await events(page)).positions.at(-1) === position, `the host to hear ${position} after ${key}`);
}

export default async function run(t) {
  const { exportPresentationHtml } = await tsImport('../../src/lib/presentation-runtime.ts', import.meta.url);
  // Deliberate failures inside the deck: Chromium reports them, the player must not stop.
  t.allowPageError(/Cannot set properties of null \(setting 'marked'\)/);
  t.allowPageError(/Late failure in a click handler|Rejected inside the deck|Location\.hash setter|notDefinedAnywhere/);
  t.allowConsoleError(/Blocked opening 'about:blank' in a new window because the request was made in a sandboxed frame/);
  t.allowConsoleError(/(?:Refused to load|Loading) the image 'https:\/\/images\.example\.invalid\//);
  t.allowBlockedRequest(/^https:\/\/images\.example\.invalid\//);
  // The strict profile stops at Reveal's refused History call, as before.
  t.allowPageError(/replaceState/);
  // Promise.reject() without a reason, on purpose.
  t.allowPageError(/^undefined$/);

  const deck = await revealDeck();
  const { context, page } = await t.newPage({ viewport: { width: 1320, height: 760 } });
  await openHost(t, context, page);

  let frame;
  await t.step('A Reveal.js deck with hash: true and no id on its first slide starts under the tolerant profile', async () => {
    assert.equal(await page.evaluate((html) => window.play(html, 'tolerant'), deck), 'ready');
    frame = await revealFrame(page);
    await until(async () => limitCodes(await events(page)).includes('missing-picture'), 'the broken picture to be a limit');
    const reported = await events(page);
    assert.deepEqual(reported.errors, []);
    assert.deepEqual(reported.states, ['stopped', 'loading', 'ready']);
    assert.deepEqual(reported.slides, [5]);
    assert.equal(reported.positions[0], '0/0');
    const fidelity = await frame.evaluate(() => ({
      title: document.title, id: document.body.id, classes: [...document.body.classList],
      deck: document.documentElement.dataset.deck, handler: document.body.getAttribute('onload'), inlineHandler: window.inlineHandler,
      // No box-sizing rule of the player's: 200px wide plus 2 x 50px padding.
      probe: document.getElementById('probe').offsetWidth,
    }));
    assert.equal(fidelity.title, 'Tolerant deck');
    assert.equal(fidelity.id, 'deck-body');
    assert.ok(fidelity.classes.includes('deck') && fidelity.classes.includes('[&>p]:mt-2'), fidelity.classes.join(' '));
    assert.ok(!fidelity.classes.includes('from-a-script-string'));
    assert.equal(fidelity.deck, 'waves');
    assert.equal(fidelity.handler, null);
    assert.equal(fidelity.inlineHandler, undefined);
    assert.equal(fidelity.probe, 300);
  });

  await t.step('The keyboard reaches the deck at once and the host follows slides and fragments', async () => {
    await until(() => frame.evaluate(() => document.hasFocus()), 'keyboard focus to reach the deck without a click', 10_000);
    await press(page, 'ArrowRight', '1/0');
    await press(page, 'ArrowRight', '1/0/0');
    await press(page, 'ArrowRight', '1/0/1');
    await press(page, 'ArrowRight', '2/0');
    await press(page, 'ArrowDown', '2/1');
    assert.deepEqual(await indices(frame), { h: 2, v: 1, f: undefined });
    // The guarded History calls still write the fragment Reveal.js asked for
    // (Reveal.js writes at most once a second).
    await until(() => frame.evaluate(() => location.hash === '#/2/1'), 'Reveal.js to write the slide into the address', 5_000);
    assert.equal(await page.evaluate(() => window.player.currentPosition()), '2/1');
  });

  await t.step('F asks the host for fullscreen, S only warns, and the deck keeps playing', async () => {
    await page.keyboard.press('f');
    await until(async () => (await events(page)).fullscreen[0]?.result === 'done', 'the host to enter fullscreen');
    const [request] = (await events(page)).fullscreen;
    assert.equal(request.request, 'enter');
    assert.equal(request.active, true, 'the key press in the deck gave the host user activation');
    assert.equal(await page.evaluate(() => document.fullscreenElement?.id), 'stage');
    await until(() => frame.evaluate(() => document.hasFocus()), 'the deck to keep the keyboard in fullscreen', 10_000);
    await press(page, 'ArrowUp', '2/0');
    await page.evaluate(() => document.exitFullscreen());
    await until(() => page.evaluate(() => !document.fullscreenElement), 'fullscreen to end');
    // Present from the host while the deck still has the keyboard: the
    // keyboard must stay with the deck.
    await page.getByRole('button', { name: 'Present' }).click();
    await until(() => page.evaluate(() => document.fullscreenElement?.id === 'stage'), 'Present to show the stage in fullscreen');
    await until(() => frame.evaluate(() => document.hasFocus()), 'the deck to take the keyboard after Present', 10_000);
    await press(page, 'ArrowDown', '2/1');
    await press(page, 'ArrowUp', '2/0');
    await page.evaluate(() => document.exitFullscreen());
    await until(() => page.evaluate(() => !document.fullscreenElement), 'fullscreen to end');

    await page.keyboard.press('s');
    await until(async () => limitCodes(await events(page)).includes('speaker-view'), 'the speaker view to be a limit');
    await page.keyboard.press('ArrowLeft');
    await until(async () => (await events(page)).positions.at(-1) === '1/0/1', 'the deck to keep playing after S');
    await page.keyboard.press('s');
    await page.keyboard.press('ArrowRight');
    await until(async () => (await events(page)).positions.at(-1) === '2/0', 'the deck to keep playing after a second S');
    const reported = await events(page);
    const speaker = reported.limits.filter((limit) => limit.code === 'speaker-view');
    assert.equal(speaker.length, 1, 'one per playback');
    assert.equal(speaker[0].counted, false, 'information, not a problem');
    assert.equal(speaker[0].text, 'The speaker view (S key) is not available in the player.');
    assert.ok(!reported.warnings.some((text) => /setting 'marked'|new window|speaker view/.test(text)), `no warning of the presentation's for it: ${reported.warnings.join(' | ')}`);
    await press(page, 'ArrowLeft', '1/0/1');
    assert.deepEqual(reported.errors, []);
    assert.equal(reported.states.at(-1), 'ready');
    assert.equal(await page.locator('#host iframe').count(), 1);
  });

  await t.step('Errors, rejections and blocked requests inside the deck are warnings', async () => {
    await frame.evaluate(() => {
      setTimeout(() => { throw new Error('Late failure in a click handler'); });
      // What Firefox throws when a deck assigns location.hash in a blob: document.
      setTimeout(() => { throw new TypeError("Location.hash setter: Access to 'blob:null/deck#x' from script denied."); });
      void Promise.reject(new Error('Rejected inside the deck'));
      const picture = new Image();
      picture.src = 'https://images.example.invalid/cat.png';
      document.body.append(picture);
    });
    const expected = [/Late failure in a click handler/, /Location\.hash setter/, /Rejected inside the deck/];
    await until(async () => {
      const reported = await events(page);
      return expected.every((pattern) => reported.warnings.some((text) => pattern.test(text))) && limitCodes(reported).includes('blocked-picture images.example.invalid');
    }, 'each problem of the deck to arrive as a warning, and the blocked picture as a limit');
    const reported = await events(page);
    assert.equal(reported.limits.find((limit) => limit.code === 'blocked-picture').text,
      'A picture from images.example.invalid needs the internet, so it is not shown. Put the file in the ZIP.');
    assert.ok(!reported.warnings.some((text) => /blocked|picture/i.test(text)), 'the player\'s own sentences are no warnings');
    assert.deepEqual(reported.errors, []);
    assert.equal(reported.states.at(-1), 'ready');
    assert.ok(reported.warnings.every((text) => typeof text === 'string' && text.length <= 350));
    await press(page, 'ArrowRight', '2/0');
  });

  await t.step('Cookies and randomUUID work, alert() shows a message box in the deck, confirm() and prompt() warn once', async () => {
    const quiz = await quizDeck();
    assert.equal(await page.evaluate((html) => window.play(html, 'tolerant'), quiz), 'ready');
    const quizFrame = await revealFrame(page);
    const started = await quizFrame.evaluate(() => /** @type {any} */ (window).started);
    assert.equal(started.cookie, 'visits=1');
    assert.match(started.uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.deepEqual(await quizFrame.evaluate(() => [typeof navigator.clipboard, typeof caches, typeof navigator.serviceWorker]), ['undefined', 'undefined', 'undefined'],
      'feature checks in decks still see what is missing');

    await quizFrame.click('#hint');
    await until(async () => (await messageBox(page, quizFrame))?.text === 'Think about <b>phase</b>.\nThen try again.', 'the alert text to show as text');
    assert.equal((await messageBox(page, quizFrame)).mode, 'closed');
    assert.equal(await quizFrame.evaluate(() => /** @type {any} */ (window).alertReturned), undefined);
    assert.equal(await quizFrame.evaluate(() => document.activeElement?.localName), 'qft-message', 'OK has the keyboard');
    // Keys go to the box, not to the deck or the host's Escape handling.
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Escape');
    await until(async () => (await messageBox(page, quizFrame)) === undefined, 'Escape to close the message');
    assert.deepEqual(await indices(quizFrame), { h: 0, v: 0, f: undefined }, 'no slide change while the message showed');
    assert.equal(await quizFrame.evaluate(() => Reveal.isOverview()), false, 'nor the overview that Escape opens');
    assert.equal((await events(page)).escapes, 0, 'that Escape did not reach the host');
    assert.equal(await quizFrame.evaluate(() => document.activeElement?.id), 'hint', 'focus goes back to the button');
    await page.screenshot({ path: resolve(t.artifacts, 'player-before-alert.png') });

    await quizFrame.click('#two');
    await until(async () => (await messageBox(page, quizFrame))?.text === 'First hint', 'the first of two messages');
    await page.screenshot({ path: resolve(t.artifacts, 'player-alert.png') });
    await page.keyboard.press('Enter');
    await until(async () => (await messageBox(page, quizFrame))?.text === 'Second hint', 'the queued second message');
    await page.keyboard.press(' ');
    await until(async () => (await messageBox(page, quizFrame)) === undefined, 'Space to close the last message');
    await page.keyboard.press('ArrowRight');
    await until(async () => (await indices(quizFrame)).h === 1, 'keys to reach the deck again');
    await page.keyboard.press('Escape');
    await until(async () => (await events(page)).escapes === 1, 'Escape to reach the host again');
    await until(() => quizFrame.evaluate(() => Reveal.isOverview()), 'Escape to reach the deck again (its overview)');
    await page.keyboard.press('Escape');
    await until(() => quizFrame.evaluate(() => !Reveal.isOverview()), 'the overview to close');
    await page.keyboard.press('ArrowLeft');
    await until(async () => (await indices(quizFrame)).h === 0, 'the first slide again');

    await quizFrame.click('#ask');
    await until(async () => (await quizFrame.locator('#answer').textContent()) === 'Hello (nobody), not sure', 'confirm and prompt to answer as the sandbox does');
    await quizFrame.click('#ask');
    await until(async () => limitCodes(await events(page)).includes('question'), 'the question limit');
    await page.waitForTimeout(500);
    const reported = await events(page);
    assert.equal(limitCodes(reported).filter((code) => code === 'question').length, 1, 'one per playback');
    assert.ok(!limitCodes(reported).some((code) => code.startsWith('missing-')), `no note for the caption track: ${limitCodes(reported).join(' | ')}`);
    assert.deepEqual(reported.errors, []);
  });

  await t.step('A <noscript> fallback does not stop a deck under either profile', async () => {
    const plain = '<!doctype html><html><head><title>Plain</title><noscript><link rel="stylesheet" href="https://fonts.example.invalid/css"></noscript></head><body><noscript><img src="p.png" alt=""></noscript><p>Plain page</p></body></html>';
    for (const profile of ['strict', 'tolerant']) assert.equal(await page.evaluate(([html, value]) => window.play(html, value), [plain, profile]), 'ready', profile);
    const plainFrame = await deckFrame(page, 'p');
    assert.equal(await plainFrame.evaluate(() => document.querySelectorAll('noscript').length), 0);
    // Back to the Reveal.js deck for the next steps.
    assert.equal(await page.evaluate((html) => window.play(html, 'tolerant'), deck), 'ready');
    frame = await revealFrame(page);
    await frame.evaluate(() => Reveal.slide(2, 0));
    await until(async () => (await events(page)).positions.at(-1) === '2/0', 'the host to hear 2/0');
  });

  await t.step('update() replays an edited deck at the same slide and fragment', async () => {
    await frame.evaluate(() => Reveal.slide(1, 0, 1));
    await until(async () => (await events(page)).positions.at(-1) === '1/0/1', 'the host to hear 1/0/1');
    const edited = await revealDeck({ heading: 'Waves, edited', note: 'In phase, edited' });
    assert.equal(await page.evaluate((html) => /** @type {any} */ (window).update(html), edited), 'ready');
    frame = await revealFrame(page);
    assert.deepEqual(await indices(frame), { h: 1, v: 0, f: 1 });
    assert.equal(await frame.locator('.reveal .slides p.fragment').first().textContent(), 'In phase, edited');
    assert.equal((await events(page)).positions.at(-1), '1/0/1');

    await frame.evaluate(() => Reveal.slide(2, 1));
    await until(async () => (await events(page)).positions.at(-1) === '2/1', 'the host to hear 2/1');
    assert.equal(await page.evaluate((html) => /** @type {any} */ (window).update(html), deck), 'ready');
    frame = await revealFrame(page);
    assert.deepEqual(await indices(frame), { h: 2, v: 1, f: undefined });
    assert.equal(await frame.locator('h1').textContent(), 'Waves');
    await until(() => frame.evaluate(() => document.hasFocus()), 'the replayed deck to take the keyboard', 10_000);
    await press(page, 'ArrowUp', '2/0');
  });

  await t.step('start() opens the deck at a given slide; Restart begins at the first', async () => {
    assert.equal(await page.evaluate(() => window.begin({ position: '3/0' })), 'ready');
    frame = await revealFrame(page);
    assert.deepEqual(await indices(frame), { h: 3, v: 0, f: undefined });
    assert.equal(await page.evaluate(() => window.begin('restart')), 'ready');
    frame = await revealFrame(page);
    assert.deepEqual(await indices(frame), { h: 0, v: 0, f: undefined });
    await page.screenshot({ path: resolve(t.artifacts, 'player-tolerant.png') });
  });

  await t.step('The same deck under the strict profile still stops as before', async () => {
    const result = await page.evaluate((html) => window.play(html, 'strict'), deck);
    assert.match(result, /^presentation: /);
    const reported = await events(page);
    assert.equal(reported.states.at(-1), 'error');
    assert.deepEqual(reported.warnings, []);
    assert.equal(await page.locator('#host iframe').count(), 0, 'the deck is removed');
    await page.evaluate(() => window.player.destroy());
  });

  await t.step('A tolerant standalone export plays offline, and F in the deck makes it fullscreen', async () => {
    // The export page's own policy reports any inline handler attribute while
    // the deck is parsed (inertly) for playback; linked decks have none.
    const exported = exportPresentationHtml(await revealDeck({ handler: false }), 'Waves', { profile: 'tolerant' });
    const url = new URL('__tolerant-export__/', t.baseUrl).href;
    await context.route(url, (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: exported }));
    const standalone = t.observe(await context.newPage());
    await standalone.goto(url, { waitUntil: 'load' });
    await standalone.getByRole('button', { name: 'Start presentation' }).click();
    await until(async () => (await standalone.locator('#status').textContent()) === 'Live · use the slide controls or arrow keys', 'the export to play');
    const exportedFrame = await revealFrame(standalone);
    await until(() => exportedFrame.evaluate(() => document.hasFocus()), 'the exported deck to take the keyboard', 10_000);
    await standalone.keyboard.press('ArrowRight');
    await until(async () => (await indices(exportedFrame)).h === 1, 'the arrow key to change slides');
    await standalone.keyboard.press('f');
    await until(() => standalone.evaluate(() => document.fullscreenElement?.id === 'stage'), 'the export to enter fullscreen');
    assert.notEqual(await standalone.locator('#status').textContent(), 'Fullscreen is unavailable. Use the browser fullscreen command.');
    await standalone.keyboard.press('ArrowRight');
    await until(async () => (await indices(exportedFrame)).f === 0, 'the deck to keep the keyboard in fullscreen');
    await standalone.evaluate(() => document.exitFullscreen());
    await standalone.close();
  });

  await t.step('A page that only uses a "reveal" class is no stalled deck, and its website links reach the host only when clicked', async () => {
    const page2 = '<!doctype html><html><head><title>Scroll page</title></head><body><div class="reveal">Fades in</div><p><a id="out" href="https://phet.colorado.edu/en/simulations">PhET</a> <a id="file" href="notes.pdf">Notes</a></p><script>window.notDefinedAnywhere();</script></body></html>';
    assert.equal(await page.evaluate((html) => window.play(html, 'tolerant'), page2), 'ready');
    const pageFrame = await deckFrame(page, '#out');
    assert.equal(await pageFrame.locator('#out').getAttribute('href'), 'https://phet.colorado.edu/en/simulations', 'the address is kept');
    assert.equal(await pageFrame.locator('#file').getAttribute('href'), null);
    await pageFrame.locator('#file').click();
    await pageFrame.locator('#out').click();
    await until(async () => (await events(page)).links.length === 1, 'the link to reach the host');
    await page.waitForTimeout(2600);
    const reported = await events(page);
    assert.deepEqual(reported.links, ['https://phet.colorado.edu/en/simulations']);
    assert.deepEqual(reported.stalls, [], 'no Reveal.js slides, so no stall');
    assert.equal(await pageFrame.evaluate(() => location.protocol), 'blob:', 'the page did not navigate');
    await page.evaluate(() => window.player.destroy());
  });

  await t.step("One picture from the internet gives one note, and the deck's own texts stay its own", async () => {
    const html = '<!doctype html><html><head><title>Pictures</title></head><body><p id="text">Pictures</p><script>'
      + 'const late = new Image(); late.src = "https://images.example.invalid/late.png";'
      + 'const shown = document.createElement("img"); shown.src = "https://images.example.invalid/shown.png"; document.body.append(shown);'
      + 'void Promise.reject();</script></body></html>';
    assert.equal(await page.evaluate((value) => window.play(value, 'tolerant'), html), 'ready');
    await until(async () => limitCodes(await events(page)).includes('blocked-picture images.example.invalid'), 'the blocked picture');
    await page.waitForTimeout(1200);
    const reported = await events(page);
    assert.deepEqual(limitCodes(reported).sort(), ['blocked-picture images.example.invalid', 'failed-step'], 'no second note for the same pictures');
    assert.deepEqual(reported.warnings, [], 'a rejection without a message is the player\'s sentence, not the deck\'s');
    await page.evaluate(() => window.player.destroy());
  });

  await t.step('Links: a trusted click or middle click is offered; a scripted click, a link the deck handles itself and an over-long link are not', async () => {
    const long = `https://example.org/${'a'.repeat(2100)}`;
    const html = `<!doctype html><html><head><title>Links</title></head><body>
<p><a id="web" href="https://example.org/web">Web</a> <a id="middle" href="https://example.org/middle">Middle</a>
<a id="own" href="https://example.org/own">Handled by the page</a> <a id="scripted" href="https://example.org/scripted">Scripted</a>
<a id="long" href="${long}">Long</a></p><p id="out"></p>
<script>document.getElementById('own').addEventListener('click', (event) => { event.preventDefault(); document.getElementById('out').textContent = 'handled'; });</script>
</body></html>`;
    assert.equal(await page.evaluate((value) => window.play(value, 'tolerant'), html), 'ready');
    const linkFrame = await deckFrame(page, '#web');
    await linkFrame.locator('#own').click();
    await until(async () => (await linkFrame.locator('#out').textContent()) === 'handled', 'the page to handle its own link');
    await linkFrame.evaluate(() => document.getElementById('scripted').click());
    await linkFrame.locator('#long').click();
    await linkFrame.locator('#middle').click({ button: 'middle' });
    await until(async () => (await events(page)).links.length === 1, 'the middle click to be offered');
    await linkFrame.locator('#web').click();
    await until(async () => (await events(page)).links.length === 2, 'the click to be offered');
    await page.waitForTimeout(500);
    const reported = await events(page);
    assert.deepEqual(reported.links, ['https://example.org/middle', 'https://example.org/web']);
    assert.deepEqual(limitCodes(reported), ['link-too-long']);
    assert.equal(await linkFrame.evaluate(() => location.protocol), 'blob:', 'nothing navigated');
    await page.evaluate(() => window.player.destroy());
  });

  await t.step('A long message keeps OK in view in a frame 286 by 161 pixels, and the slides behind it are inert', async () => {
    await page.evaluate(() => { const stage = document.getElementById('stage'); stage.style.width = '286px'; stage.style.height = '161px'; });
    const html = `<!doctype html><html><head><title>Message</title></head><body><main id="slides"><button id="ask" type="button">Ask</button></main><aside id="already" inert>Kept inert</aside>
<script>document.getElementById('ask').addEventListener('click', () => alert(${JSON.stringify('A long explanation. '.repeat(100))}));</script></body></html>`;
    assert.equal(await page.evaluate((value) => window.play(value, 'tolerant'), html), 'ready');
    const boxFrame = await deckFrame(page, '#ask');
    await boxFrame.locator('#ask').click();
    await until(async () => (await messageBox(page, boxFrame))?.button, 'the message box');
    const session = await page.context().newCDPSession(boxFrame).catch(() => page.context().newCDPSession(page));
    try {
      const { root } = await session.send('DOM.getDocument', { depth: -1, pierce: true });
      const find = (node) => {
        if (node.nodeName === 'BUTTON' && node.children?.some((child) => child.nodeValue === 'OK')) return node;
        for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? []), ...(node.contentDocument ? [node.contentDocument] : [])]) {
          const found = find(child);
          if (found) return found;
        }
        return undefined;
      };
      const button = find(root);
      assert.ok(button, 'the OK button');
      const { model } = await session.send('DOM.getBoxModel', { nodeId: button.nodeId });
      const ys = model.border.filter((_, index) => index % 2 === 1);
      const viewport = await boxFrame.evaluate(() => innerHeight);
      assert.ok(Math.min(...ys) >= 0 && Math.max(...ys) <= viewport, `OK at ${ys.join(',')} in a frame ${viewport} pixels high`);
    } finally { await session.detach(); }
    await page.screenshot({ path: resolve(t.artifacts, 'player-message-small.png'), clip: { x: 0, y: 0, width: 300, height: 175 } });
    assert.deepEqual(await boxFrame.evaluate(() => [document.getElementById('slides').inert, document.getElementById('already').inert]), [true, true]);
    await page.keyboard.press('Enter');
    await until(async () => (await messageBox(page, boxFrame)) === undefined, 'OK to close the box');
    assert.deepEqual(await boxFrame.evaluate(() => [document.getElementById('slides').inert, document.getElementById('already').inert]), [false, true],
      'exactly what was inert before stays so');
    await page.evaluate(() => { window.player.destroy(); const stage = document.getElementById('stage'); stage.style.width = ''; stage.style.height = ''; });
  });

  await t.step('Nothing left the page', async () => {
    assert.deepEqual(t.externalRequests, []);
  });
}
