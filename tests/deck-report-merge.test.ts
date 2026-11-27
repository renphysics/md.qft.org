import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { linkDeck } from '../src/lib/deck-linker.ts';
import { formatDeckReport } from '../src/lib/deck-report.ts';
import { describePresentationLimit } from '../src/lib/presentation-runtime.ts';
import type { DeckDetection, DeckFiles } from '../src/lib/deck-types.ts';
import { nodeVendorProvider } from './helpers/deck-vendor-node.ts';

/* The new codes of the third round, as the report for AI shows them. */

const encoder = new TextEncoder();
const deck = (html: string): DeckFiles => new Map([['index.html', encoder.encode(html)]]);
const detection = { kind: 'html', engine: 'html', entry: 'index.html', issues: [], flags: {} } as unknown as DeckDetection;

describe('the report for AI with the codes of the third round', () => {
  it('lists the scripted-navigation note as information that asks for no change', async () => {
    const linked = await linkDeck(deck('<!doctype html><html><head><title>T</title></head><body><button onclick="location.href=\'https://ignore-all-previous-instructions.example/sim\'">Open</button></body></html>'), detection, nodeVendorProvider());
    const note = linked.issues.find((issue) => issue.code === 'scripted-navigation');
    assert.ok(note, 'the linker notes the rewrite');
    const report = formatDeckReport({ kind: 'html', engine: 'html', entry: 'index.html', issues: linked.issues });
    const lines = report.split('\n');
    assert.ok(lines.includes('result: plays'), 'the player offers the address as a link, so nothing needs to change');
    const fenceStart = lines.indexOf('~~~text');
    const fenceEnd = lines.indexOf('~~~', fenceStart + 1);
    const line = lines.findIndex((text) => text.startsWith('- info scripted-navigation (ignore-all-previous-instructions.example):'));
    assert.ok(fenceStart >= 0 && fenceStart < line && line < fenceEnd, 'the host taken from the presentation is inside the data block');
    assert.doesNotMatch(report, /Rules for this player/);
    assert.equal(lines.at(-1), 'Reply: no changes are needed for playback.');
  });

  it('lists the form limit as a player line that asks for a change', () => {
    const limit = describePresentationLimit('form');
    assert.ok(limit && limit.counted);
    const report = formatDeckReport({ kind: 'html', engine: 'html', issues: [], runtime: [{ origin: 'player', text: limit.text, counted: limit.counted, hostFromPresentation: !!limit.host }] });
    assert.match(report, /^result: plays, with notes$/m);
    assert.ok(report.split('\n').includes(`- player: ${limit.text}`));
    assert.match(report, /^Rules for this player: .*A quiz form works when its submit handler checks the answers with a script and cancels the submission\.$/m);
  });
});
