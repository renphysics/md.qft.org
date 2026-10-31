import { siteConfig } from '../config/site';

export interface SiteFaq {
  readonly question: string;
  readonly answer: string;
}

/** Keep visible FAQ answers and structured data tied to the same facts. */
export const siteFaqs: readonly SiteFaq[] = [
  {
    question: `Is ${siteConfig.name} free to use? Do I need an account?`,
    answer: `${siteConfig.name} is a free, open-source Markdown editor with math preview, local images, slides, and document exports. You can edit notes, organize sections, present a slide deck, and prepare a PDF without creating an account. The editor runs in your browser.`,
  },
  {
    question: 'Which mathematical notation does the editor support?',
    answer: String.raw`Inline math uses $...$ or \(...\), and displayed equations use $$...$$ or \[...\]. KaTeX renders a supported subset of TeX mathematics, including fractions, matrices, and aligned equations. It does not compile a complete LaTeX document. Math inside code spans or fenced code blocks stays literal, and rendering errors are shown beside the document.`,
  },
  {
    question: 'How do I convert Markdown to PDF?',
    answer: 'Paste your Markdown or open a Markdown file, then choose Save PDF. In Document mode, select Clean, Study Notes, or Academic styling and adjust paper, margins, and text size. In Slides mode, PDF output uses one page per slide. Save through the browser’s print dialog and check its preview for final pagination. Chromium-based browsers are recommended for slide PDFs.',
  },
  {
    question: 'Where are my drafts saved? Can I open them on another device?',
    answer: 'Drafts and imported pictures are saved in this browser. They do not automatically synchronize between browsers, profiles, devices, or website addresses. Clearing site data or using private browsing can remove them. Download Markdown + images for drafts with local pictures, or Slide bundle to retain a deck’s slide settings, then use Open file to import the ZIP elsewhere. Plain Markdown downloads contain source text and image references. Document PDF-style preferences are stored separately.',
  },
  {
    question: 'Does the website upload my text or load external images?',
    answer: 'The application processes document text and imported pictures in your browser and does not upload them to a rendering or AI service. The site host still receives ordinary requests needed to load the website. Remote images are off by default; enabling them contacts their image hosts, and opening an external link visits that website. HTML export embeds enabled remote images only when they can be downloaded successfully.',
  },
  {
    question: 'How do I insert a picture into Markdown?',
    answer: 'Choose Insert image, paste an image into the editor, or drop image files onto the workspace. PNG, JPEG, WebP, and GIF are supported, with limits of 8 MiB per image, 24 MiB in total, and 50 local images per document. Images are saved with the draft in this browser. Download Markdown + images to move the editable document and its pictures together; importing a plain Markdown file does not import neighboring image files.',
  },
  {
    question: 'Can I make and present Markdown slides with mathematical equations?',
    answer: 'Yes. Choose Slides in the Document / Slides selector, then separate slides with a line containing --- and blank lines on either side. The same Markdown and KaTeX renderer handles text, equations, images, lists, and code. Choose Paper, Midnight, or Academic styling and 16:9 or 4:3 proportions. Present opens fullscreen playback. Save PDF prepares one page per slide, and HTML export creates a standalone interactive presentation. Marp directives and Slidev components are not supported.',
  },
  {
    question: 'Can I format and organize an AI-generated answer?',
    answer: 'Yes. Paste the answer as plain text or Markdown, then use Clean up to review formatting changes before creating a formatted copy. The original draft is retained. Organize moves complete sections, including their nested headings, equations, and code, and offers Undo move. These tools do not call an AI model, rewrite or summarize the answer, verify its claims, or validate its citations.',
  },
  {
    question: 'Can I download editable Markdown or standalone HTML?',
    answer: 'Yes. Markdown download preserves source text. With local pictures, the download becomes Markdown + images, an editable ZIP bundle. Slide bundle retains a deck’s slide settings even without pictures. Standalone HTML includes rendered content, fonts, and images, and opens independently of this editor. Document HTML includes the source in a disclosure; slide HTML includes interactive playback. Enabled remote images must be embedded successfully, or export reports the problem. Reopening the editor website itself offline is not guaranteed.',
  },
  {
    question: 'Can I reuse the source and host my own version?',
    answer: 'Yes. The application source is available under the MIT license. You can fork it, change its name and styles, and host your own copy on GitHub Pages or another static host. Preserve the software’s copyright and permission notice, together with the applicable library and font notices. Using the editor does not place your documents under the software’s license.',
  },
];
