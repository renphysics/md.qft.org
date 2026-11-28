/**
 * The site's own Slidev example (public/slidev/interactive-physics.zip) by
 * content: the SHA-256 and byte size of the ZIP the site ships now, and of
 * every earlier version of it in this repository's history. When the example
 * is opened, a copy of an earlier version that a visitor saved in the browser
 * is replaced by the current one (presentation-library.ts). A package of the
 * visitor's own is never matched, whatever its name or title: only these
 * exact bytes are.
 *
 * When the ZIP is regenerated, move the CURRENT entry to the start of EARLIER
 * and enter the new ZIP's digest and size as CURRENT. tests/slidev-starter.test.ts
 * checks that CURRENT is the committed ZIP.
 */
export interface SlidevExampleVersion {
  /** SHA-256 of the ZIP, lowercase hexadecimal. */
  sha256: string;
  /** Size of the ZIP in bytes. */
  size: number;
}

/** The example that the site ships now. */
export const CURRENT_SLIDEV_EXAMPLE: SlidevExampleVersion = Object.freeze({
  sha256: '6dca6c89d27ca6fa1dc626e74888dfede4e917b70e634efc53db8ce66e61eadc', size: 1676251,
});

/**
 * Every earlier version, newest first. Versions that were never deployed are
 * listed too: the rule stays simple (every earlier version), and listing one
 * costs nothing.
 */
export const EARLIER_SLIDEV_EXAMPLES: readonly SlidevExampleVersion[] = Object.freeze([
  // 87a1b0c: every slide given its design; never deployed.
  { sha256: 'dd517a2022b37a7f4e1f8a89f5b75a7b3e9497d3276727a6360d35af6800aabf', size: 1676237 },
  // 7881c10: deployed until 2026-11-28; three slides without their design, "In phaseAt".
  { sha256: '37dbc3e5c68a0fa4fe877c296ed75deb51b440b9a2d63e03358ca6e27279c558', size: 1675649 },
  // 9a0d7ac: never deployed.
  { sha256: 'a27875260cf23fb4cef1e2be3b04b2309c442a82427656e465695ef9c32876cd', size: 1675461 },
  // 974fa5e: the first release (pull request 1).
  { sha256: '253fc3df46cdef85f1dc7cf33fee0687793e35cf02b93ad0240990e64b907eab', size: 1674968 },
].map((version) => Object.freeze(version)));

/** The earlier versions as the library element's data-example-earlier attribute reads them: "sha256:size" separated by spaces. */
export function earlierExamplesAttribute(versions: readonly SlidevExampleVersion[] = EARLIER_SLIDEV_EXAMPLES): string {
  return versions.map((version) => `${version.sha256}:${version.size}`).join(' ');
}
