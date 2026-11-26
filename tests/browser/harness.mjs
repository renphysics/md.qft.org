/**
 * Shared helpers for the end-to-end browser suites. A suite is a module named
 * `*.browser.mjs` in this folder that exports `title` and a default
 * `async function (t)`; `run.mjs` discovers and runs every suite against one
 * production preview server and one browser.
 */
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

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

/** Start `npm run preview` unless BASE_URL names a server that is already running. */
export async function startPreview() {
  const port = Number(process.env.QFT_PREVIEW_PORT) || 4322;
  const baseUrl = process.env.BASE_URL || `http://127.0.0.1:${port}/`;
  let server;
  let output = '';
  if (!process.env.BASE_URL) {
    server = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'preview', '--', '--port', String(port)], {
      stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32',
    });
    const capture = chunk => { output = (output + String(chunk)).slice(-12_000); };
    server.stdout.on('data', capture);
    server.stderr.on('data', capture);
    server.on('error', error => { output += `\n${error.message}`; });
  }
  await until(async () => (await fetch(baseUrl, { signal: AbortSignal.timeout(1000) })).ok, 'the production preview server');
  return {
    baseUrl,
    output: () => output,
    stop() {
      if (!server?.pid) return;
      try { process.kill(process.platform === 'win32' ? server.pid : -server.pid, 'SIGTERM'); }
      catch { server.kill('SIGTERM'); }
    },
  };
}

/**
 * Per-suite state: named steps, observed pages, and the error, console,
 * failed-request, and external-request records that every suite must keep empty.
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
    this.externalRequests = [];
    this.observedPages = [];
    this.contexts = [];
    this.allowedConsole = [];
    this.allowedPageErrors = [];
    this.allowedBlockedRequests = [];
  }

  /** Run one named, user-visible behaviour. */
  async step(name, action) {
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
      this.failedRequests.push({ url: request.url(), error });
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
    };
  }

  async close() {
    await Promise.all(this.contexts.map(context => context.close().catch(() => {})));
  }
}
