# Open a Slidev presentation in QFT Markdown

1. Download `interactive-physics.zip` from this directory.
2. Open the ZIP using **Open file** at https://md.qft.org/.
3. Choose **Present**, move to the interactive slide, and change the phase.

This is a compiled Slidev presentation with its original editable source.
The example includes equations and a Vue demonstration of coherent-wave
interference. JavaScript, styles, and math fonts are embedded; no CDN is used
during playback.

The ZIP is an optional example. To create a new lesson, you do not need it:
choose **Create with AI → Slidev** on the site and give the instructions to an
AI assistant that can run commands (or follow them on a computer with
Node.js). It makes an ordinary Slidev project, builds it with
`npx slidev build`, and returns one ZIP of the project folder with the built
`dist/` inside and without `node_modules`; open that ZIP on the site. A ZIP of
the `dist` folder alone also opens: the site converts it in the browser.

To start from this example instead, extract the ZIP and give the `source/`
project to your AI assistant. Follow `source/README.md` to revise, build, and
package it again. Source-only Slidev ZIPs need a build step before playback.

The player keeps imported code isolated and blocks ordinary network requests,
external scripts, workers, nested frames, and dynamic code evaluation.
