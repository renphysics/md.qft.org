import { rmSync } from 'node:fs';

// Publish only the current build, including when the deployment URL changes.
rmSync(new URL('../dist/', import.meta.url), { recursive: true, force: true });
