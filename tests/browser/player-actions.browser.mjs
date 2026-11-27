/**
 * What a presentation does on a person's action, end to end in Chromium
 * through the real runtime, the production runner page and its opaque
 * sandbox: a quiz <form> (whose submit event the sandbox drops, as it has no
 * allow-forms) answers on a click and on Enter; a button that opens a
 * website with window.open() offers the address as a link; one that sets
 * location.href ends the playback, which the host is told once; links that
 * the deck cancels with returnValue or an onclick property that returns
 * false are not offered; and an error thrown without a value is no text of
 * the presentation's.
 */
import assert from 'node:assert/strict';
import { until } from './harness.mjs';
import { deckFrame, openHost } from './player-host.mjs';

export const title = 'Presentation actions in the player';

const events = (page) => page.evaluate(() => /** @type {any} */ (window).events);
const limitCodes = (reported) => reported.limits.map((limit) => (limit.host ? `${limit.code} ${limit.host}` : limit.code));

/**
 * Quiz forms as AI assistants write them. The inline onsubmit is written as
 * the linker writes inline handlers (the player's policy blocks attributes).
 */
const quiz = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Quiz forms</title></head><body>
<form id="listener"><label>2 + 2 = <input id="answer" name="answer"></label> <button id="check">Check</button></form><p id="feedback">-</p>
<form id="inline"><input id="inline-answer"><button id="inline-check" type="submit">Check</button></form><p id="inline-feedback">-</p>
<form id="required"><input id="name" required><button id="required-check">Send</button></form><p id="required-feedback">-</p>
<form id="plain"><input id="plain-answer"><input id="plain-check" type="submit" value="Send"></form>
<form id="nobutton"><input id="lonely"></form><p id="nobutton-feedback">-</p>
<form id="requested"><input id="requested-answer"></form><p id="requested-feedback">-</p>
<script>
document.getElementById('listener').addEventListener('submit', (event) => {
  event.preventDefault();
  document.getElementById('feedback').textContent = (document.getElementById('answer').value === '4' ? 'Correct!' : 'Try again') + ' by ' + (event.submitter ? event.submitter.id : 'none');
  window.submits = (window.submits || 0) + 1;
});
function check() { document.getElementById('inline-feedback').textContent = 'Checked ' + document.getElementById('inline-answer').value; return false; }
document.getElementById('inline').addEventListener('submit', function (event) { var result = function (event) { with (document) with (this.form || {}) with (this) { return check() } }.call(this, event); if (result === false) event.preventDefault(); });
document.getElementById('required').addEventListener('submit', (event) => { event.preventDefault(); document.getElementById('required-feedback').textContent = 'sent'; });
document.getElementById('nobutton').onsubmit = () => { document.getElementById('nobutton-feedback').textContent = 'implicit'; return false; };
document.getElementById('requested').addEventListener('submit', (event) => { event.preventDefault(); document.getElementById('requested-feedback').textContent = 'requested'; });
</script></body></html>`;

/** Buttons and links that act on a click. */
const actions = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Actions</title></head><body>
<button id="open" type="button">Open the simulation</button>
<a id="returnvalue" href="https://returnvalue.example/x">returnValue</a>
<a id="idl" href="https://idl.example/x">onclick returns false</a>
<a id="plain" href="https://plain.example/p">plain</a>
<button id="empty" type="button">throw an empty value</button>
<p id="out">-</p>
<script>
document.getElementById('open').addEventListener('click', () => { window.opened = window.open('https://phet.colorado.edu/sims/html/forces/latest/forces_en.html', '_blank'); });
document.getElementById('returnvalue').addEventListener('click', (event) => { event.returnValue = false; document.getElementById('out').textContent = 'rv handled'; });
const idl = document.getElementById('idl');
function more() { document.getElementById('out').textContent = 'idl handled'; return false; }
idl.onclick = more;
window.sameHandler = idl.onclick === more;
document.getElementById('empty').addEventListener('click', () => { setTimeout(() => { throw ''; }); });
// By itself, without the person: not a link.
// (Late enough that the test's own frame.evaluate calls, which count as user activation, have expired.)
setTimeout(() => { window.open('https://phet.colorado.edu/sims/html/forces/latest/forces_en.html'); }, 7000);
</script></body></html>`;

/** A button that sends the whole presentation to a website, and one that does so by itself on load. */
const navigating = (onLoad) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Navigation</title></head><body>
<button id="go" type="button">Open the simulation</button>
<script>
const go = () => { window.location.href = 'https://phet.colorado.edu/sims/html/forces-and-motion-basics/latest/forces-and-motion-basics_en.html'; };
document.getElementById('go').addEventListener('click', go);
${onLoad ? 'setTimeout(go, 300);' : ''}
</script></body></html>`;

export default async function run(t) {
  // Chromium's own notes on what the sandbox refuses: expected here.
  t.allowConsoleError(/Blocked form submission to '[^']*' because the form's frame is sandboxed/);
  t.allowConsoleError(/Framing 'https:\/\/phet\.colorado\.edu\/' violates the following Content Security Policy directive/);
  t.allowConsoleError(/Refused to frame 'https:\/\/phet\.colorado\.edu\/'/);
  t.allowPageError(/^$/);
  const { context, page } = await t.newPage({ viewport: { width: 1100, height: 700 } });
  await openHost(t, context, page);

  await t.step('A quiz form answers on a click on its button and on Enter in its field', async () => {
    assert.equal(await page.evaluate((html) => window.play(html, 'tolerant'), quiz), 'ready');
    const frame = await deckFrame(page, '#listener');
    await frame.locator('#answer').fill('4');
    await frame.locator('#check').click();
    await until(async () => (await frame.locator('#feedback').textContent()) === 'Correct! by check', 'the submit handler to answer the click');
    await frame.locator('#answer').fill('5');
    await frame.locator('#answer').press('Enter');
    await until(async () => (await frame.locator('#feedback').textContent()) === 'Try again by check', 'the submit handler to answer Enter');
    assert.equal(await frame.evaluate(() => /** @type {any} */ (window).submits), 2, 'once per action, never twice');
    await frame.locator('#inline-answer').fill('x');
    await frame.locator('#inline-check').click();
    await until(async () => (await frame.locator('#inline-feedback').textContent()) === 'Checked x', 'an inline onsubmit="return check()" to answer');
    assert.deepEqual(limitCodes(await events(page)), [], 'the presentation handled these forms itself');
  });

  await t.step('A required empty field stops the submission; requestSubmit() and implicit submission work too', async () => {
    const frame = await deckFrame(page, '#listener');
    await frame.locator('#required-check').click();
    await page.waitForTimeout(300);
    assert.equal(await frame.locator('#required-feedback').textContent(), '-', 'the browser\'s validation comes first');
    assert.equal(await frame.evaluate(() => document.getElementById('name').matches(':invalid')), true);
    await frame.locator('#name').fill('Ada');
    await frame.locator('#required-check').click();
    await until(async () => (await frame.locator('#required-feedback').textContent()) === 'sent', 'the filled form to be submitted');
    await frame.locator('#lonely').press('Enter');
    await until(async () => (await frame.locator('#nobutton-feedback').textContent()) === 'implicit', 'Enter in the only field of a form without a button');
    await frame.evaluate(() => document.getElementById('requested').requestSubmit());
    await until(async () => (await frame.locator('#requested-feedback').textContent()) === 'requested', 'requestSubmit() to fire the submit event');
    assert.equal(await frame.evaluate(() => { try { document.getElementById('requested').requestSubmit(document.getElementById('answer')); return 'no error'; } catch (error) { return error.name; } }),
      'TypeError', 'a submitter that is no submit button is refused as the browser refuses it');
    assert.deepEqual(limitCodes(await events(page)), []);
  });

  await t.step('A form that no handler stops gives one note: the player cannot send forms', async () => {
    const frame = await deckFrame(page, '#listener');
    await frame.locator('#plain-check').click();
    await until(async () => limitCodes(await events(page)).includes('form'), 'the form note');
    await frame.locator('#plain-answer').press('Enter');
    await frame.evaluate(() => document.getElementById('plain').submit());
    await page.waitForTimeout(300);
    const reported = await events(page);
    assert.deepEqual(limitCodes(reported), ['form'], 'once per playback');
    assert.equal(reported.limits[0].text, 'The presentation tried to send a form, which the player cannot do because it works offline. Ask your AI assistant to check the answers with a script on the slide instead.');
    assert.equal(reported.limits[0].counted, true);
    assert.equal(reported.states.at(-1), 'ready', 'the presentation keeps playing');
    assert.ok(frame.url().startsWith('blob:'));
  });

  await t.step('window.open() of a website after a click offers the address as a link; cancelled links are not offered', async () => {
    assert.equal(await page.evaluate((html) => window.play(html, 'tolerant'), actions), 'ready');
    const frame = await deckFrame(page, '#open');
    assert.equal(await frame.evaluate(() => /** @type {any} */ (window).sameHandler), true, 'onclick still reads as the function the deck assigned');
    // Without the person's action (a timer at load): still the new-window note.
    await until(async () => limitCodes(await events(page)).includes('new-window'), 'the new-window note without a click', 15_000);
    assert.deepEqual((await events(page)).links, []);
    await frame.locator('#open').click();
    await until(async () => (await events(page)).links.length === 1, 'the address to be offered');
    assert.deepEqual((await events(page)).links, ['https://phet.colorado.edu/sims/html/forces/latest/forces_en.html']);
    assert.equal(await frame.evaluate(() => /** @type {any} */ (window).opened), null);
    await frame.locator('#returnvalue').click();
    await frame.locator('#idl').click();
    await until(async () => (await frame.locator('#out').textContent()) === 'idl handled', 'the deck\'s own onclick to run');
    await frame.locator('#plain').click();
    await until(async () => (await events(page)).links.length === 2, 'the plain link to be offered');
    assert.deepEqual((await events(page)).links.slice(1), ['https://plain.example/p'], 'links the deck cancelled itself are not offered');
    assert.deepEqual(limitCodes(await events(page)), ['new-window']);
  });

  await t.step('An error thrown with an empty value is a step that failed without saying why', async () => {
    const frame = await deckFrame(page, '#open');
    await frame.locator('#empty').click();
    await until(async () => limitCodes(await events(page)).includes('failed-step'), 'the failed-step note');
    assert.deepEqual((await events(page)).warnings, [], 'no "Uncaught" as the presentation\'s words');
  });

  await t.step('A button that sends the presentation to a website ends the playback; the host is told once, with the host name', async () => {
    assert.equal(await page.evaluate((html) => window.play(html, 'tolerant', {}, { recordLeft: true }), navigating(false)), 'ready');
    const frame = await deckFrame(page, '#go');
    await frame.locator('#go').click();
    await until(async () => (await events(page)).lefts.length === 1, 'the host to be told');
    await page.waitForTimeout(500);
    const reported = await events(page);
    assert.deepEqual(reported.lefts, [{ host: 'phet.colorado.edu', active: true }], 'after the person\'s click');
    assert.deepEqual(reported.errors, []);
    // Without onLeft the player stops, in its own words.
    const stopped = await page.evaluate((html) => new Promise((resolve) => {
      window.play(html, 'tolerant').then((first) => { if (first !== 'ready') resolve(first); });
      const watch = setInterval(() => { if (/** @type {any} */ (window).events.errors.length) { clearInterval(watch); resolve(/** @type {any} */ (window).events.errors[0]); } }, 50);
    }), navigating(true));
    assert.equal(stopped, 'player: The presentation tried to replace its slides with a page from phet.colorado.edu, so the player stopped it. Choose Start to play it again. Ask your AI assistant to use an ordinary link for that page.');
    assert.equal(await page.evaluate(() => window.player.isRunning()), false);
    const passive = await page.evaluate(() => /** @type {any} */ (window).events.lefts);
    assert.deepEqual(passive, []);
  });
}
