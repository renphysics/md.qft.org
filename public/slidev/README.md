# Open a Slidev presentation in QFT Markdown

1. Download `interactive-physics.zip` from this directory.
2. Open the ZIP using **Open file** at https://md.qft.org/.
3. Choose **Present**, move to the interactive slide, and change the phase.

This is a compiled Slidev presentation with its original editable source.
The example includes equations and a Vue demonstration of coherent-wave
interference. JavaScript, styles, and math fonts are embedded; no CDN is used
during playback.

To create a new lesson, extract the ZIP and give the `source/` project to
Codex or another coding tool. Follow `source/README.md` to revise, build, and
package it again. Source-only Slidev ZIPs need a build step before playback.

The player supports the portable build profile documented in the source. It
keeps imported code isolated and does not permit runtime network calls,
external scripts, workers, nested frames, or dynamic code evaluation.
