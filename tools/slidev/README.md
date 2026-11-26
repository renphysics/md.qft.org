# Portable Slidev presentations for QFT Markdown

This is a real Slidev project, an interactive teaching example, and a packaging
tool for the local ZIP player at **https://md.qft.org/**. Its source is MIT
licensed. The included example explains coherent-wave interference with a
Vue component whose phase slider, animation, and intensity readout run in the
browser.

## Packager or an ordinary build?

You do not need this packager to play Slidev on md.qft.org. The site's
**Create with AI → Slidev** instructions ask an AI assistant that can run
commands for an ordinary Slidev project and one ZIP of the project folder with
the built `dist/` inside and without `node_modules`; a ZIP of the `dist`
folder alone opens too. The site converts the build in the browser each time
it is opened, leaves out remote resources such as Google Fonts, and plays it
with a player profile that reports script errors as notes instead of
stopping. Builds that use live code editors (Monaco code blocks) or Web
Workers are refused, a picture or file that the build lacks is named in the
notes, and conversion depends on the build output of recent Slidev releases
(checked with 52 and 53).

Use this starter and packager when you want more than that: a package that
carries its editable source, plays exactly the compiled HTML you checked
(nothing is converted when it opens), and stops at the first error so a
broken build is noticed before class. Both kinds are read-only on the site;
edit the project, build again, and open the new ZIP.

## Make a presentation

Use Node.js 22.22 or newer (Slidev 53.1.0 requires it). In this directory:

```sh
npm ci
npm run dev
```

Edit `slides.md` and `components/QuantumInterference.vue`, or add your own Vue
components. Keep the portable configuration in the document headmatter and
`vite.config.ts`.

Build the presentation, then package the build and editable source:

```sh
npm run build
node pack.mjs --dist .build --source . --out lesson.zip --title "My lesson"
```

Open `lesson.zip` in md.qft.org and choose **Present**. The application reads
the package locally. It does not upload your slides or call an AI service.

`npm run package` is a shortcut that builds and writes `lesson.zip`. Change
the title in the `pack` script, or use the explicit command above, for a new
lesson. To regenerate the website's example, set `--out
../../public/slidev/interactive-physics.zip` from this repository directory.

## What the ZIP contains

| File | Purpose |
| --- | --- |
| `qft-presentation.json` | Format, version, title, entry file, and source entry |
| `presentation.html` | Compiled Slidev application, with JavaScript, CSS, images, and math fonts embedded |
| `source/` | Editable Markdown, components, build configuration, package manifest, lockfile, and this packager |
| `README.txt` | Instructions for opening and revising the package |

Editing `source/slides.md` does **not** change the compiled player. Rebuild and
package again after editing. The website preserves the uploaded ZIP, so the
original source remains available for your next revision.

## Portable playback profile

This player intentionally runs the presentation in an isolated iframe. It
does not give imported JavaScript access to the editor's drafts, filesystem,
or browser storage, and it blocks ordinary network requests, so a package must
work offline. That block is a privacy default rather than a guarantee: code
written to get around it can still make limited outbound connections.

- Keep `routerMode: memory`. Normal history routing expects a hosted origin.
- Keep `fonts.provider: none`. Use system fonts or locally bundled fonts.
- Keep `pwa`, `record`, `presenter`, `monaco`, and persistent drawings disabled
  for this starter. A presentation cannot install a service worker or open a
  separate presenter window inside the player.
- Include libraries through normal project imports before building. Do not
  load them with CDN script tags, `fetch`, or dynamic URL imports at runtime.
- Import images and data into Vue components so Vite can embed them. Avoid
  runtime strings such as `fetch('/data.json')` or computed `/images/...` URLs.
- Use Vue event handlers or `addEventListener`, rather than literal HTML
  attributes such as `onclick`.
- Browser-side Vue, SVG, Canvas, and compatible WebGL components work within
  this profile. External APIs, workers, nested frames, forms, and `eval` / `new
  Function` are outside the profile. Some plotting libraries need adjustment.
- The supplied compatibility adapter provides presentation-local temporary
  storage and channel synchronization when the browser blocks origin APIs.
  Control state resets when playback restarts; there is no cross-tab presenter
  synchronization.

The packager bundles the JavaScript module graph into an inline script and
embeds HTML-linked styles and assets. It rejects unresolved imports, remote
HTML resources, missing assets, CSS imports, and source symlinks. This is a
defined portable build profile, not a promise that every arbitrary Slidev
`dist/` works unchanged. JavaScript can construct resource URLs dynamically,
so a successful package build is **not** a substitute for the offline test.

## Check before class

1. Open the ZIP in md.qft.org.
2. Present every slide and operate every control.
3. Disable networking and repeat the interaction checks. Fonts, plots, images,
   and mathematical notation should remain visible.
4. Confirm that keyboard slide navigation does not interfere with sliders or
   editable controls.
5. Keep the ZIP and, if desired, a separately exported PDF fallback.

A presentation package can be independent of external servers. Reopening the
md.qft.org website itself offline is a separate application-caching feature.

## Instructions to give an AI coding tool

For an ordinary build, use the instructions from **Create with AI → Slidev**
on the site. For a portable package made with this starter, give these
instructions instead: use this starter as the project template. Create the requested lesson in
`slides.md` and use Vue components for interactive demonstrations. Keep the
portable playback profile. Include all required libraries and assets locally;
do not use CDN links or runtime network calls. Preserve the package manifest
and lockfile. Build with `npm run build`, package with `node pack.mjs --dist
.build --source . --out lesson.zip --title "Lesson title"`, and verify the
result in an iframe with `sandbox="allow-scripts"` and network access blocked.
Return the finished ZIP, including its editable source. Do not return only a
Markdown file or only the unbuilt Slidev source project.

## Use the packager with another Slidev project

Copy `pack.mjs` and `portable-runtime.js` together, and retain the tool's
`esbuild`, `es-module-lexer`, `fflate`, and `parse5` development dependencies.
Adopt the supplied `vite.config.ts` build profile. The important build settings
are `cssCodeSplit: false`, `modulePreload: false`, and a sufficiently large
`assetsInlineLimit`. The packager then follows and bundles static imports in
the built JavaScript graph, including statically identifiable dynamic imports.

Supported packager options:

```sh
node pack.mjs \
  --dist .build \
  --source . \
  --source-entry slides.md \
  --title "Lesson title" \
  --aspect-ratio 16:9 \
  --out lesson.zip
```

`--source` is optional for a playback-only package. Aspect ratio is `16:9` or
`4:3` and should match the Slidev document. Do not include secrets in a source
project: the packager skips dotfiles, dependency folders, generated build
folders, and existing ZIPs, but ordinary included source files remain readable
to anyone receiving the package.

## Dependency notices

Slidev and Vue are separate open-source dependencies. Keep their notices and
the notices for any added libraries when distributing presentations. The
starter pins its build dependencies through `package-lock.json`; the generated
`THIRD_PARTY_NOTICES.txt` accompanies the provided example. The same notices and
the portable player's MIT license are embedded as inert text in the compiled
HTML, so they also travel with a standalone HTML export. A custom project's
`LICENSE` is included when present. Keep any additional component, data, image,
or font attribution required by your own lesson in its source and presentation.
