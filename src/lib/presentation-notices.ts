import type { DeckKind } from './deck-types';

/**
 * Licence notices for the standalone HTML download of a presentation.
 *
 * The download carries this application's player code and, for presentations
 * that used them, the copies of reveal.js, its plugins, KaTeX and the theme
 * fonts that come with this site. Their licences ask for the copyright notice
 * and licence text in every copy, so the export lists exactly the components
 * whose code is in the finished document. The texts are plain text: the
 * export sets them as escaped text in the outer page, never as markup.
 *
 * This module has no ?raw imports so that Node tests can use it; the browser
 * passes the texts from presentation-notice-texts.ts.
 */

export interface PresentationNotice {
  /** One line naming the component and its licence. */
  title: string;
  /** The copyright notice and licence text. */
  text: string;
}

/** Licence files read from the installed packages. */
export interface PresentationLicenceTexts {
  /** This application's LICENSE (MIT). */
  application: string;
  /** reveal.js LICENSE (MIT). */
  reveal: string;
  /** highlight.js LICENSE (BSD 3-Clause). */
  highlight: string;
  /** KaTeX LICENSE (MIT). */
  katex: string;
  /** reveal.js css/theme/fonts/source-sans-pro/LICENSE (SIL Open Font License 1.1, full text). */
  sourceSansPro: string;
}

/**
 * marked's LICENSE.md (marked 17.0.5, which reveal.js 6.0.2 bundles in its
 * markdown plugin). It includes John Gruber's Markdown licence. marked is not
 * installed as a package of its own, so the text is kept here, as in
 * THIRD_PARTY_NOTICES.md.
 */
export const MARKED_LICENSE = `# License information

## Contribution License Agreement

If you contribute code to this project, you are implicitly allowing your code
to be distributed under the MIT license. You are also implicitly verifying that
all code is your original work. \`</legalese>\`

## Marked

Copyright (c) 2018+, MarkedJS (https://github.com/markedjs/)
Copyright (c) 2011-2018, Christopher Jeffrey (https://github.com/chjj/)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

## Markdown

Copyright © 2004, John Gruber
http://daringfireball.net/
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
* Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
* Neither the name “Markdown” nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

This software is provided by the copyright holders and contributors “as is” and any express or implied warranties, including, but not limited to, the implied warranties of merchantability and fitness for a particular purpose are disclaimed. In no event shall the copyright owner or contributors be liable for any direct, indirect, incidental, special, exemplary, or consequential damages (including, but not limited to, procurement of substitute goods or services; loss of use, data, or profits; or business interruption) however caused and on any theory of liability, whether in contract, strict liability, or tort (including negligence or otherwise) arising in any way out of the use of this software, even if advised of the possibility of such damage.
`;

/** KaTeX's mhchem extension: its header, which names the MathJax licence it keeps. */
export const MHCHEM_NOTICE = `KaTeX mhchem.js implements a KaTeX version of mhchem version 3.3.0, adapted from
MathJax/extensions/TeX/mhchem.js. This code, as other KaTeX code, is released under the MIT license
(see the KaTeX notice).

MathJax/extensions/TeX/mhchem.js
Copyright (c) 2011-2015 The MathJax Consortium
Copyright (c) 2015-2018 Martin Hensel

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
`;

const LEAGUE_GOTHIC_NOTICE = 'League Gothic: Copyright 2009–2011, The League of Moveable Type. Licensed under the SIL Open Font License, Version 1.1, whose text follows.';

/*
 * What marks each component in the finished document. The bundled files are
 * inlined as they ship, so these strings survive linking: the reveal.js
 * banner, the global names the plugins' UMD wrappers assign, KaTeX's font
 * families and stylesheet, mhchem's \ce macro definition, and the @font-face
 * rules of the reveal.js themes. A presentation that brought its own copy of
 * one of these libraries in its ZIP gets the same notice, which is also right.
 */
const MARKS = {
  reveal: /Hakim El Hattab/,
  highlight: /\bRevealHighlight\b/,
  markdown: /\bRevealMarkdown\b/,
  katex: /KaTeX_(?:Main|Math|AMS)|\.katex\s*\{|\bkatex\.render\b/,
  mhchem: /mhchem/i,
  sourceSansPro: /@font-face\s*\{[^{}]{0,200}?font-family\s*:\s*["']?Source Sans Pro/i,
  leagueGothic: /@font-face\s*\{[^{}]{0,200}?font-family\s*:\s*["']?League Gothic/i,
} as const;

/**
 * The notices for the standalone copy of a presentation whose finished
 * document is html. The application's own notice always comes first. A
 * converted Slidev build carries only the application's notice: what is
 * inside it is the presentation author's own build.
 */
export function presentationNotices(html: string, kind: DeckKind | undefined, texts: PresentationLicenceTexts): PresentationNotice[] {
  const notices: PresentationNotice[] = [
    { title: 'QFT Markdown presentation player · MIT License', text: texts.application },
  ];
  if (kind === 'slidev-build' || kind === 'slidev-source' || typeof html !== 'string') return notices;
  const has = (mark: RegExp) => mark.test(html);
  if (has(MARKS.reveal)) notices.push({ title: 'reveal.js · MIT License', text: texts.reveal });
  if (has(MARKS.highlight)) notices.push({ title: 'highlight.js, inside the reveal.js highlight plugin · BSD 3-Clause License', text: texts.highlight });
  if (has(MARKS.markdown)) notices.push({ title: 'marked and Markdown, inside the reveal.js markdown plugin · MIT License and BSD-style Markdown License', text: MARKED_LICENSE });
  if (has(MARKS.katex)) notices.push({ title: 'KaTeX math typesetting and fonts · MIT License', text: texts.katex });
  if (has(MARKS.katex) && has(MARKS.mhchem)) notices.push({ title: 'mhchem, inside KaTeX · MIT License and Apache License 2.0', text: MHCHEM_NOTICE });
  const fonts = [has(MARKS.sourceSansPro) && 'Source Sans Pro', has(MARKS.leagueGothic) && 'League Gothic'].filter((name): name is string => !!name);
  if (fonts.length) {
    const intro = `Fonts embedded from the reveal.js theme: ${fonts.join(' and ')}.`;
    const league = fonts.includes('League Gothic') ? `\n\n${LEAGUE_GOTHIC_NOTICE}` : '';
    notices.push({ title: `${fonts.join(' and ')} fonts · SIL Open Font License 1.1`, text: `${intro}${league}\n\n${texts.sourceSansPro}` });
  }
  return notices;
}
