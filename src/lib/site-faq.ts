import { siteConfig } from '../config/site';

export interface SiteFaq {
  readonly question: string;
  readonly answer: string;
}

/** Keep visible FAQ answers and structured data tied to the same facts. */
export const siteFaqs: readonly SiteFaq[] = [
  {
    question: `Is ${siteConfig.name} free to use? Do I need an account?`,
    answer: `${siteConfig.name} is a free, open-source Markdown editor with math preview, local images, interactive slides, and document exports. You can edit notes, organize sections, present slides with physics demonstrations, and prepare a PDF without creating an account. The editor runs in your browser.`,
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
    answer: 'Drafts, imported pictures, and lesson source files are saved in this browser. They do not automatically synchronize between browsers, profiles, devices, or website addresses. Clearing site data or using private browsing can remove them. Download Project ZIP for a lesson with separate demo files, Markdown + images for drafts with local pictures, or Slide bundle to retain the slide settings, then use Open file to import the ZIP elsewhere. Plain Markdown downloads contain source text and references. Document PDF-style preferences are stored separately.',
  },
  {
    question: 'Does the website upload my text or load external images?',
    answer: 'The application processes document text, imported pictures, and presentations in your browser and does not upload them to a rendering or AI service. The site host still receives ordinary requests needed to load the website. Remote images are off by default; enabling them contacts their image hosts, and opening an external link visits that website. HTML export embeds enabled remote images only when they can be downloaded successfully.',
  },
  {
    question: 'How do I insert a picture into Markdown?',
    answer: 'Choose Insert image, paste an image into the editor, or drop image files onto the workspace. PNG, JPEG, WebP, and GIF are supported, with limits of 8 MB per image, 24 MB in total, and 50 local images per document. Images are saved with the draft in this browser. Download Markdown + images to move the editable document and its pictures together; importing a plain Markdown file does not import neighboring image files.',
  },
  {
    question: 'Can I make and present Markdown slides with mathematical equations?',
    answer: 'Yes. Choose Slides in the Document / Slides selector, then separate slides with a line containing --- and blank lines on either side. The Markdown and KaTeX renderer handles text, equations, images, lists, and code. Choose Paper, Midnight, or Academic styling and 16:9 or 4:3 proportions. Present opens fullscreen playback. Save PDF prepares one page per slide, and HTML export creates a standalone interactive presentation. This Reveal.js format does not interpret Marp directives or Slidev components; Reveal.js presentations and Slidev builds made elsewhere open in a separate presentation library.',
  },
  {
    question: 'Can I open a Reveal.js or Slidev presentation that an AI made?',
    answer: 'Yes. Use Open file, or Presentations in the sidebar, for a Reveal.js presentation saved as one HTML file or as a ZIP with index.html at the top, another web page, a ZIP of a Slidev project with its built dist folder (or of the dist folder alone), or a portable Slidev package. The file is prepared in your browser so it plays offline: Reveal.js and KaTeX from a CDN are replaced by the copies that come with this site, MathJax formulas are typeset with KaTeX, and Google Fonts, other libraries from the internet, remote pictures, and embedded web pages are left out. Notes from the check list every change, and Copy report for AI gives your AI assistant a short report to fix the presentation. It plays in an isolated player that cannot read your documents and blocks ordinary network requests; links to websites, also from a button you click, open in a new tab only after you confirm the address shown. Pop-up questions, new windows, printing and sending forms do not work in the player (a quiz form whose script checks the answers does), and data a presentation saves in the browser lasts only until it stops. ZIPs made on Windows with file names in an old code page, such as GBK, are read in the code page the slides use. An unbuilt Slidev project must be built first.',
  },
  {
    question: 'Can I edit a presentation in the browser?',
    answer: 'Reveal.js presentations and other web pages, yes. Open Source files, change a text file, and choose Apply changes: a Reveal.js presentation replays on the same slide, and other pages start again from the beginning. Edits are saved in this browser beside the original file, which is never changed; Discard changes to this file removes typing that is not applied yet, ZIP downloads the edited presentation, and Original the file as imported. Text files up to 2 MB can be edited, with 8 MB of edited text in total. Slidev builds and portable Slidev packages are read-only: change the Slidev project, build it again, and open the new ZIP. Choose Create with AI and then Reveal.js or Slidev for instructions to give your AI assistant.',
  },
  {
    question: 'Can a slide contain a working JavaScript demonstration?',
    answer: 'Yes. Choose Interactive demo to insert a wave packet, Bloch sphere, effective-potential plot, or interference demonstration, or paste self-contained HTML, CSS, and JavaScript. An explicit interactive fence creates a demo card; choose Run demo to start it. Stop removes the running frame and Restart begins again. Timers and animations pause on inactive slides or browser tabs. Ordinary HTML and JavaScript code blocks are still displayed as code.',
  },
  {
    question: 'How do I ask AI to create slides with pictures and interactive demos?',
    answer: 'Choose Create with AI, pick a format, enter the class topic and teaching details, then copy the generated instructions into your AI assistant. Markdown gives a lesson ZIP that you edit in this workspace, with a starter ZIP as a working example; use Check lesson to find compatibility issues. Reveal.js works with any AI: it returns one index.html, and no starter is needed. Slidev needs an assistant that can run commands, or a computer with Node.js: it returns one ZIP of the Slidev project with its built dist folder, and its starter ZIP is an optional example. Open what the AI returns here and read the notes from the check; Copy report for AI helps the AI fix a presentation. The website itself does not upload a chapter or call an AI service. Run each demo and rehearse the presentation before class.',
  },
  {
    question: 'Can I revise an AI lesson without losing its images and demo files?',
    answer: 'Yes. A Project ZIP keeps the Markdown, local pictures, separate self-contained HTML demos, and supported text source files together. Edit slides directly, use Edit demo for starting parameters or HTML, and use Lesson files for other source files. Give the latest Project ZIP to AI for revisions and ask it to preserve the project identity and file paths. Reopening the revised ZIP lets you review changes, update the saved lesson with a recovery copy, or import a new copy.',
  },
  {
    question: 'How are custom interactive demos isolated?',
    answer: 'Each demo runs in a sandboxed frame with a separate origin, so it cannot read the editor’s drafts or change its interface. Use self-contained source and addEventListener for controls; external scripts, module imports, network calls, inline event attributes, nested frames, and popup windows are not supported. The limit is 20 demos per document and 100,000 source characters per custom demo, within the editor’s overall source limit. A sandbox does not prevent inefficient or unbounded computations.',
  },
  {
    question: 'Do interactive demonstrations work in HTML and PDF exports?',
    answer: 'Standalone HTML includes supported self-contained demos and their player. Recipients choose Run demo, and each demo starts from its source-defined initial state, including starting parameters saved with Edit demo. PDF output is static: it uses the most recently captured canvas image when available, otherwise a built-in demo’s initial illustration or a labeled placeholder for a custom demo. Add an ordinary image for a custom visualization that needs a specific PDF figure. Project ZIP keeps separate demo files; transient slider changes or animation time during playback are not saved.',
  },
  {
    question: 'Can I format and organize an AI-generated answer?',
    answer: 'Yes. Paste the answer as plain text or Markdown, then open Clean up and choose General Markdown or HackMD. Review the highlighted changes and compatibility notes, then copy the result or create a formatted draft. The original draft is retained. Organize moves complete sections, including their nested headings, equations, and code, and offers Undo move. These tools work locally and preserve the wording; they do not summarize the answer, verify its claims, or validate its citations.',
  },
  {
    question: 'Why is Create formatted copy disabled in Clean up?',
    answer: 'A formatted copy requires selected changes that alter the original text. The dialog explains whether its checks found no changes, suggestions are unchecked, or the document exceeds a processing limit. Copy Markdown or Copy for HackMD remains available for nonempty output even when no changes are found. No changes found by these checks is not a guarantee that every feature will render in another editor.',
  },
  {
    question: 'How do I prepare AI-generated mathematics for HackMD?',
    answer: String.raw`Choose Clean up, select HackMD under Format for, and review Prepare mathematics for HackMD. The formatter converts recognized \(...\) and \[...\] delimiters to dollar syntax and safely handles conflicts such as a standalone = line becoming a Markdown heading, even inside $$ delimiters. Use Copy for HackMD and check the result in HackMD's preview. Code and genuine TeX row breaks are preserved; ambiguous escaping is left for review. Copying does not publish a note, upload local pictures, or transfer interactive demo playback. Custom mathematical macros may need adjustment for HackMD's MathJax configuration.`,
  },
  {
    question: 'Can I download editable Markdown or standalone HTML?',
    answer: 'Yes. Markdown download preserves source text. With local pictures, the download becomes Markdown + images, an editable ZIP bundle. Slide bundle retains the slide settings even without pictures. For a lesson project, Project ZIP keeps its Markdown, separate demo files, pictures, and other supported source files together. Standalone HTML includes rendered content, fonts, images, and supported interactive demos, and opens independently of this editor. Document HTML includes the source in a disclosure; slide HTML also includes presentation playback. Enabled remote images must be embedded successfully, or export reports the problem. Reopening the editor website itself offline is not guaranteed.',
  },
  {
    question: 'Can I reuse the source and host my own version?',
    answer: 'Yes. The application source is available under the MIT license. You can fork it, change its name and styles, and host your own copy on GitHub Pages or another static host. Preserve the software’s copyright and permission notice, together with the applicable library and font notices. Using the editor does not place your documents under the software’s license.',
  },
];
