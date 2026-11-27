/**
 * Shared helpers for the end-to-end browser suites. A suite is a module named
 * `*.browser.mjs` in this folder that exports `title` and a default
 * `async function (t)`; `run.mjs` discovers and runs every suite against one
 * server for the production build (./dist, or BASE_URL) and one browser.
 */
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const DIST = fileURLToPath(new URL('../../dist', import.meta.url));

export const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

/** Poll until `check` returns a truthy value; errors thrown while polling are retried. */
export async function until(check, label, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try { const value = await check(); if (value) return value; }
    catch (error) { last = error; }
    await sleep(100);
  }
  throw new Error(`Timed out: ${label}${last ? ` (${last.message})` : ''}`);
}

/**
 * Full Chromium, not the headless shell: the shell hides focus and process
 * model behaviour that real users see. QFT_BROWSER_EXECUTABLE points at a
 * locally installed build when Playwright's own download is unavailable.
 */
export function launchBrowser() {
  const executablePath = process.env.QFT_BROWSER_EXECUTABLE;
  return chromium.launch(executablePath ? { executablePath } : { channel: 'chromium' });
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.wasm': 'application/wasm', '.zip': 'application/zip', '.woff': 'font/woff',
  '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.webmanifest': 'application/manifest+json',
};

/**
 * Serve the production build in this checkout's dist folder (or `root`) on 127.0.0.1 with a small
 * static server: GET and HEAD only, a folder answers with its index.html
 * (a folder without its trailing slash is redirected, as on the static host),
 * anything else is 404 with the site's 404.html. Port 0 picks a free port, so
 * a server that already runs on the usual preview port is never mistaken for
 * this tree's build.
 */
export async function serveStatic(root = DIST, port = 0) {
  const base = resolve(root);
  if (!existsSync(join(base, 'index.html'))) throw new Error(`No build in ${base}: run "npm run build" first, or set BASE_URL.`);
  let output = '';
  const log = line => { output = (output + line + '\n').slice(-12_000); };
  const send = async (request, response, status, file, headers = {}) => {
    const body = file ? await readFile(file) : Buffer.alloc(0);
    response.writeHead(status, {
      'content-type': file ? TYPES[extname(file).toLowerCase()] || 'application/octet-stream' : 'text/plain',
      'content-length': body.length, 'cache-control': 'no-store', ...headers,
    });
    response.end(request.method === 'HEAD' ? undefined : body);
  };
  const server = createServer(async (request, response) => {
    try {
      if (request.method !== 'GET' && request.method !== 'HEAD') return void await send(request, response, 405, undefined, { allow: 'GET, HEAD' });
      const url = new URL(request.url || '/', 'http://localhost');
      let path;
      try { path = decodeURIComponent(url.pathname); } catch { return void await send(request, response, 400); }
      const file = resolve(base, `.${path}`);
      if (file !== base && !file.startsWith(base + sep)) return void await send(request, response, 404, join(base, '404.html'));
      const info = await stat(file).catch(() => undefined);
      if (info?.isDirectory()) {
        if (!path.endsWith('/')) return void await send(request, response, 301, undefined, { location: `${url.pathname}/${url.search}` });
        if (existsSync(join(file, 'index.html'))) return void await send(request, response, 200, join(file, 'index.html'));
      } else if (info?.isFile()) return void await send(request, response, 200, file);
      log(`404 ${url.pathname}`);
      await send(request, response, 404, existsSync(join(base, '404.html')) ? join(base, '404.html') : undefined);
    } catch (error) {
      log(`500 ${request.url}: ${error?.message || error}`);
      if (!response.headersSent) response.writeHead(500);
      response.end();
    }
  });
  await new Promise((done, fail) => { server.once('error', fail); server.listen(port, '127.0.0.1', () => { server.off('error', fail); done(); }); });
  const address = /** @type {import('node:net').AddressInfo} */ (server.address());
  return {
    baseUrl: `http://127.0.0.1:${address.port}/`,
    output: () => output,
    stop() { server.closeAllConnections(); server.close(); },
  };
}

/**
 * The site under test: BASE_URL when it names a server that is already
 * running (the gate runner and other checkouts use this), else this
 * checkout's ./dist served by serveStatic on a free port (or on
 * QFT_PREVIEW_PORT when that is set).
 */
export async function startPreview() {
  const server = process.env.BASE_URL
    ? { baseUrl: process.env.BASE_URL, output: () => '', stop() {} }
    : await serveStatic(DIST, Number(process.env.QFT_PREVIEW_PORT) || 0);
  await until(async () => (await fetch(server.baseUrl, { signal: AbortSignal.timeout(1000) })).ok, `the site at ${server.baseUrl}`);
  return server;
}

/** For the record of a failed request: the status of its response, the length the server announced, and the bytes the browser still has. */
async function describeResponse(request) {
  try {
    const response = await request.response();
    if (!response) return { status: null };
    const announced = response.headers()['content-length'];
    const received = await Promise.race([
      response.body().then(body => body.length, error => String(error?.message ?? error).split('\n')[0].slice(0, 120)),
      sleep(3000).then(() => 'no answer in 3 s'),
    ]);
    return { status: response.status(), announced: announced === undefined ? null : Number(announced), received };
  } catch (error) {
    return { status: String(error?.message ?? error).split('\n')[0].slice(0, 120) };
  }
}

/**
 * Per-suite state: named steps, observed pages, and the error, console,
 * failed-request, and external-request records that every suite must keep empty.
 *
 * Every failed request is recorded with the step it happened in, its page
 * and its kind, so that the results file alone says where it came from.
 *
 * One kind of report is not a failed resource. On GitHub's runner the Check
 * workflow failed the `slides` suite twice in the same place: while the HTML
 * export fetched its 20 font files, the browser reported the first one, and
 * then the first three, as aborted (`net::ERR_ABORTED`), although the export
 * went on and wrote a file with every font in it. The Chromium build on the
 * development machine never reports this. A suite that has proof that the
 * page received a file in full, as the export step has in the bytes of the
 * exported file, hands the proof to `setAsideDelivered()`: such a report is
 * then listed in `deliveredDespiteAbort` and does not fail the suite. Any
 * other failed request still does.
 */
export class SuiteContext {
  constructor({ browser, baseUrl, artifacts, name }) {
    this.browser = browser;
    this.baseUrl = baseUrl;
    this.artifacts = artifacts;
    this.name = name;
    this.checks = [];
    this.pageErrors = [];
    this.consoleErrors = [];
    this.failedRequests = [];
    this.deliveredDespiteAbort = [];
    this.externalRequests = [];
    this.currentStep = undefined;
    this.observedPages = [];
    this.contexts = [];
    this.allowedConsole = [];
    this.allowedPageErrors = [];
    this.allowedBlockedRequests = [];
  }

  /** Run one named, user-visible behaviour. */
  async step(name, action) {
    this.currentStep = name;
    await action();
    this.checks.push(name);
    console.log(`PASS ${this.name}: ${name}`);
  }

  /** Accept a console error that a suite provokes deliberately. */
  allowConsoleError(pattern) { this.allowedConsole.push(pattern); }

  /** Accept an uncaught page or frame error that a suite provokes deliberately. */
  allowPageError(pattern) { this.allowedPageErrors.push(pattern); }

  /**
   * Accept a request that a suite provokes deliberately and that a Content
   * Security Policy stops in the browser, so that it never reaches the network.
   */
  allowBlockedRequest(pattern) { this.allowedBlockedRequests.push(pattern); }

  /**
   * Set aside the browser's reports that a fetch was aborted, for files that
   * the page is known to have received in full: `delivered(url)` is the
   * suite's proof. Returns the reports that were set aside.
   */
  setAsideDelivered(delivered) {
    const aside = this.failedRequests.filter(request => request.error === 'net::ERR_ABORTED' && request.resource === 'fetch' && delivered(request.url));
    // In place: a suite may hold on to the list.
    this.failedRequests.splice(0, this.failedRequests.length, ...this.failedRequests.filter(request => !aside.includes(request)));
    this.deliveredDespiteAbort.push(...aside);
    return aside;
  }

  observe(page) {
    this.observedPages.push(page);
    page.on('pageerror', error => {
      if (this.allowedPageErrors.some(pattern => pattern.test(error.message))) return;
      this.pageErrors.push({ page: page.url(), message: error.message });
    });
    page.on('console', message => {
      if (message.type() !== 'error') return;
      const text = message.text();
      if (this.allowedConsole.some(pattern => pattern.test(text))) return;
      this.consoleErrors.push({ page: page.url(), message: text });
    });
    page.on('requestfailed', request => {
      const error = request.failure()?.errorText;
      if (error === 'csp' && this.allowedBlockedRequests.some(pattern => pattern.test(request.url()))) return;
      // Enough to tell from the results alone where a failure came from.
      const record = { url: request.url(), error, step: this.currentStep, resource: request.resourceType(), method: request.method(), page: page.url() };
      this.failedRequests.push(record);
      // Whether the page had an answer, and how much of it the browser can still hand over.
      void describeResponse(request).then(details => Object.assign(record, details));
    });
    return page;
  }

  /**
   * A new browser context that fails closed on any request to another origin,
   * so a CDN dependency is reported instead of silently loaded.
   */
  async newContext(options = {}) {
    const context = await this.browser.newContext({ viewport: { width: 1440, height: 1000 }, ...options });
    this.contexts.push(context);
    const allowedOrigin = new URL(this.baseUrl).origin;
    await context.route('**/*', route => {
      const url = route.request().url();
      if (/^https?:/.test(url) && new URL(url).origin !== allowedOrigin) {
        this.externalRequests.push(url);
        return route.abort();
      }
      return route.continue();
    });
    return context;
  }

  async newPage(options = {}) {
    const context = await this.newContext(options);
    const page = this.observe(await context.newPage());
    return { context, page };
  }

  /** Open the workspace and wait for the editor. */
  async openWorkspace(page, query = '') {
    await page.goto(new URL(query, this.baseUrl).href, { waitUntil: 'networkidle' });
    await page.locator('.cm-editor').waitFor();
    return page;
  }

  /** Text, scripts, and markup of every live frame, for failure reports. */
  async frameSnapshots() {
    const pages = this.observedPages.filter(page => !page.isClosed());
    return Promise.all(pages.flatMap(page => page.frames()).map(async frame => {
      try {
        return await frame.evaluate(() => ({
          url: location.href,
          app: document.getElementById('app')?.outerHTML.slice(0, 40_000),
          visibleText: document.body?.innerText.slice(0, 4_000),
          scripts: [...document.scripts].map(script => ({ type: script.type, src: script.getAttribute('src'), length: script.textContent?.length })),
        }));
      } catch { return { url: frame.url(), detached: true }; }
    }));
  }

  records() {
    return {
      checks: this.checks, pageErrors: this.pageErrors, consoleErrors: this.consoleErrors,
      failedRequests: this.failedRequests, externalRequests: this.externalRequests,
      deliveredDespiteAbort: this.deliveredDespiteAbort,
    };
  }

  async close() {
    await Promise.all(this.contexts.map(context => context.close().catch(() => {})));
  }
}
