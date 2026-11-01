import revealRuntime from '../../node_modules/reveal.js/dist/reveal.js?raw';
import revealLicense from '../../node_modules/reveal.js/LICENSE?raw';
import revealCss from 'reveal.js/reveal.css?raw';
import katexLicense from 'katex/LICENSE?raw';
import documentCss from '../styles/document.css?raw';
import slideCss from '../styles/slides.css?raw';
import interactiveCss from '../styles/interactive-demos.css?raw';
import applicationLicense from '../../LICENSE?raw';
import { interactiveRuntimeSource } from '../scripts/interactive-demo-runtime';
import { escapeHtml, type RenderOptions } from './render-markdown';
import {
  DEFAULT_SLIDE_SETTINGS, normalizeSlideSettings, renderSlides, slideDimensions,
  type SlideSettings,
} from './slides';
import { download, embedImages, standaloneMathCss, waitForPrintAssets, exportScriptNonce, makeInteractivePrintCopy, namespacePrintIds } from './export-document';
import { siteConfig } from '../config/site';

let printing = false;

function staticSlideCss(settings: SlideSettings, prefix: string): string {
  const { width, height } = slideDimensions(settings);
  return `
${prefix}{width:${width}px!important;max-width:none!important;height:auto!important;overflow:visible!important;box-shadow:none!important;border:0!important;border-radius:0!important}
${prefix} .reveal{width:${width}px!important;height:auto!important;overflow:visible!important}
${prefix} .slides{position:static!important;display:block!important;width:${width}px!important;height:auto!important;margin:0!important;inset:auto!important;transform:none!important;perspective:none!important;overflow:visible!important;zoom:1!important}
${prefix} .slides>section.qft-slide{display:block!important;position:relative!important;inset:auto!important;transform:none!important;opacity:1!important;visibility:inherit!important;width:${width}px!important;height:${height}px!important;min-height:${height}px!important;max-height:${height}px!important;margin:0!important;overflow:hidden!important;break-inside:avoid!important;break-after:page!important;page-break-after:always!important;box-sizing:border-box!important}
${prefix} .slides>section.qft-slide:last-child{break-after:auto!important;page-break-after:auto!important}
${prefix} .qft-slide-content{box-sizing:border-box!important}
${prefix} .controls,${prefix} .progress,${prefix} .slide-number,${prefix} .backgrounds,${prefix} .speaker-notes{display:none!important}
`;
}

/** An offline presentation: no CDN scripts, image hosts, or font requests. */
export async function exportSlidesHtml(
  source: string, title: string, options: RenderOptions = {},
  value: SlideSettings = DEFAULT_SLIDE_SETTINGS,
): Promise<void> {
  const settings = normalizeSlideSettings(value);
  const rendered = renderSlides(source, options);
  if (!rendered.slides.length) throw new Error(rendered.errors[0]?.message ?? 'Add some Markdown before exporting slides.');
  const { width, height } = slideDimensions(settings);
  const slideSections = rendered.slides.map((slide, index) => `<section class="qft-slide" data-slide-index="${index}">${slide.html}</section>`).join('\n');
  const [mathStyle, html] = await Promise.all([standaloneMathCss(), embedImages(slideSections)]);
  const scriptNonce = exportScriptNonce();
  const script = `${revealRuntime}\n
const makePrintCopy = (${makeInteractivePrintCopy.toString()});
const namespacePrintIds = (${namespacePrintIds.toString()});
const deck = new Reveal(document.querySelector('.reveal'), {
  width:${width},height:${height},margin:0.04,minScale:0.05,maxScale:2,
  center:false,hash:true,transition:'none',backgroundTransition:'none',
  controls:true,progress:true,slideNumber:'c/t',showSlideNumber:'all',
  embedded:false,disableLayout:false,pdfSeparateFragments:false,pdfMaxPagesPerSlide:1,
  scrollActivationWidth:0,view:null,
  keyboardCondition:()=>!document.getElementById('source-document').open &&
    !(document.activeElement instanceof Element && document.activeElement.closest('input,select,textarea,button,iframe,[contenteditable="true"],.qft-demo'))
});
let demos;
deck.initialize().then(()=>{
  try{
    demos=(${interactiveRuntimeSource()})(document.querySelector('.export-deck'),{
      scriptNonce:${JSON.stringify(scriptNonce)},
      isActive:card=>!document.getElementById('source-document').open && !!deck.getCurrentSlide()?.contains(card),
      onLayout:()=>deck.layout(),
      onEscape:()=>{if(document.fullscreenElement)document.exitFullscreen().catch(()=>{});}
    });
    deck.on('slidechanged',()=>demos.sync());
  }catch(error){
    const status=document.getElementById('export-status');
    status.textContent='Interactive demonstrations could not start in this browser. Their static previews and source remain available.';
    status.hidden=false;
  }
}).catch(()=>{
  const status=document.getElementById('export-status');
  status.textContent='The presentation player could not start in this browser. Please try a current browser.';
  status.hidden=false;
});
document.getElementById('present').addEventListener('click',()=>{
  if(document.fullscreenElement) document.exitFullscreen().catch(()=>{});
  else document.documentElement.requestFullscreen?.().catch(()=>{});
});
let printCopy;
let printTimer;
function clearPrintCopy(){
  clearTimeout(printTimer);
  printCopy?.remove();
  printCopy=undefined;
  delete document.body.dataset.exportPrinting;
}
function preparePrintDeck(){
  clearPrintCopy();
  printCopy=document.querySelector('.export-deck').cloneNode(true);
  printCopy.className='qft-slide-deck export-print-copy';
  printCopy.querySelectorAll('.reveal > .backgrounds,.reveal > .controls,.reveal > .progress,.reveal > .slide-number,.reveal > .speaker-notes,.reveal > .pause-overlay').forEach(element=>element.remove());
  makePrintCopy(printCopy,demos?.snapshots() || new Map());
  namespacePrintIds(printCopy,'qft-export-print-');
  printCopy.querySelectorAll('[tabindex]').forEach(element=>element.removeAttribute('tabindex'));
  document.body.append(printCopy);
  document.body.dataset.exportPrinting='slides';
  return printCopy;
}
async function checkPrintLayout(){
  const measureDeck=preparePrintDeck();
  let timeout;
  try{
    void measureDeck.offsetHeight;
    await Promise.race([
      Promise.all([document.fonts.ready,...[...measureDeck.querySelectorAll('img')].map(image=>image.decode())]),
      new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('Images or fonts are taking too long to load. Please try again.')),20000);})
    ]);
    const overflow=[];
    measureDeck.querySelectorAll('.slides > section.qft-slide').forEach((slide,index)=>{
      const content=slide.querySelector('.qft-slide-content');
      if(content&&[content,...content.querySelectorAll('pre,.katex-display,table')].some(element=>
        element.scrollHeight>element.clientHeight+3||element.scrollWidth>element.clientWidth+3))overflow.push(index+1);
    });
    if(overflow.length)throw new Error('Slide'+(overflow.length===1?' ':'s ')+overflow.slice(0,12).join(', ')+(overflow.length>12?', …':'')+(overflow.length===1?' contains':' contain')+' too much content for this slide size. Shorten or split the content in the editor, then export again.');
  }catch(error){clearPrintCopy();throw error;}
  finally{clearTimeout(timeout);}
}
document.getElementById('save-pdf').addEventListener('click',async()=>{
  const pdfButton=document.getElementById('save-pdf');
  const exportStatus=document.getElementById('export-status');
  if(pdfButton.disabled)return;
  pdfButton.disabled=true;
  pdfButton.setAttribute('aria-busy','true');
  exportStatus.hidden=true;
  try{
    await checkPrintLayout();
    window.print();
    if(printCopy)printTimer=setTimeout(clearPrintCopy,300000);
  }catch(error){
    exportStatus.textContent=error instanceof Error?error.message:'The presentation could not be prepared for printing. Please try again.';
    exportStatus.hidden=false;
  }finally{
    pdfButton.disabled=false;
    pdfButton.removeAttribute('aria-busy');
  }
});
window.addEventListener('beforeprint',()=>{if(!printCopy)preparePrintDeck();});
window.addEventListener('afterprint',clearPrintCopy);
document.addEventListener('keydown',event=>{
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='p'){
    event.preventDefault();document.getElementById('save-pdf').click();
  }
});
document.getElementById('source-document').addEventListener('toggle',()=>{deck.layout();demos?.sync();});
window.addEventListener('pagehide',event=>{if(!event.persisted)demos?.destroy();});
`.replace(/<\/script/gi, '<\\/script');
  const warning = rendered.errors.length
    ? `<p class="export-warning">${rendered.errors.length} rendering issue${rendered.errors.length === 1 ? '' : 's'} remain in this presentation.</p>` : '';
  const exported = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="generator" content="${escapeHtml(siteConfig.name)}">
<meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${scriptNonce}'; script-src-attr 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; frame-src 'self' blob:; connect-src 'none'; base-uri 'none'; object-src 'none'; form-action 'none'">
<title>${escapeHtml(title || 'Markdown slides')}</title>
<style>
${revealCss}
${mathStyle}
${documentCss}
${slideCss}
${interactiveCss}
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#171719;color:#eee;font-family:system-ui,sans-serif}
*{box-sizing:border-box}
.export-deck{position:fixed;inset:42px 0 0;width:100%;height:calc(100% - 42px)}
.export-deck>.reveal{width:100%;height:100%}
.export-toolbar{position:fixed;inset:0 0 auto;height:42px;z-index:20;display:flex;align-items:center;gap:12px;padding:0 16px;background:#232327;color:#eee;font:12px/1.5 system-ui,sans-serif}
.export-toolbar strong{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-weight:500}
.export-toolbar button,.export-toolbar summary{color:inherit;background:none;border:1px solid #55555d;border-radius:5px;padding:4px 9px;font:inherit;cursor:pointer}
.export-toolbar button:focus-visible,.export-toolbar summary:focus-visible{outline:2px solid #cda5ae;outline-offset:2px}
.export-toolbar button:disabled{opacity:.55;cursor:wait}
.source-panel{position:fixed;z-index:30;inset:56px 16px 16px;background:#fff;color:#29282e;padding:24px;overflow:auto;border-radius:6px;box-shadow:0 8px 40px #0004}
.source-panel pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.7 ui-monospace,monospace}
.source-panel h2{font:600 18px/1.4 system-ui,sans-serif;margin:0 0 12px}
.source-panel details{margin-top:16px}
.export-warning{position:fixed;z-index:21;bottom:10px;left:16px;max-width:70%;padding:8px 12px;background:#fbe8ec;color:#922b40;font:12px/1.5 system-ui,sans-serif;border-radius:4px}
.export-status{position:fixed;z-index:25;top:48px;left:16px;right:16px;max-width:960px;margin:0;padding:12px 16px;border:1px solid #cf8796;border-radius:6px;background:#fff0f3;color:#84283d;font:14px/1.5 system-ui,sans-serif;box-shadow:0 3px 14px #0002}
${staticSlideCss(settings, '.export-print-copy')}
.export-print-copy{position:fixed;left:-20000px;top:0;visibility:hidden;pointer-events:none}
@page{size:${width}px ${height}px;margin:0}
@media print{
 html,body{width:auto!important;height:auto!important;overflow:visible!important;background:white!important;margin:0!important;padding:0!important}
 .export-toolbar,.export-warning,.export-status{display:none!important}
 .export-deck{position:static!important;inset:auto!important;print-color-adjust:exact;-webkit-print-color-adjust:exact}
 body[data-export-printing] .export-deck{display:none!important}
 .export-print-copy{display:block!important;position:static!important;visibility:visible!important;margin:0!important;padding:0!important;print-color-adjust:exact;-webkit-print-color-adjust:exact}
 ${staticSlideCss(settings, '.export-deck')}
}
</style>
</head>
<body>
<header class="export-toolbar"><strong>${escapeHtml(title || 'Markdown slides')}</strong><button id="present" type="button">Full screen</button><button id="save-pdf" type="button">Save PDF</button><details id="source-document"><summary>Source</summary><div class="source-panel"><h2>Original Markdown</h2><pre>${escapeHtml(source)}</pre><details><summary>reveal.js · MIT license</summary><pre>${escapeHtml(revealLicense)}</pre></details><details><summary>KaTeX math typesetting and fonts · MIT license</summary><pre>${escapeHtml(katexLicense)}</pre></details><details><summary>QFT Markdown demo runtime and built-in examples · MIT license</summary><pre>${escapeHtml(applicationLicense)}</pre></details></div></details></header>
${warning}
<p id="export-status" class="export-status" role="alert" hidden></p>
<main class="export-deck qft-slide-deck" data-slide-theme="${settings.theme}" data-slide-ratio="${settings.ratio}"><div class="reveal"><div class="slides">${html}</div></div></main>
<script nonce="${scriptNonce}">${script}</script>
</body></html>`;
  download(exported, title, 'html', 'text/html');
}

function namespacePrintAnchors(root: HTMLElement): void {
  const ids = new Map<string, string>();
  root.querySelectorAll<HTMLElement>('[id]').forEach((element) => {
    const id = `qft-print-slide-${element.id}`;
    ids.set(element.id, id);
    element.id = id;
  });
  root.querySelectorAll<HTMLLabelElement>('label[for]').forEach((label) => {
    const id = ids.get(label.htmlFor);
    if (id) label.htmlFor = id;
  });
  root.querySelectorAll<HTMLAnchorElement>('a[href^="#"]').forEach((anchor) => {
    let target = anchor.getAttribute('href')!.slice(1);
    try { target = decodeURIComponent(target); } catch { /* Retain literal malformed fragments. */ }
    const id = ids.get(target);
    if (id) anchor.setAttribute('href', `#${id}`);
  });
  root.querySelectorAll('[tabindex]').forEach((element) => element.removeAttribute('tabindex'));
}

/** Fixed-size print copies ensure one page per slide without moving the live deck. */
export async function printSlides(
  slides: readonly { html: string }[], title: string,
  value: SlideSettings = DEFAULT_SLIDE_SETTINGS,
  snapshots: ReadonlyMap<string, string> = new Map(),
): Promise<void> {
  if (printing || document.body.dataset.qftPrinting) return;
  if (!slides.length) throw new Error('Add some Markdown before exporting slides.');
  const settings = normalizeSlideSettings(value);
  const { width, height } = slideDimensions(settings);
  printing = true;
  let root: HTMLElement | undefined;
  let style: HTMLStyleElement | undefined;
  let cleanupTimer: number | undefined;
  const oldTitle = document.title;
  const restore = () => {
    root?.remove();
    style?.remove();
    document.title = oldTitle;
    delete document.body.dataset.qftPrinting;
    window.removeEventListener('afterprint', restore);
    if (cleanupTimer) window.clearTimeout(cleanupTimer);
    printing = false;
  };
  try {
    root = document.createElement('article');
    root.className = 'qft-print-slides qft-slide-deck';
    root.dataset.slideTheme = settings.theme;
    root.dataset.slideRatio = settings.ratio;
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML = `<div class="reveal"><div class="slides">${slides.map((slide, index) => `<section class="qft-slide" data-slide-index="${index}">${slide.html}</section>`).join('')}</div></div>`;
    makeInteractivePrintCopy(root, snapshots);
    namespacePrintAnchors(root);
    style = document.createElement('style');
    style.textContent = `${documentCss}\n${slideCss}\n${interactiveCss}\n${staticSlideCss(settings, '.qft-print-slides')}
.qft-print-slides{position:fixed;left:-20000px;top:0;visibility:hidden;pointer-events:none}
@media print{
 @page{size:${width}px ${height}px;margin:0}
 html,body{height:auto!important;overflow:visible!important;margin:0!important;padding:0!important;background:white!important}
 body[data-qft-printing]>:not(.qft-print-slides){display:none!important}
 .qft-print-slides{display:block!important;position:static!important;visibility:visible!important;margin:0!important;padding:0!important;print-color-adjust:exact;-webkit-print-color-adjust:exact}
 .qft-print-slides .qft-slide{print-color-adjust:exact;-webkit-print-color-adjust:exact}
}`;
    document.head.append(style);
    document.body.append(root);
    await waitForPrintAssets(root);
    const overflow: number[] = [];
    root.querySelectorAll<HTMLElement>('.slides > section.qft-slide').forEach((slide, index) => {
      const content = slide.querySelector<HTMLElement>('.qft-slide-content');
      if (!content) return;
      const candidates = [content, ...content.querySelectorAll<HTMLElement>('pre,.katex-display,table')];
      if (candidates.some((element) => element.scrollHeight > element.clientHeight + 3
        || element.scrollWidth > element.clientWidth + 3)) overflow.push(index + 1);
    });
    if (overflow.length) {
      throw new Error(`Slide${overflow.length === 1 ? '' : 's'} ${overflow.slice(0, 12).join(', ')}${overflow.length > 12 ? ', …' : ''} ${overflow.length === 1 ? 'contains' : 'contain'} too much content for the selected slide size. Split the content across slides or choose 4:3 before saving the PDF.`);
    }
    document.title = title || 'Markdown slides';
    document.body.dataset.qftPrinting = 'slides';
    root.removeAttribute('aria-hidden');
    window.addEventListener('afterprint', restore, { once: true });
    window.print();
    if (printing) cleanupTimer = window.setTimeout(restore, 5 * 60 * 1000);
  } catch (error) {
    restore();
    throw error;
  }
}
