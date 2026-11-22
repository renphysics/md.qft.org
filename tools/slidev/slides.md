---
theme: default
title: Quantum interference — Slidev
info: |
  A portable teaching example for md.qft.org. Built with real Slidev and Vue.
author: QFT Markdown
routerMode: memory
aspectRatio: 16/9
colorSchema: light
fonts:
  provider: none
  sans: system-ui
  serif: Georgia
  mono: monospace
favicon: ''
monaco: false
download: false
record: false
contextMenu: false
presenter: false
wakeLock: false
editor: false
browserExporter: false
selectable: true
drawings:
  enabled: false
remoteAssets: false
pwa: false
transition: fade
mdc: false
---

<div class="eyebrow">A SMALL EXPERIMENT IN QUANTUM MECHANICS</div>

# Phase makes<br>the difference.

<div class="lead">Two waves. One relative phase.<br>A classroom demonstration you can explore.</div>

<div class="lesson-meta">INTERACTIVE SLIDEV LESSON <span>·</span> 4 SLIDES <span>·</span> WORKS OFFLINE</div>

---
layout: default
---

<div class="eyebrow">01 / THE IDEA</div>

# Amplitudes add.

For two equal contributions to the same detector, the relative phase determines their interference:

$$
A(\phi)=\frac{1+e^{i\phi}}{2},\qquad
I(\phi)=|A(\phi)|^2=\cos^2\!\left(\frac{\phi}{2}\right).
$$

<div class="concept-grid">
<div><strong>In phase</strong><span>At φ = 0, the contributions reinforce.</span></div>
<div><strong>Out of phase</strong><span>At φ = π, they cancel at this detector.</span></div>
</div>

<div class="lesson-note">The normalization sets the largest intensity to one. The next slide is a coherent-wave analogy for these amplitudes.</div>

---
layout: default
---

<div class="eyebrow">02 / EXPLORE</div>

# Change the relative phase.

<QuantumInterference />

---
layout: default
---

<div class="eyebrow">03 / DISCUSS</div>

# What changed—and what did not?

<div class="question-list">
<div><b>01</b><span>At which phase does this detector become dark?</span></div>
<div><b>02</b><span>What happens if both amplitudes acquire the same phase?</span></div>
<div><b>03</b><span>How would a random, rapidly changing relative phase alter the time-averaged signal?</span></div>
</div>

<details class="teacher-answer"><summary>Reveal the discussion notes</summary><p>Destructive interference occurs at φ = π modulo 2π. A common phase leaves the intensity unchanged. A uniformly random relative phase gives an average normalized intensity of 1/2.</p></details>

<div class="lesson-note">The ZIP also contains slides.md and the Vue component. Revise the source with your AI tool, rebuild, and reopen the package.</div>

<style>
.slidev-layout { background: #faf8f4; color: #252a31; padding: 54px 62px; font-family: system-ui, sans-serif; }
.slidev-layout h1 { font-family: Georgia, serif; font-size: 48px; font-weight: 500; line-height: 1.12; letter-spacing: -.035em; margin: 12px 0 26px; color: #252a31; }
.slidev-layout p { max-width: 750px; line-height: 1.65; font-size: 22px; }
.slidev-layout .eyebrow { font-size: 12px; font-weight: 700; letter-spacing: .18em; color: #8a4655; }
.slidev-layout .lead { font-size: 26px; line-height: 1.5; color: #657079; margin-top: 20px; }
.slidev-layout .lesson-meta { position: absolute; bottom: 60px; font-size: 11px; font-weight: 600; letter-spacing: .13em; color: #7c8084; }
.lesson-meta span { margin: 0 12px; color: #a85f6f; }
.concept-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin: 25px 0; }
.concept-grid > div { background: #f0ebe5; border-radius: 12px; padding: 18px 22px; }
.concept-grid strong { display: block; font-size: 19px; margin-bottom: 8px; }
.concept-grid span { font-size: 16px; color: #657079; }
.slidev-layout .lesson-note { font-size: 14px; line-height: 1.55; color: #72777c; margin-top: 22px; }
.question-list > div { display: flex; gap: 22px; padding: 17px 0; border-bottom: 1px solid #e3ded8; font-size: 21px; line-height: 1.45; }
.question-list b { color: #a1606f; font-size: 13px; line-height: 2.5; }
.teacher-answer { margin-top: 22px; color: #874050; }
.teacher-answer summary { cursor: pointer; font-size: 16px; font-weight: 600; }
.slidev-layout .teacher-answer p { font-size: 16px; margin-top: 10px; color: #57646c; }
</style>
