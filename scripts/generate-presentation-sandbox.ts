/** Regenerate public/presentation-sandbox.html after changing the runner in presentation-runtime.ts. */
import { writeFileSync } from 'node:fs';
import { presentationRunnerDocument } from '../src/lib/presentation-runtime';

const target = new URL('../public/presentation-sandbox.html', import.meta.url);
writeFileSync(target, `<!-- Generated from presentationRunnerDocument in src/lib/presentation-runtime.ts. -->\n${presentationRunnerDocument()}\n`);
console.log(`Wrote ${target.pathname}`);
