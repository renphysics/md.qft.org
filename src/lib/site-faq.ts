import { siteConfig } from '../config/site';

export interface SiteFaq {
  readonly question: string;
  readonly answer: string;
}

/** Keep visible FAQ answers and structured data tied to the same facts. */
export const siteFaqs: readonly SiteFaq[] = [
  {
    question: `Is ${siteConfig.name} free to use? Do I need an account?`,
    answer: `${siteConfig.name} is a free, open-source Markdown editor with math preview and document exports. You can paste text, edit notes, organize sections, and prepare a PDF without creating an account. The editor runs in your browser.`,
  },
  {
    question: 'Which mathematical notation does the editor support?',
    answer: String.raw`Inline math uses $...$ or \(...\), and displayed equations use $$...$$ or \[...\]. KaTeX renders a supported subset of TeX mathematics, including fractions, matrices, and aligned equations. It does not compile a complete LaTeX document. Math inside code spans or fenced code blocks stays literal, and rendering errors are shown beside the document.`,
  },
  {
    question: 'How do I convert Markdown to PDF?',
    answer: 'Paste your Markdown or open a Markdown file, then choose Save PDF. Select Clean, Study Notes, or Academic styling and adjust paper size, orientation, margins, and text size. The Save PDF action in that panel opens your browser’s print dialog; choose its PDF destination. The app previews typography, while the browser’s print preview determines final pagination.',
  },
  {
    question: 'Where are my drafts saved? Can I open them on another device?',
    answer: 'Drafts are saved in IndexedDB, a database in this browser. They do not automatically synchronize between browsers, profiles, devices, or website addresses. Clearing site data or using private browsing can remove them. Download Markdown for an independent editable copy, then import that file where you want to continue working. Document-style preferences are stored separately and do not travel with the Markdown file.',
  },
  {
    question: 'Does the website upload my text or load external images?',
    answer: 'The application processes document text in your browser and does not upload it to a rendering or AI service. The site host still receives ordinary requests needed to load the website. Remote images are off by default; enabling them contacts their image hosts, and opening an external link visits that website. HTML export embeds enabled remote images only when they can be downloaded successfully.',
  },
  {
    question: 'Can I format and organize an AI-generated answer?',
    answer: 'Yes. Paste the answer as plain text or Markdown, then use Clean up to review formatting changes before creating a formatted copy. The original draft is retained. Organize moves complete sections, including their nested headings, equations, and code, and offers Undo move. These tools do not call an AI model, rewrite or summarize the answer, verify its claims, or validate its citations.',
  },
  {
    question: 'Can I download editable Markdown or a standalone HTML document?',
    answer: 'Yes. Markdown download preserves the current source as an editable text file. Standalone HTML includes the rendered document, the selected presentation, embedded mathematical fonts, and the original Markdown in a disclosure. It can be opened independently of this editor. Enabled remote images must be embedded successfully, or export reports the problem. Reopening the editor website itself offline is not guaranteed.',
  },
  {
    question: 'Can I reuse the source and host my own version?',
    answer: 'Yes. The application source is available under the MIT license. You can fork it, change its name and styles, and host your own copy on GitHub Pages or another static host. Preserve the software’s copyright and permission notice, together with the applicable library and font notices. Using the editor does not place your documents under the software’s license.',
  },
];
