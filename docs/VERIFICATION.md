# Verification history

## Independent verification, three more fix rounds and the closing — 2026-11-27

The fixes described in the next section were checked by verifiers who had not written them. What they found was fixed, and the fixes were checked again, seven times in all. Every verifier worked read-only in a folder of their own, with their own scripts and test presentations, and compared the build before a round with the build after it in the same Chromium, and with the same files served over plain HTTP where a reference was needed. A fix counted as confirmed only when the verifier's own run showed the defect before the round and not after it.

| Step | Tree | Result |
| --- | --- | --- |
| Review | 9109318 | 7 reviewers, 58 findings |
| First fix round | 7881c10 | |
| First verification | 7881c10 | 9 verifiers. Of the 58 findings: 50 fixed, 6 partly fixed, 2 kept as documented limits. 56 new findings (5 major, 36 minor, 15 polish), 19 of them caused by the first fix round |
| Second fix round | 942ac7b | |
| Second verification | 942ac7b | 8 verifiers. Of the 56 findings: 51 fixed, 4 partly fixed, 1 not applicable. 45 new findings (6 major, 25 minor, 14 polish), 25 of them caused by the second fix round |
| Third fix round | d1247f5 | |
| Third verification | d1247f5 | 7 verifiers. Of the 49 open findings (the 45, and the 4 partly fixed before): 46 fixed, 2 partly fixed, 1 not applicable. 31 new findings (1 major, 15 minor, 15 polish), 19 of them caused by the third fix round |
| Fourth fix round | d5b14ea | |
| Fourth verification | d5b14ea | 4 verifiers. Of the 33 open findings: 29 fixed, 3 partly fixed, 1 not applicable (it could not be reproduced on either build). 9 new findings (1 major, 5 minor, 3 polish), 5 of them caused by the fourth fix round |
| Closing fixes | 57eda1a | Eight of the nine new findings of the fourth verification and what was left of two of its partly fixed ones; one defect found by replaying the research report's baseline table; and one found by measuring equation numbers against MathJax. The ninth new finding stays as a documented limit, with what was left of the third partly fixed one (below) |
| Closing check | 57eda1a | 3 verifiers. All 11 fixed. 12 new findings (none major, 7 minor, 5 polish), 10 of them caused by the closing fixes; 3 of the 12 were missing tests and 3 were wording |
| Follow-up fixes | f894d93 | All 12; for one of them the fix is a corrected sentence about a limit that stays |
| Re-check | f894d93 | 2 verifiers. All 12 fixed, no regression. 3 new findings (none major, 2 minor, 1 polish): 2 of them older than the follow-up fixes, 1 a wrong example in the documentation those fixes added |
| Last fixes | 4db721a | The 3 findings of the re-check |
| Last check | 4db721a | 1 verifier: all 3 fixed, no regression, no new finding. 2 more checked this record and the status note in the research report, claim by claim, against the stored results and the code; their corrections are in both texts |

The 6 findings that the first verification called partly fixed were not judged again under their own numbers. Three of them had become new findings of that verification, which the second round fixed; the other three were leftover wordings. None of the six is left in the last tree; that was checked by the author of the fixes, not by a verifier.

No verifier in any round found a way out of the sandbox, markup injected into the app page, or a request that left the browser while a presentation played. The sandbox attributes, the `allow` list and the Content Security Policies are the same strings as before the review, and unit tests pin them; each verification compared them again. One thing was deliberately not tested: the documented browser-level side channels (link prerender and preconnect, WebRTC), see [ARCHITECTURE.md](ARCHITECTURE.md).

Of the 156 new findings of the six verifications that found any, 79 were caused by the fix round before them: between a third and five sixths per round. That is why the fixes were checked by others every time, and why the last rounds were kept small.

### What the verifications found

- **First verification (major findings).** ZIP file names stored in an old code page (GBK, cp437) were lost, and the note said the files were missing. A tab left open across a new release showed an empty library and a raw import error. The report's rules line made an AI assistant delete `reveal.css`, and the broken result was then reported as needing no changes. A MathJax script loaded on its own was not recognised, so formulas stayed raw. At phone widths the player's notices left almost no room for the slides.
- **Second verification (major findings).** The `onload` code of a script that the linker replaces was lost, so KaTeX's documented snippet typeset nothing. `\begin{align}` written directly in the text of a MathJax presentation stayed raw. A ZIP of a folder with a non-ASCII name got no file-name repair, and common Chinese names that happen to be valid UTF-8 (图片1.png) were misread. Escape could close the dialog without the leave question, so unapplied typing was lost. A button that set `location.href` to a website stopped playback with a developer's sentence shown as the presentation's own words. Also found: quiz forms never received their submit event in the sandbox.
- **Third verification.** One major finding, older than the round: a file dropped on the open dialog replaced the presentation without the leave question, so unapplied typing was lost. The rest were smaller: a presentation that left its slides by itself within seconds of Start was started again once; a Print button gave no visible answer; the report's rules for a single Reveal.js file asked for a ZIP; one misleading name in the page text renamed every file of a correct UTF-8 ZIP; bare `multline` and `flalign` stayed raw; eight behaviours had no test that would notice their removal.
- **Fourth verification.** One major finding, again older than the round and found with a presentation an AI assistant had just written: its "Print handout" button hid the slides and showed them again on the browser's `afterprint` event, which the player never sent, so the slides were gone until Restart, and the report said no changes were needed. Smaller: unused pictures of a Windows ZIP whose names happen to be valid UTF-8 kept a garbled name (a regression of the fourth round); `multline` got a number on every line; for a single HTML file a note still said "Add the file to the ZIP."; a file that was not a presentation, dropped on unapplied typing, asked the leave question and then discarded nothing; the print sentence pushed the basic-settings sentence off the notice. One finding stays as a documented limit: in a correct UTF-8 ZIP of a folder with a non-ASCII name, one mis-encoded name in the page text still makes the site read the names of that folder in the old code page (naming the ZIP after its folder avoids it). All 18 AI-made presentations of the earlier rounds behaved on the fourth-round build exactly as before it or better.
- **Found by the author of the fixes on the fourth-round build.** Replaying the nine kinds of file in the research report's baseline table (section 3): eight played or were explained; the ninth, a Slidev `slides.md` on its own, still opened as a Markdown document without a word, and Check lesson passed it (a defect of the report's section 9). And a measurement nobody had made: in a Reveal.js presentation whose MathJax numbers its equations, the twelfth slide showed (1) where MathJax shows (5), references showed "(?)", and with MathJax's default setting numbers appeared where MathJax shows none. KaTeX's own numbers come from a CSS counter, which skips slides that are not displayed.
- **Closing check.** Nothing major. The equation numbers were compared with real MathJax on 51 generated pages (860 formulas and references, in MathJax 2, 3 and 4 pages and Reveal's plugin forms): every difference traced to a documented limit, to a formula that MathJax itself rejects, or to six edge cases, among them MathJax 4's numbering of a `\label` on a row without a number (now a documented limit) and Reveal.js's hidden text copy for screen readers (see the re-check). Two findings were regressions of the closing fixes that a teacher could meet: a numbered environment became an error box from 84 rows that use a macro six times each, or 167 plain rows, because KaTeX counts the added `\tag` against its limit of macro expansions; and the new test for Slidev source took time with the square of the length of one odd line, so a Markdown file with a line of 100,000 letters after `<A` froze the tab for 13 seconds. The rest: the new ZIP-name rule also renamed the unused neighbours of one mis-encoded name in a correct UTF-8 ZIP; the long Slidev notice was a column half a phone's screen wide; "Opening NAME…" stayed in the dialog when a dropped ZIP was refused (older than the closing fixes); repeated typesetting typeset the formulas again inside KaTeX's hidden copy of their TeX when a presentation set its own skipped tags (also older); a documented limit said that MathJax leaves a later-pass reference unresolved, which it does not, and another sentence named the wrong source of a ZIP-name rule; three behaviours of the closing fixes had no test that would notice their removal; two sentences could be clearer. All 20 AI-made presentations behaved on the closing build as on the build before it, except the two that the closing fixes repaired.
- **Re-check of the follow-up fixes.** No regression: the 860 formulas and references were compared again and one differed, by timing (next sentence); the 20 AI-made presentations and their 4 repaired copies played as on the closing build. Three findings. Reveal.js keeps a hidden text copy of the current slide for screen readers; whether it still held raw TeX when the formulas were first typeset depended on timing, and then its equations took numbers too, so a formula added to a slide later was numbered (5) in some runs and (7) in others (the numbers of the slides' own formulas never changed). A presentation ZIP of 2 MB or more, opened while the presentation dialog was open, left "Opening NAME…" at the top of the dialog after it had opened. Both are older than the follow-up fixes. And the documentation's new example of a long environment, 120 rows, was one that MathJax itself rejects.
- **Last check.** The three fixes hold. A formula added later is now (5) in 10 of 10 runs, as in MathJax, where the build before gave (5) six times and (7) four times; the 860 formulas and references are unchanged. The price is a documented difference: when the numbered equations of the first slide have no label, MathJax counts the hidden copy and numbers a formula added later higher than this site does. The copy of "Opening NAME…" goes when the file has opened, also after a real drop and when one large file follows another, and the notices that should stay in a dialog (why a file was refused) stay. Each of the five mutants the verifier made of the changed lines fails a test.

### Presentations written by AI assistants

In the review and in each of the first four verifications, role-played chat assistants (Claude models that never saw this repository) wrote new presentations: 7 from the site's own prompts (p1 to p3, q1 to q3, s1) and 13 from casual requests. From the first verification on, when the check asked for changes, the assistant received only the text of **Copy report for AI** and answered it once; the 7 presentations of the review were not sent back. The closing check, the re-check and a last replay by the author of the fixes on the last tree played all 20, and the 4 repaired copies, again. In that last replay 23 of the 24 runs matched the re-check's records in every step, note, status line and report; the 24th differed in one reading of a running simulation, which also differs between two runs on the same build. On the last tree all 20 open; 12 play completely as they were first written, 3 more after the assistant's one answer to the report, and for the other 5 the notes say what to change:

| Presentation | Plays completely as first written | After one answer to the report | What does not work, and why |
| --- | --- | --- | --- |
| Simple Harmonic Motion (p1), 傅里叶级数 (p2), Bayes and Medical Testing (p3): single Reveal.js files | No | Not sent back | Their own `controls` class collides with Reveal.js's; the notes say so |
| The Water Cycle (n5), The French Revolution (n6) | Yes | | |
| Sorting Algorithms (n7): Mermaid and Chart.js from a CDN | No, it starts with basic settings | Not sent back | Libraries from the internet are left out (a documented limit); the notes say so |
| Photosynthesis (n8): Font Awesome and a missing picture | No | Not sent back | The assistant's file; the notes say so |
| Solving Linear Inequalities (q1), La ley de Ohm (q2), Projectile Motion (q3) | Yes | | |
| The normal distribution (s1): a Slidev build of 118 files | Yes, converted | | |
| Comparing Fractions (m1), Climate Data (m2) | No (1 problem; 8 notes) | Yes | |
| The Pythagorean Theorem (m3) | Yes | | Its Print button does not print (a documented limit, with a notice) |
| The Time-Independent Schrödinger Equation (k1) | Yes | | |
| Chemical Equilibrium (k2) | No (2 notes) | Yes | |
| Newton's Second Law (t1) | Yes | | |
| The Quadratic Formula (t2): a form and a Print button | Yes | | Print does not print (a documented limit, with a notice) |
| The Water Cycle (u1): a quiz and a "Print handout" button | Yes, since the closing fixes | | Printing itself (a documented limit, with a notice); before, the button hid the slides |
| Quantum Harmonic Oscillator (u2): MathJax with numbered equations | Yes, since the closing fixes | | `multline` and `flalign` are laid out like `gather` and `align` (a documented limit); before, the numbers and references were wrong |

All 20 were written by Claude models. No presentation from ChatGPT, Gemini or Copilot was tested.

### The research report's baseline, replayed on the last tree

The first nine rows of the table in section 3 of [the research report](research/presentation-platform/README.md) ("Baseline: what the site does today"), with the same files:

| What the user opens | Before | On the last tree |
| --- | --- | --- |
| Single Reveal.js `.html` file | Could not be chosen | Plays |
| The same file inside a ZIP | Refused as not a Markdown document | Plays |
| Standard Reveal.js project ZIP (`index.html` + `dist/`) | Refused as a website build | Plays |
| Reveal.js project ZIP that also contains a `README.md` | Opened the README as a lesson | Plays |
| Slidev source project ZIP | Refused | Explained: it has to be built first, and how |
| Ordinary `slidev build` output ZIP | Refused as a website build | Converted and plays |
| ZIP with Slidev source and build together | Refused as Slidev source | Plays the build |
| A lone Slidev `slides.md` | Opened as a document without a word; Check lesson reported success | Opens as a document with a notice that it has to be built first; Check lesson says the same |
| Package made with `tools/slidev/pack.mjs` | Played | Plays |

### Automated checks on the last tree

A clean clone of the commit that adds this record, on 2026-11-27, with the steps of the repository's Check workflow (`npm ci`, the checks below, and `npm ci` for the Slidev tooling) and the Chromium already on the machine in place of the workflow's browser download:

| Check | Result |
| --- | --- |
| `npm run check` | Passed: 155 files, 0 errors, 0 warnings, 0 hints |
| `npm test` | Passed: 857 tests in 104 suites; 855 passed, 2 skipped (`QFT_SLIDEV_BUILDS` and `QFT_SLIDEV_MONACO_BUILD` unset), 0 failures |
| `npm test --prefix tools/slidev` | Passed: 11 tests |
| `npm run build` | Passed: 6 pages. Vite still reports its large-chunk advisory |
| `npm run test:browser` | Passed: 12 of 12 suites, 145 checks, 1 skipped (`QFT_SLIDEV_MONACO_BUILD` unset), in full Chromium |

New unit tests since the closing fixes cover the room KaTeX gets for the added equation numbers (a 90-row environment, the plugin forms, `tex2chtml`, a macro that calls itself), the classes the stand-in never typesets and Reveal.js's text copy for screen readers (`deck-linker-mathjax-numbers`), the time the Slidev test takes on long lines (`slidev-source`), the ZIP-name rule in four two-byte code pages and the rule for a part of the ZIP on its own (`deck-zip-code-pages`), the print sentence between the two print events (`presentation-runtime`), and the advice for a single HTML file (`deck-report`, `docs-quotes`). New browser steps cover the long environment with repeated typesetting and the text copy (`deck-linker`), a ZIP refused while it is read and a large file opened over an open presentation (`deck-editing`), and the width of the long notice at 320 px (`decks`).

The browser suites now take about four and a half minutes on four cores, so the commit that adds this record raises the time limit of the Check workflow from 15 to 30 minutes. The workflow itself was not run on GitHub: it runs for pull requests, pushes to `main` and manual dispatch, and none was made for this branch.

### Not verified

- **Browsers.** Only full Chromium ran the suites and the verifiers' scripts. Firefox and Safari were not tested.
- **Phones, touch and screen readers.** Phone widths were emulated in Chromium; no phone, tablet, touch input or screen reader was used. What a screen reader reads from Reveal.js's text copy, which is no longer typeset, was not checked.
- **Presentations from other assistants.** The 20 test presentations were written by Claude models.
- **Drag and drop by hand.** Drops were simulated with a drop event in the page, never made from the desktop, and no file over 40 MB was dropped.
- **Some forms and builds.** Reveal's plugin form `RevealMath.MathJax4` was not run (MathJax 4 loaded by itself was). The two unit tests and the browser check that build Slidev projects were skipped, as the tables say.
- **ZIP names.** Only Chromium's decoders were used. Names of rare characters (GB2312 level 2, Big5) can still keep the garbled name of an unused picture, and so can a ZIP that mixes parts in an old code page with UTF-8 parts; one such case was built by hand, and Big5 and Shift_JIS level-2 names were not enumerated.
- **The browser-level side channels** named above, on purpose.
- **The deployed site.** These changes were not deployed; nothing was checked on the live host, and the Check workflow did not run on GitHub.
- **Not built, so not verified:** editing Slidev source in the browser, a served mode for files loaded while playing, a speaker view, PDF export of imported presentations, dropped folders and pasted HTML.

## Fixes after an independent review — 2026-11-26

Seven reviewers examined the presentation-library work (commits a73456b..9109318) independently of its authors, each with their own scripts and test presentations. None of them found a way out of the sandbox or markup injected into the app page; they found two ways to lose saved edits and one way to lose files with non-ASCII names (all fixed below). They reported 58 findings, nearly all demonstrated with a file or script. Every fix below started with a test that failed on the reviewed code.

### What the review did

- **A defensive trust-boundary review.** The sandbox attributes, the `allow` list, the three Content Security Policies, the token and nonce checks and the message limits were compared with the previous release and found unchanged. A hostile presentation (markup, quotes and right-to-left overrides in its title, file names and error texts; requests to other hosts) was played in every view while the app page was searched for injected elements, event attributes and dialogs; none appeared. The ZIP reader, the scanners and the report for AI were attacked with crafted input. Found: two regular expressions that froze the page for 15 and 37 seconds on small crafted files, ZIP names decoded in the wrong encoding, a file named `__proto__` that broke the edited download, presentation paths outside the report's untrusted-text fence, and direction-changing characters shown in file names.
- **Differential testing against ordinary HTTP serving.** Generated Reveal.js presentations (Reveal.js 3 to 6 from jsDelivr, unpkg, cdnjs and local copies, ES modules, MathJax, plugins, `noscript`, async stylesheets, `image-set()`, sprites, links, caption tracks, cookies, `alert()`), ordinary web pages and Slidev builds (a feature-rich Slidev 53.1.0 build, the router and base-path variants, damaged builds) were played in the built site and, for reference, served over plain HTTP with network access in the same Chromium. Slide text at every step, fragments, highlighting, math, fonts, pictures and demo behaviour were compared. Libraries and Slidev features matched; the differences became findings (for example noscript fallbacks that refused the presentation, dead links, cookies and `alert()` that stopped or silenced scripts, MathJax-only commands).
- **An upgrade test with real stored data.** The previous release, in a persistent browser profile, saved the site's Slidev example, imported the starter ZIP and saved a Markdown draft. The new release on the same origin listed and played both presentations and kept the draft. A tab still running the old release got a misleading message (now "This page was updated in another tab. Reload the page to continue."). Edit-loss scenarios found two ways to lose saved edits: reopening the original file of a presentation fixed by edits, and editing in two tabs.
- **Seven presentations written by AI assistants on the spot.** Three Claude models wrote one presentation each from the site's own Reveal.js prompt, and four more from casual requests without it (single HTML files and ZIPs, one with Mermaid and Chart.js from a CDN). Each went through the teacher's whole path: open, read the notes, play every slide and demo, Present, Restart, Stop, copy the report, edit and Apply, reload, reopen, the three downloads, the standalone HTML from `file://` with the network blocked, and re-import. This found the `class="controls"` collision with Reveal.js's own controls in two of the three prompt-made presentations, a raw `<` in TeX that hid text, a blank white stage labelled "Playing locally" when a left-out library stopped the start-up script, and "same slide" promised for a plain page.
- **Documentation, wording and licences.** Every limit and privacy statement was checked against the code; the standalone HTML download of an imported presentation was found to lack the licence notices of the bundled code.

### What changed

The player now keeps tolerant presentations going where the sandbox used to stop or silence them (cookies in memory, `crypto.randomUUID`, a message box for `alert()`, one note for pop-up questions and new windows, no false caption-track warning), starts a Reveal.js presentation whose start-up script failed with basic settings or says on the stage that it did not start, counts problems in the status line and opens the notes for start-up problems, and offers links to websites behind a confirmation. Saved edits are never replaced silently. Scanning is linear in the file size, ZIP names keep their UTF-8 spelling, the report fences every text from the presentation, and the linker keeps or explains more (noscript, async stylesheets, `image-set()`, sprites, left-out plugins and libraries, links, files loaded while playing, Reveal.js class names, `<` in formulas, MathJax-only commands). The Slidev prompt asks for an ordinary project with its build, the converter has a time limit and a plain error, the standalone HTML download carries third-party notices, and the wording says "presentation" with a next step after every error. The details are in [ARCHITECTURE.md](ARCHITECTURE.md) and the README. Two linker differences were kept on purpose and are documented in `deck-linker.ts`: deferred scripts run during parsing, and `<picture>` art direction is dropped.

### Automated checks on the final tree

| Check | Result |
| --- | --- |
| `npm run check` | Passed: 139 files, 0 errors, 0 warnings, 1 hint (ts(2570) in `tests/browser/deck-problems.browser.mjs`, fixed in the second fix round; this table first said 0 hints) |
| `npm test` | Passed: 637 tests in 71 suites; 635 passed, 2 skipped (`QFT_SLIDEV_BUILDS` and `QFT_SLIDEV_MONACO_BUILD` unset), 0 failures |
| `npm run build` | Passed: 6 pages. Vite still reports its large-chunk advisory |
| `npm run test:browser` | Passed: 9 of 9 suites, 95 checks, 1 skipped (`QFT_SLIDEV_MONACO_BUILD` unset), in full Chromium |

Two new browser suites cover the rescue start and its strip (also in Present), the problem box when the slides do not start, the link strip and its button in the library, in Present and in the standalone download, and the wording after Apply on a plain page (`deck-problems`); and a presentation fixed by an edit, reopening its original, Apply and Escape in the editor, two tabs editing one presentation, a direction override in a file name, several problems on the stage at 1280×800 and 390×844, focus after closing at 320 px, the notice for a large file, and Original for a single HTML import (`library-edits`). The `player` suite adds cookies, `randomUUID`, the message box, `confirm`/`prompt`, the S key and `noscript`; `deck-linker` adds left-out plugins, MathJax-only commands and `<` in formulas. `tests/deck-pathological.test.ts` times the scanners on crafted input. The two AI-made research presentations now come from `docs/research/presentation-platform/prototypes.zip` and run in every environment, CI included; the larger research Slidev builds are optional through `QFT_SLIDEV_BUILDS` and `QFT_SLIDEV_MONACO_BUILD` (see the README). The browser runner serves this checkout's `dist/` itself on a free port. The starter ZIP's `source/` files are checked against `tools/slidev`.

### Automated checks after the second fix round

The tree after the second round of fixes (the findings of an independent verification of the first round's fixes; see ARCHITECTURE.md and the README for the behaviour) gave:

| Check | Result |
| --- | --- |
| `npm run check` | Passed: 147 files, 0 errors, 0 warnings, 0 hints |
| `npm test` | Passed: 721 tests in 87 suites; 719 passed, 2 skipped (`QFT_SLIDEV_BUILDS` and `QFT_SLIDEV_MONACO_BUILD` unset), 0 failures |
| `npm run build` | Passed: 6 pages. Vite still reports its large-chunk advisory |
| `npm run test:browser` | Passed: 11 of 11 suites, 118 checks, 1 skipped (`QFT_SLIDEV_MONACO_BUILD` unset), in full Chromium |

The new browser suites are `deck-notices` (the notices over the slides at 1280×800, 390×844 and 320×568) and `library-phone` (the dialog at phone width, and the library after a new release). The exact sandbox and policy strings of the interactive demo frame, `public/demo-sandbox.html` and the document and slide exports are now pinned by unit tests, as the presentation player's already were.

### Automated checks after the third fix round

The tree after the third round of fixes (the findings of the verification of the second round; see ARCHITECTURE.md and the README for the behaviour) gave, run on 2026-11-27 in full Chromium against this tree's own build:

| Check | Result |
| --- | --- |
| `npm run check` | Passed: 151 files, 0 errors, 0 warnings, 0 hints |
| `npm test` | Passed: 791 tests in 95 suites; 789 passed, 2 skipped (`QFT_SLIDEV_BUILDS` and `QFT_SLIDEV_MONACO_BUILD` unset), 0 failures |
| `npm run build` | Passed: 6 pages. Vite still reports its large-chunk advisory |
| `npm run test:browser` | Passed: 12 of 12 suites, 133 checks, 1 skipped (`QFT_SLIDEV_MONACO_BUILD` unset), in full Chromium |

The new browser suite is `player-actions` (a quiz form that answers on a click and on Enter, a required empty field, `requestSubmit()` and implicit submission, a form that no handler stops; `window.open` of a website after a click and links the presentation cancels; an error thrown with an empty value; a button that sends the presentation to a website). New unit test files cover the `onload` and `onerror` code of replaced scripts (`deck-linker-events`), the rewrite of literal page-address changes (`deck-linker-navigation`) and the report lines for the linker's and the player's new notes (`deck-report-merge`); `interactive-exports` now checks that the exports declare `no-referrer` exactly once in their own head, before any embedded runtime.

### Automated checks after the last fix round

The tree after the fourth and last round of fixes (the findings of the verification of the third round; see ARCHITECTURE.md and the README for the behaviour) gave, run on 2026-11-27 in full Chromium against this tree's own build:

| Check | Result |
| --- | --- |
| `npm run check` | Passed: 152 files, 0 errors, 0 warnings, 0 hints |
| `npm test` | Passed: 810 tests in 95 suites; 808 passed, 2 skipped (`QFT_SLIDEV_BUILDS` and `QFT_SLIDEV_MONACO_BUILD` unset), 0 failures |
| `npm run build` | Passed: 6 pages. Vite still reports its large-chunk advisory |
| `npm run test:browser` | Passed: 12 of 12 suites, 138 checks, 1 skipped (`QFT_SLIDEV_MONACO_BUILD` unset), in full Chromium |

New browser steps cover a presentation file dropped on the open dialog with unapplied typing and Escape without a close event (`deck-editing`), a Print button's sentence over the slides, also in Present (`deck-notices`), a presentation that leaves by itself being stopped at once with the notes closed and Start presentation in view (`deck-problems`), a cancelled submit click, `form.submit()` from a timer, Enter in a form with two fields and `top.location.href` after a click (`player-actions`), and the Reload button on the stage (`library-phone`); new unit tests cover the runner's own activation in its `left` message, the names of a single HTML file in the notes and the report, the ZIP's own name and names valid as UTF-8 (`deck-zip-code-pages`), the `async` and stylesheet `onload` code, `multline` and `flalign`, `//host` and `window.top` rewrites, and the documentation's quotations of the form, print, rules and reply sentences (`docs-quotes`).

### Not verified in this round

- **The review's own tools on the fixed tree.** The fixes rest on the regression tests above, each of which reproduced its finding first. The reviewers' scripts and the seven AI-made presentations were not run again for this record of 2026-11-26; the independent verification at the top of this page did so afterwards.
- **Browsers.** Only full Chromium ran the suites. Firefox and Safari were not tested; neither was the message box, the link strip or `navigator.userActivation` in them (where that property is missing, the link and fullscreen checks let the request through, and opening a link still needs the button).
- **Phones and touch.** Several problems on the stage were checked in Chromium at 1280×800 and 390×844; the strips' compact phone layout and their place beside Exit fullscreen were not checked in a suite, and no phone, tablet or touch input was used.
- **Screen readers.** Roles, labels and live regions were checked in code and in the suites; no screen reader was used.
- **The deployed site.** These changes were not deployed; the converter's time limit and GitHub Pages compression of `esbuild.wasm` were not checked on the live host.

### Automated checks after the closing fixes

The tree after the closing fixes (equation numbers in MathJax presentations, the player's stand-in for printing, the dropped file, the basic-settings notice, the advice for a single HTML file, ZIP names, the lone Slidev file and this documentation) gave, run on 2026-11-27 in full Chromium against this tree's own build:

| Check | Result |
| --- | --- |
| `npm run check` | Passed: 155 files, 0 errors, 0 warnings, 0 hints |
| `npm test` | Passed: 846 tests in 101 suites; 844 passed, 2 skipped (`QFT_SLIDEV_BUILDS` and `QFT_SLIDEV_MONACO_BUILD` unset), 0 failures |
| `npm run build` | Passed: 6 pages. Vite still reports its large-chunk advisory |
| `npm run test:browser` | Passed: 12 of 12 suites, 143 checks, 1 skipped (`QFT_SLIDEV_MONACO_BUILD` unset), in full Chromium |

New unit tests cover equation numbers, `\label`, `\eqref` and `\ref` in both MathJax stand-ins (`deck-linker-mathjax-numbers`), the order of `beforeprint`, the print limit and `afterprint` with a throwing handler and a nested `print()` (`presentation-runtime`), the advice for a single HTML file checked with the real check (`deck-report`), the per-part rule and the default picture names of a two-byte code page (`deck-zip-code-pages`), the lone Slidev file and the two Check lesson warnings (`slidev-source`, `lesson-check`), and the quotation of the single-file advice (`docs-quotes`); new browser steps cover the numbered and unnumbered MathJax presentations (`deck-linker`), a Print button that hides its slides and the basic-settings notice during `print()` (`deck-notices`), a lesson ZIP dropped on unapplied typing (`deck-editing`), the name of an empty single file in the problem box (`deck-problems`) and a lone Slidev `slides.md` opened as a document (`decks`).

## Presentations from AI tools — 2026-11-26

This iteration lets the presentation library open Reveal.js decks (a single HTML file or a ZIP), other web pages, and ordinary Slidev builds, play them offline in the existing sandbox, edit the source of Reveal.js decks and web pages, and report what the check found to the AI that made the deck. It also repairs the defects confirmed by the research in [docs/research/presentation-platform](research/presentation-platform/README.md), section 9: keyboard focus after Start and Present, attribution of deck error text, the privacy wording, the page query in the slide preview, Save PDF on the site's own example, the lesson prompt's placeholder `projectId`, and the Slidev Node version.

### Automated checks on the final tree

| Check | Result |
| --- | --- |
| `npm run check` | Passed: 127 files, 0 errors, 0 warnings, 0 hints |
| `npm test` | Passed: 520 tests in 51 suites, 0 failures |
| `npm run build` | Passed: 6 pages. Vite still reports its large-chunk advisory |
| `npm run test:browser` | Passed: 7 of 7 suites, 69 checks, in full Chromium |

The browser suites run against the production preview in full Chromium (`QFT_BROWSER_EXECUTABLE=/opt/pw-browsers/chromium`), press keys without clicking into the deck first, and fail if any request leaves the local server. They cover: the Markdown slide preview and its PDF checks (`slides`); the portable Slidev package, its standalone export with networking disabled, and attribution of deck errors (`presentations`); both player profiles, History guards, fullscreen requests, warnings, and replay at a slide (`player`); linked test decks (`deck-linker`); opening every kind of deck from each entry point, the two AI-made research decks with their simulations, duplicates, Slidev source, Markdown and lesson ZIPs, and a library saved by the previous version (`decks`); editing, Apply, Discard, Restore original, the edited and original downloads, and leaving with unapplied changes (`deck-editing`); and converting, saving, replaying, and exporting an ordinary Slidev 53.1.0 build, refusing a Monaco build, and loading the converter only when needed (`slidev-builds`).

Unit tests also run, when the research files are on the machine, ten research Slidev builds (router and base-path variants, a Mermaid deck, a Slidev 52.11.5 build) and the official template build with Monaco. The naive-AI corpus from the research was rechecked in Node through `openDeck` and `buildPlayable`: both complete Reveal.js decks link with no errors or warnings (one note: Reveal.js 5.2.1 from jsDelivr is replaced by the bundled 6.0.2); the third agent's output has no HTML page and is correctly not treated as a deck; the fourth is empty.

### First load

The workspace (`/`) loads, before any action: JavaScript 1,296.3 KiB before this iteration (commit 974fa5e) and 1,321.3 KiB after (425.6 and 432.3 KiB gzip, +1.6%); CSS 171.8 and 181.3 KiB (35.4 and 37.0 KiB gzip); HTML 135.4 and 139.3 KiB. Almost all of the JavaScript growth is the presentation library's own script (8.8 to 15.1 KiB gzip), which carries the tolerant player bootstrap and the new library controls. The guide, FAQ, and About pages load the same 0.8 KiB of JavaScript as before; the About page's HTML grows from 85.0 to 114.9 KiB because it embeds the longer third-party notices.

Everything new is a separate lazy chunk: deck reading, detection, linking, and storage; each bundled Reveal.js and KaTeX file; the source editor; and the Slidev converter Worker with `esbuild.wasm` (13.3 MB, 3.6 MB gzip), which is requested only when a Slidev build is opened. The built `dist/_astro` grows from 3.3 MB to 21.4 MB on disk, mostly `esbuild.wasm` and the Reveal.js themes.

### Not verified in this iteration

- **Browsers.** Only full Chromium ran the automated suites. Firefox was used only during the research, in Playwright's headless build ([Appendix C](research/presentation-platform/README.md#appendix-c--firefox-pass)); in that pass a deck with an endless loop froze the Firefox tab. Safari and WebKit were not run. Whether Firefox gives the page user activation after a key press inside a sandboxed deck (needed for a deck's own fullscreen key) was not checked.
- **Devices and input.** Phones, tablets, and touch input were not tested beyond the existing narrow-layout screenshot.
- **Assistive technology.** Keyboard reachability, focus order, and `aria-live` announcements were checked in code and in the browser suites; no screen reader was used.
- **Decks.** Results rest on the test fixtures, two AI-made research decks, and the research Slidev builds. Rendering MathJax decks with KaTeX is covered by unit tests, not by a sample of real MathJax decks. Slidev conversion depends on minified build output and was checked on Slidev 53.1.0 and 52.11.5 only.
- **Deployment.** These changes were not deployed; GitHub Pages compression of `esbuild.wasm` and the Worker's policy on the live host follow from the research, not from a check of the deployed site.

## Header exports and removal of the title row — 2026-10-31

Download and Save PDF now live in the workspace's site header. The document title row is removed; the sidebar toggle precedes Paste, and Settings sits immediately before the Editor/Split/Preview group. The current document's rename control and autosave status are in the sidebar.

- Production build passed; Astro check covered 40 files with no errors, warnings, or hints.
- All 74 automated tests passed, including a regression for header export events, menu focus, Markdown download, PDF setup, and explicit association with the correct workspace.
- Browser checks of the production build confirmed the Download menu, Save PDF setup, Settings, sidebar toggling, and the rename dialog. The math example remained fully rendered.
- The desktop header remains 56 px; the document-tools row remains 48 px, with no separate title row.
- Layout checks at 320, 375, 640, and 850 px found no horizontal page overflow. The header remains 52 px at the smaller widths and 56 px at 850 px. The tools wrap at 320 px and stay on one 48 px row at the other checked widths. At 320 px the open Download menu stays within the viewport.

## Compact toolbars and public discovery — 2026-10-31

The title/actions row is 64 px on desktop and at least 60 px on mobile. The document-tools row has a 48 px minimum height and can wrap when needed. Duplicate is a labeled document tool between Paste and Clean up, with one unchanged controller hook. The existing compact site-header heights remain unchanged.

Local verification for this revision:

- Astro check: 39 files, no errors, warnings, or hints.
- Automated tests: 73 passed. New coverage checks sitemap and robots URLs under a custom domain and a project path, structured-data identities, FAQ fidelity, safe JSON-LD/XML serialization, and the blank workspace title after initialization.
- Both production builds passed for `https://md.qft.org/` and `https://reuse-example.github.io/reuse-check/`.
- Each built output passed an audit of six HTML pages, five canonical sitemap entries, 98 internal links/assets, matching canonical/social/schema URLs, valid FAQ data, the 404 noindex policy, and the 1200 × 630 sharing image.
- The executable-script CSP was preserved. JSON-LD is an inert data block; private draft content is not included in build-time metadata.

Deployment and CI results are recorded in GitHub Actions. Search indexing, search rankings, rich results, and citations by AI assistants are external outcomes and are not established by these checks. See [SEO.md](SEO.md) for webmaster-tool setup and reuse details.

## Earlier document workflow verification — 2026-10-30

This record covers the paste, organization, document-style, and PDF-setup revision. It distinguishes source/build checks from browser and native PDF checks.

### Deployment of the document-workflow revision

Feature commit [`4f10e027412b582d2bf47a3bd5f02ca6f126c2e7`](https://github.com/renphysics/md.qft.org/commit/4f10e027412b582d2bf47a3bd5f02ca6f126c2e7) is deployed at **[https://md.qft.org/](https://md.qft.org/)**. The GitHub **Check** and **Deploy to GitHub Pages** workflows both succeeded for this commit. The custom domain is serving the upgraded application over HTTPS; GitHub Pages setup is complete.

Deployment success establishes that the built application was published. Interaction, downloaded-file, and native PDF verification are recorded separately below.

## Automated and source checks

| Check | Result |
| --- | --- |
| `npm run check` | Passed: 33 files, 0 errors, 0 warnings, 0 hints |
| `npm test` | Passed: 67 tests, 0 failures |
| Production build for `https://md.qft.org/` | Passed: 5 static pages |
| Production build for a GitHub project path | Passed for `https://reuse-example.github.io/reuse-check/` |
| Built links and fonts | Both builds passed: 80 HTML links/assets and 86 font references in linked stylesheets |
| CSP, canonical URLs, and internal URLs | Passed for domain-root and project-path builds |
| Dependencies and licenses | `package.json`, lockfile, MIT license, and third-party notices are unchanged |

New regression coverage includes conservative cleanup of complete Markdown wrappers, protected mathematical/code content, heading promotion, CRLF handling in structural helpers, whole-section movement, escaping appended headings, presentation allowlists, title reuse, table-of-contents anchors, original-draft preservation, stale append/cleanup targets, queued PDF actions, and duplicate print activation. The prior rendering, draft-conflict, autosave, and deployment tests continue to pass.

Source review also addressed short-screen welcome and PDF-panel layouts, preview anchor collisions, failed-image diagnostics, title-length bounds during duplication, and presentation settings for conflict-recovered drafts. Vite still reports its existing large-editor-bundle advisory; builds succeed.

## Current browser verification

The deployed application was exercised in Chrome at `https://md.qft.org/`. Verified:

- A previously saved draft loaded after the deployment; creating a blank document showed the new welcome panel.
- The paste dialog accepted a document containing an outer Markdown fence, nested code, a table, and all four mathematical delimiter styles.
- Cleanup showed the original and proposed source, removed the enclosing wrapper, promoted headings, and created a separate formatted draft while keeping the original.
- The formatted document rendered all four equations, its table, and its inner code block.
- The organizer moved a complete section and Undo restored the original order.
- Document search matched text inside drafts as well as document titles.
- PDF setup changed the selected style, paper size, orientation, font size, margins, author, and table of contents. The preview reused the source title once and rendered its equations.
- The preview had no duplicate DOM IDs or horizontal overflow. Its table-of-contents links scrolled inside the preview.
- The active formatted draft and its rendered content survived a page reload.

These checks cover the document workflow and typography preview. Reopened HTML downloads and an actual PDF saved through the native print dialog were not verified in this session. Mobile interaction checks were not repeated for this revision.

## PDF behavior and remaining checks

Save PDF prepares a clean HTML/text print document with the selected style and opens the browser's print dialog. The in-app preview shows typography at the selected paper width; final pagination is determined by the browser. It is not a direct PDF downloader or an exact paginated preview.

Native PDF checks should verify A4/Letter dimensions, portrait/landscape, margins, selectable/searchable prose, mathematical glyphs, long tables/code, internal links, and mixed-language text. A print-dialog action alone is not evidence that a PDF was saved successfully. Standalone HTML should also be downloaded and reopened independently to confirm its embedded fonts and images.

---

## Earlier deployment revision record

The following is the historical verification record for the GitHub Pages migration at commit [`dab9687e636929a9b01cd1babeedd84babec3e2e`](https://github.com/renphysics/md.qft.org/commit/dab9687e636929a9b01cd1babeedd84babec3e2e), recorded on 2026-10-29. At that stage, the checks below were local and repository/domain setup remained to be completed. That setup was subsequently completed; the current deployment status is recorded above. These older browser checks are not claims about the new document-workflow interface.

### Earlier automated checks

| Check | Result |
| --- | --- |
| Clean `npm ci` installation | Passed with Node 24.22.1 and npm 11.9.0 |
| `npm run check` | Passed: 0 errors, 0 warnings, 0 hints |
| `npm test` | Passed: 38 tests, 0 failures |
| Production build for `https://md.qft.org/` | Passed: 5 static pages |
| Production build for `https://reuse-example.github.io/reuse-check/` | Passed: 5 static pages |
| Built navigation and assets | Both URL layouts passed: 78 HTML links/asset references and 86 font references in the stylesheets used by the pages |
| Pages workflow configuration | YAML parsed; main-branch guard, build/deploy dependency, permissions, metadata-derived URL, and immutable action pins checked |
| License preservation | Original MIT license and all preserved dependency license texts are unchanged |

The tests cover mathematical delimiters, malformed formula recovery, source-line diagnostics, literal code, escaped HTML, unsafe links, optional images, macro isolation and expansion limits, unique heading IDs, footnotes, task lists, example documents, exact source persistence, atomic competing saves, deleted-document conflicts, unavailable storage, and autosave races. New checks cover deployment URL parsing, separate project-path storage names, and continued access to the original root-domain draft database.

The built-output audit checked canonical URLs, internal navigation, example links, favicon, scripts, styles, and font files for both a domain root and a project path. It also checked that each page includes its CSP and no-referrer meta tags, no inline executable scripts, and no obsolete hosting configuration or previous-site references. Source-code and MIT-license links are visible in the workspace and supporting pages.

Vite still reports a bundle-size advisory because the editor, Markdown parser, and math renderer run in the browser. Both production builds complete successfully. This revision does not suppress the advisory.

### Earlier browser checks

The built production files were served in the available Chrome environment, with the production CSP active. Verified:

- Root deployment opens the editor and still shows previously saved local drafts.
- The `/reuse-check/` project deployment uses its own draft list and correctly prefixed navigation.
- A new project-path draft renders all four mathematical delimiter styles and a task list.
- The new draft's exact source survives autosave and a page reload.
- About and license navigation works at both deployment paths.
- The About page explains MIT reuse, provides the source link, displays the original license, and preserves dependency notices.
- Standalone HTML export at the project path completes font collection and document generation, reaching its download-ready state.
- No application CSP violations or application errors appeared in the inspected browser logs. Browser-extension diagnostics were unrelated to the app.

The initial release's browser checks also covered Markdown file import, document renaming and switching, the outline, light/dark themes, and 320 px/390 px layouts. Those broader checks were not all repeated for this deployment-focused revision.

### Earlier verification limits

The generated HTML download was not reopened independently during this revision, and native print/PDF dialogs were not exercised. The earlier download-event interface timed out, so a successful export-generation message is not treated as proof that a downloaded file was reopened successfully. Follow the download/reopen and native print checks in [DEPLOYMENT.md](DEPLOYMENT.md) in the browsers you intend to support.

The local production preview at that time did not establish live deployment, DNS, or HTTPS status. Those deployment checks have since been completed, as recorded in the current deployment section. GitHub Pages delivers the documented CSP and referrer policies through the HTML rather than configurable response headers.

Drafts are scoped to the browser, origin, and application base path. Notes on a project hostname/path do not automatically transfer to a custom domain. Export Markdown before changing addresses and import it at the new address.
