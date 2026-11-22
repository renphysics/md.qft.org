#!/usr/bin/env node
/** Package a real Slidev static build for the isolated md.qft.org player. MIT. */
import { readFile, writeFile, readdir, mkdir, stat, realpath } from 'node:fs/promises';
import { resolve, relative, dirname, extname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { build } from 'esbuild';
import { parse, serialize, parseFragment } from 'parse5';
import { init, parse as parseImports } from 'es-module-lexer';
import { zipSync, strToU8 } from 'fflate';

const toolDirectory = dirname(fileURLToPath(import.meta.url));
const maxHtmlBytes = 24 * 1024 * 1024;
const maxFileBytes = 40 * 1024 * 1024;
const maxExpandedBytes = 120 * 1024 * 1024;
const maxEntries = 1000;
const sourceExtensions = new Set(['.md', '.markdown', '.vue', '.ts', '.tsx', '.js', '.mjs', '.cjs', '.jsx', '.css', '.scss', '.sass', '.less', '.json', '.yaml', '.yml', '.txt', '.html', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.woff', '.woff2', '.ttf', '.otf', '.mp3', '.mp4', '.webm', '.ogg', '.wav', '.csv']);
const mimeTypes = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.webm': 'video/webm', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.json': 'application/json' };
const getAttr = (node, name) => node.attrs?.find(attribute => attribute.name === name)?.value;
const setAttr = (node, name, value) => {
  const attribute = node.attrs?.find(item => item.name === name);
  if (attribute) attribute.value = value;
  else (node.attrs ??= []).push({ name, value });
};
const textNode = value => ({ nodeName: '#text', value, parentNode: null });
const children = node => node.childNodes ?? [];
function replaceNode(node, replacements) {
  const parent = node.parentNode;
  const index = parent.childNodes.indexOf(node);
  for (const replacement of replacements) replacement.parentNode = parent;
  parent.childNodes.splice(index, 1, ...replacements);
}
function fragment(html) { return parseFragment(html).childNodes; }
function escapedScript(value) { return value.replace(/<\/script/gi, '<\\/script'); }
function scriptNode(value) {
  const node = fragment('<script></script>')[0];
  node.childNodes = [textNode(escapedScript(value))];
  node.childNodes[0].parentNode = node;
  return node;
}
function styleNode(value) {
  if (/<\/style/i.test(value)) throw new Error('A stylesheet contains an unsafe HTML closing tag.');
  const node = fragment('<style></style>')[0];
  node.childNodes = [textNode(value)];
  node.childNodes[0].parentNode = node;
  return node;
}
function safePath(path) {
  return Boolean(path && path.length <= 400 && !/[\x00-\x1f\x7f\\:%?#]/.test(path)
    && !path.startsWith('/') && path.split('/').every(part => part && part !== '.' && part !== '..' && !/[. ]$/.test(part)));
}

async function dependencyNotices(sourceRoot) {
  const lock = JSON.parse(await readFile(resolve(sourceRoot, 'package-lock.json'), 'utf8').catch(() => '{}'));
  const sections = ['THIRD-PARTY DEPENDENCY NOTICES\n\nThis package includes software built using the following dependencies.\nThe list includes build-time tools as well as browser-runtime libraries.\nOriginal licenses continue to apply.'];
  for (const [path, info] of Object.entries(lock.packages ?? {}).sort(([a], [b]) => a.localeCompare(b, 'en'))) {
    if (!path.startsWith('node_modules/') || !safePath(path)) continue;
    const directory = resolve(sourceRoot, path);
    const names = await readdir(directory).catch(() => []);
    const licenses = names.filter(name => /^(?:licen[sc]e|notice|copying|ofl)(?:[.-]|$)/i.test(name));
    let text = `\n\n${'='.repeat(72)}\n${info.name || path.replace(/^.*node_modules\//, '')} ${info.version || ''}\nLicense identifier: ${info.license || 'See dependency documentation'}\n`;
    for (const name of licenses.sort()) {
      const file = resolve(directory, name);
      if ((await stat(file).catch(() => undefined))?.isFile()) text += `\n--- ${name} ---\n${await readFile(file, 'utf8')}\n`;
    }
    sections.push(text);
  }
  return sections.length > 1 ? sections.join('') : undefined;
}

export async function packageSlidev({ dist, source, out, title, sourceEntry = 'slides.md', aspectRatio = '16:9' }) {
  await init;
  const distRoot = await realpath(resolve(dist));
  const sourceRoot = source ? await realpath(resolve(source)) : undefined;
  if (!['16:9', '4:3'].includes(aspectRatio)) throw new Error('Use an aspect ratio of 16:9 or 4:3.');
  if (!safePath(sourceEntry) || !/\.(?:md|markdown)$/i.test(sourceEntry)) throw new Error('The source entry must be a valid Markdown (.md or .markdown) path.');
  const titleText = String(title ?? 'Slidev presentation').trim();
  if (!titleText || titleText.length > 200 || /[\u0000-\u001f]/.test(String(title ?? ''))) throw new Error('Use a presentation title of 1–200 characters without control characters.');
  const assetCache = new Map();
  async function assetPath(url, baseFile) {
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(url)) throw new Error(`External asset cannot be packaged: ${url.slice(0, 160)}. Bundle it during the Slidev build.`);
    const raw = url.split(/[?#]/, 1)[0];
    let decoded;
    try { decoded = decodeURIComponent(raw); } catch { throw new Error(`Invalid asset URL: ${raw}`); }
    if (!decoded || decoded.includes('\0') || decoded.includes('\\')) throw new Error(`Invalid asset URL: ${raw}`);
    const target = resolve(url.startsWith('/') ? distRoot : dirname(baseFile), decoded.replace(/^\//, ''));
    const actual = await realpath(target).catch(() => { throw new Error(`Missing built asset: ${url}. Check the Slidev base path and public/ assets.`); });
    if (relative(distRoot, actual).startsWith(`..${sep}`) || actual === dirname(distRoot)) throw new Error(`Asset escapes the build directory: ${url}`);
    return actual;
  }
  async function inlineAsset(url, baseFile) {
    if (!url || url.startsWith('#') || /^data:/i.test(url)) return url;
    const path = await assetPath(url, baseFile);
    if (!assetCache.has(path)) {
      const mime = mimeTypes[extname(path).toLowerCase()];
      if (!mime) throw new Error(`Unsupported runtime asset: ${relative(distRoot, path)}`);
      if ((await stat(path)).size > maxFileBytes) throw new Error(`Runtime asset exceeds 40 MiB: ${relative(distRoot, path)}`);
      assetCache.set(path, `data:${mime};base64,${(await readFile(path)).toString('base64')}`);
    }
    const hash = url.includes('#') ? `#${url.split('#').slice(1).join('#')}` : '';
    return assetCache.get(path) + hash;
  }
  async function inlineCss(css, path) {
    if (/@import\s/i.test(css)) throw new Error('The build still contains CSS @import. Bundle styles in Vite before packaging.');
    const matches = [...css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi)];
    for (const match of matches.reverse()) {
      const original = (match[1] ?? match[2] ?? match[3]).trim();
      const replacement = await inlineAsset(original, path);
      css = css.slice(0, match.index) + `url("${replacement.replace(/"/g, '%22')}")` + css.slice(match.index + match[0].length);
    }
    return css;
  }
  async function bundleScript(path) {
    const result = await build({
      entryPoints: [path], bundle: true, write: false, format: 'iife', platform: 'browser',
      target: 'es2022', minify: true, legalComments: 'inline', metafile: true,
      outdir: resolve(distRoot, '__qft_inline__'), logLevel: 'silent',
      define: { 'import.meta.url': '"about:blank"', 'import.meta.resolve': 'undefined' },
      plugins: [{ name: 'local-package-only', setup(plugin) {
        plugin.onResolve({ filter: /.*/ }, async args => {
          if (args.kind === 'entry-point') return { path: args.path };
          if (!args.path.startsWith('.') && !args.path.startsWith('/')) throw new Error(`Unbundled module ${args.path}. Complete the Slidev build before packaging.`);
          return { path: await assetPath(args.path, args.importer || resolve(distRoot, 'index.html')) };
        });
      } }],
    });
    const javascript = result.outputFiles.filter(file => file.path.endsWith('.js'));
    if (javascript.length !== 1 || result.outputFiles.some(file => !file.path.endsWith('.js'))) {
      throw new Error('The build contains unbundled script resources. Use the supplied Vite portable profile.');
    }
    const code = javascript[0].text;
    const [imports] = parseImports(code);
    if (imports.some(item => item.d !== -2)) throw new Error('The compiled application still contains imports. Dynamic import paths must be statically resolvable.');
    return code;
  }

  const indexPath = resolve(distRoot, 'index.html');
  if ((await stat(indexPath)).size > maxHtmlBytes) throw new Error('The built index.html exceeds 24 MiB.');
  const document = parse(await readFile(indexPath, 'utf8'));
  const html = children(document).find(node => node.tagName === 'html');
  const body = children(html).find(node => node.tagName === 'body');
  const scripts = [];
  async function visit(node) {
    for (const child of [...children(node)]) {
      const tag = child.tagName;
      if (['iframe', 'object', 'embed', 'base'].includes(tag)) throw new Error(`The built presentation contains <${tag}>. Portable packages must contain their dependencies.`);
      if (tag === 'meta' && ['refresh', 'content-security-policy'].includes((getAttr(child, 'http-equiv') ?? '').toLowerCase())) { replaceNode(child, []); continue; }
      if (tag === 'link') {
        const rel = getAttr(child, 'rel');
        const href = getAttr(child, 'href');
        if (rel === 'stylesheet' && href) {
          const path = await assetPath(href, indexPath);
          replaceNode(child, [styleNode(await inlineCss(await readFile(path, 'utf8'), path))]);
        } else replaceNode(child, []);
        continue;
      }
      if (tag === 'script') {
        const src = getAttr(child, 'src');
        const type = getAttr(child, 'type');
        if (src) scripts.push(scriptNode(await bundleScript(await assetPath(src, indexPath))));
        else if (!type || ['module', 'text/javascript', 'application/javascript'].includes(type)) {
          const code = children(child).map(item => item.value ?? '').join('');
          if (parseImports(code)[0].length) throw new Error('Inline source scripts still contain imports. Build the presentation first.');
          scripts.push(scriptNode(code));
        } else { continue; }
        replaceNode(child, []);
        continue;
      }
      if (tag === 'style') {
        const css = children(child).map(item => item.value ?? '').join('');
        replaceNode(child, [styleNode(await inlineCss(css, indexPath))]);
        continue;
      }
      for (const attribute of [...(child.attrs ?? [])]) {
        if (attribute.name.startsWith('on')) throw new Error('Inline HTML event handlers are not supported. Use Vue components or addEventListener.');
        if (['src', 'poster'].includes(attribute.name) || (['image', 'use'].includes(tag) && ['href', 'xlink:href'].includes(attribute.name))) {
          setAttr(child, attribute.name, await inlineAsset(attribute.value, indexPath));
        }
        if (attribute.name === 'style') setAttr(child, attribute.name, await inlineCss(attribute.value, indexPath));
        if (attribute.name === 'srcset') throw new Error('Inline srcset is not supported by this packager. Import images into Vue components or use an embedded src.');
      }
      await visit(child);
    }
  }
  await visit(document);
  const runtime = scriptNode(await readFile(resolve(toolDirectory, 'portable-runtime.js'), 'utf8'));
  for (const script of [runtime, ...scripts]) { script.parentNode = body; body.childNodes.push(script); }
  const ownLicense = await readFile(resolve(toolDirectory, 'LICENSE'), 'utf8');
  const projectLicense = sourceRoot ? await readFile(resolve(sourceRoot, 'LICENSE'), 'utf8').catch(() => '') : '';
  const dependencies = await dependencyNotices(sourceRoot ?? dirname(distRoot));
  const notices = ['QFT PORTABLE PRESENTATION PLAYER AND PACKAGER\n\n' + ownLicense,
    ...(projectLicense && projectLicense !== ownLicense ? ['\nPRESENTATION PROJECT LICENSE\n\n' + projectLicense] : []),
    ...(dependencies ? ['\n' + dependencies] : []),
  ].join('\n');
  // Keep notices inside the compiled entry as inert text. The browser player
  // preserves this template, including when exporting a standalone HTML file.
  // Using a text node makes </template>, script tags, and comment terminators
  // in a license harmless; no license text is interpreted as active markup.
  const noticeTemplate = fragment('<template data-qft-presentation-notices></template>')[0];
  const noticeText = textNode(notices);
  noticeText.parentNode = noticeTemplate.content;
  noticeTemplate.content.childNodes = [noticeText];
  noticeTemplate.parentNode = body;
  body.childNodes.push(noticeTemplate);
  // Inline scripts are intentionally at the end: the root mount element exists.
  const presentation = serialize(document);
  if (Buffer.byteLength(presentation) > maxHtmlBytes) throw new Error('The compiled presentation exceeds the 24 MiB HTML limit.');

  const manifest = { format: 'qft-presentation', version: 1, engine: 'slidev', title: titleText,
    entry: 'presentation.html', ...(sourceRoot ? { source: `source/${sourceEntry}` } : {}), aspectRatio, generator: 'qft-slidev-packager/1' };
  const files = Object.create(null);
  let totalBytes = 0;
  const names = new Set();
  const directories = new Set();
  const canonical = path => path.normalize('NFC').toLowerCase();
  const reserve = (path, size) => {
    const key = canonical(path);
    if (!safePath(path) || names.has(key) || directories.has(key)) throw new Error(`Ambiguous source filename: ${path}`);
    const parts = key.split('/');
    for (let index = 1; index < parts.length; index += 1) {
      const prefix = parts.slice(0, index).join('/');
      if (names.has(prefix)) throw new Error(`Ambiguous source filename: ${path}`);
      directories.add(prefix);
    }
    if (size > maxFileBytes) throw new Error(`File exceeds 40 MiB: ${path}`);
    if (names.size + 1 > maxEntries || totalBytes + size > maxExpandedBytes) throw new Error('The package exceeds 1000 files or 120 MiB expanded.');
    names.add(key);
    totalBytes += size;
  };
  const addFile = (path, bytes) => { reserve(path, bytes.byteLength); files[path] = bytes; };
  addFile('qft-presentation.json', strToU8(JSON.stringify(manifest, null, 2) + '\n'));
  addFile('presentation.html', strToU8(presentation));
  addFile('THIRD_PARTY_NOTICES.txt', strToU8(notices));
  if (sourceRoot) {
    const sourceEntryStat = await stat(resolve(sourceRoot, sourceEntry)).catch(() => undefined);
    if (!sourceEntryStat?.isFile()) throw new Error(`Source entry not found: ${sourceEntry}`);
    async function collect(directory, prefix = '') {
      const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'));
      for (const entry of entries) {
        if (entry.name.startsWith('.') || ['node_modules', 'dist', 'build', 'coverage', 'test-results', 'playwright-report'].includes(entry.name)) continue;
        const path = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (!safePath(path)) throw new Error(`Source filename cannot be packaged: ${path}`);
        if (entry.isSymbolicLink()) throw new Error(`Source symlinks are not supported: ${path}`);
        if (entry.isDirectory()) { await collect(resolve(directory, entry.name), path); continue; }
        if (!sourceExtensions.has(extname(entry.name).toLowerCase()) && !/^(?:LICENSE|NOTICE|COPYING)(?:\.|$)/i.test(entry.name)) continue;
        const key = `source/${path}`;
        const localPath = resolve(directory, entry.name);
        const size = (await stat(localPath)).size;
        reserve(key, size);
        const bytes = new Uint8Array(await readFile(localPath));
        if (bytes.byteLength !== size) throw new Error(`Source changed during packaging: ${path}. Try again after saving your edits.`);
        files[key] = bytes;
      }
    }
    await collect(sourceRoot);
  }
  addFile('README.txt', strToU8(`OPEN THIS PRESENTATION\n\nOpen this ZIP in https://md.qft.org/ and choose Present. Its files stay in your browser.\n\nThis is a compiled Slidev presentation. Browser-based interactions work without a CDN. Browser storage and slide synchronization are private, temporary, in-memory state; they reset when playback restarts.\n\nEDIT THE SOURCE\n\n${sourceRoot ? 'The source/ folder contains the editable Slidev project. Run npm ci, revise slides.md or components, and run npm run package. Editing source alone does not update presentation.html. See source/README.md for the portable build requirements.' : 'This package does not contain editable source.'}\n\nThe player deliberately blocks network requests, external scripts, workers, nested frames, forms and dynamic code evaluation. Presentations that require those features need adaptation.\n`));
  const count = Object.keys(files).length;
  const expanded = Object.values(files).reduce((sum, value) => sum + value.byteLength, 0);
  if (count > maxEntries || expanded > maxExpandedBytes) throw new Error('The package exceeds 1000 files or 120 MiB expanded.');
  const bytes = zipSync(files, { level: 6, mtime: new Date('2026-01-01T00:00:00Z') });
  if (bytes.byteLength > 60 * 1024 * 1024) throw new Error('The ZIP exceeds 60 MiB.');
  await mkdir(dirname(resolve(out)), { recursive: true });
  await writeFile(resolve(out), bytes);
  return { out: resolve(out), bytes: bytes.byteLength, htmlBytes: Buffer.byteLength(presentation), files: count };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { values } = parseArgs({ options: {
      dist: { type: 'string', default: '.build' }, source: { type: 'string' }, out: { type: 'string', default: 'presentation.zip' },
      title: { type: 'string', default: 'Slidev presentation' }, 'source-entry': { type: 'string', default: 'slides.md' }, 'aspect-ratio': { type: 'string', default: '16:9' },
    } });
    console.log(JSON.stringify(await packageSlidev({ ...values, sourceEntry: values['source-entry'], aspectRatio: values['aspect-ratio'] }), null, 2));
  } catch (error) {
    console.error(`Slidev packaging failed: ${error.message}`);
    process.exitCode = 1;
  }
}
