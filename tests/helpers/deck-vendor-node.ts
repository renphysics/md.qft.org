import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isBundledFile, isBundledTextFile, vendorFileKey, type VendorFile, type VendorProvider } from '../../src/lib/deck-vendor.ts';

export const NODE_MODULES = fileURLToPath(new URL('../../node_modules/', import.meta.url));

export interface NodeVendorProvider extends VendorProvider {
  /** Every bundled file read so far, as "library/path", in order. */
  readonly requested: string[];
}

/**
 * The bundled libraries read from node_modules, restricted to the files the
 * site bundles, so a test fails if the linker asks for anything else.
 */
export function nodeVendorProvider(root = NODE_MODULES): NodeVendorProvider {
  const requested: string[] = [];
  const read = async (file: VendorFile, text: boolean) => {
    if (!isBundledFile(file) || isBundledTextFile(file) !== text) return undefined;
    requested.push(vendorFileKey(file));
    try {
      const bytes = await readFile(join(root, file.library, file.path));
      return text ? bytes.toString('utf8') : new Uint8Array(bytes);
    } catch { return undefined; }
  };
  return {
    requested,
    text: async (file) => read(file, true) as Promise<string | undefined>,
    bytes: async (file) => read(file, false) as Promise<Uint8Array | undefined>,
  };
}
