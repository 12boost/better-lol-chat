// Local post-game scoreboard. Serves the captured client screen and the plugin.
// Run: node preview/server.mjs

import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const capturePath = path.join(root, 'docs', 'fixtures', 'client-capture', 'client-capture.json');
const assetsPath = path.join(root, 'docs', 'fixtures', 'client-capture', 'client-assets.json');
const pluginDir = path.join(root, 'pengu-plugin', 'better-lol-chat');
const chromeDir = path.join(root, 'preview', 'chrome');
const uikitDir = path.join(root, 'preview', 'uikit');
const chromeFiles = new Map([
  ['/fe/app-controls/control-settings.png', path.join(chromeDir, 'control-settings.png')],
  ['/fe/app-controls/control-close.png', path.join(chromeDir, 'control-close.png')],
]);
const port = Number(process.env.PORT) || 3000;

function rewriteClientOrigin(text) {
  return text.replace(/https?:\/\/127\.0\.0\.1:\d+/g, '');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

console.log('[preview] reading capture');
const capture = readJson(capturePath);
console.log('[preview] reading assets');
const assetFile = readJson(assetsPath);

const assets = new Map();
for (const asset of assetFile.assets || []) {
  if (!asset?.path) continue;
  assets.set(asset.path, asset);
}
assetFile.assets = null;

const cssByPath = new Map();
const hostLinks = [];
const hostInline = [];
const seenHref = new Set();
for (const sheet of capture.styleSheets || []) {
  if (sheet.owner !== 'host' || sheet.plugin) continue;
  const text = rewriteClientOrigin(sheet.text || '');
  if (!sheet.href) {
    if (text.trim()) hostInline.push(text);
    continue;
  }
  const url = new URL(sheet.href);
  const key = url.pathname + url.search;
  if (!cssByPath.has(url.pathname)) cssByPath.set(url.pathname, text);
  if (!cssByPath.has(key)) cssByPath.set(key, text);
  if (seenHref.has(key)) continue;
  seenHref.add(key);
  hostLinks.push(key);
}

const shadows = {};
for (const entry of capture.shadows || []) {
  if (!entry?.tag || !entry.html) continue;
  shadows[entry.tag] = rewriteClientOrigin(entry.html);
}
const extraShadowDir = path.join(root, 'preview', 'shadows');
if (fs.existsSync(extraShadowDir)) {
  for (const name of fs.readdirSync(extraShadowDir)) {
    if (!name.endsWith('.html')) continue;
    const tag = name.slice(0, -'.html'.length);
    if (shadows[tag]) continue;
    shadows[tag] = fs.readFileSync(path.join(extraShadowDir, name), 'utf8');
  }
}

let hostHtml = rewriteClientOrigin(capture.hostHtml || '');
hostHtml = hostHtml.replace(
  /<iframe\b([^>]*\bid=["']embedded-messages-frame["'][^>]*)>/i,
  (match, attrs) => {
    if (/\ssrc\s*=/.test(attrs)) return match;
    return `<iframe${attrs} src="/messages">`;
  },
);

const messagesHtml = rewriteClientOrigin(capture.iframeHtml || '');
const ancestors = capture.ancestors || [];
const body = ancestors.find((item) => item.tag === 'BODY');
const bodyClass = body?.className || 'typekit-region-na typekit-locale-en-US typekit-lang-en';

const apis = capture.apis || {};
const apiRoutes = new Map([
  ['/lol-gameflow/v1/gameflow-phase', apis.phase ?? 'EndOfGame'],
  ['/lol-summoner/v1/current-summoner', apis.me ?? {}],
  ['/lol-end-of-game/v1/eog-stats-block', apis.eog ?? {}],
  ['/lol-game-data/assets/v1/champion-summary.json', apis.championSummary ?? []],
  ['/lol-chat/v1/conversations', apis.conversations ?? []],
]);

function send(res, status, body, type) {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(body);
  res.writeHead(status, {
    'Content-Type': type,
    'Content-Length': payload.length,
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function json(res, value) {
  send(res, 200, JSON.stringify(value), 'application/json; charset=utf-8');
}

function page() {
  const links = hostLinks
    .map((href) => `<link rel="stylesheet" href="${href}">`)
    .join('\n');
  const inline = hostInline
    .map((css) => `<style>${css.replace(/<\/style/gi, '<\\/style')}</style>`)
    .join('\n');
  const shadowJson = JSON.stringify(shadows).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Post-game</title>
${links}
${inline}
<style>
  html, body { margin: 0; background: #010a13; }
  body { width: 1055px; height: 720px; overflow: hidden; }
  #rcp-fe-viewport-root { width: 1055px; height: 720px; display: flex; position: relative; overflow: hidden; }
  .rcp-fe-viewport-main { flex: 1 1 auto; min-width: 0; height: 100%; position: relative; }
  #rcp-fe-viewport-root > .rcp-fe-viewport-main > .screen-root { height: 100%; width: 100%; }
  /* Window controls the plugin copies onto the credit gear and close button. */
  .blc-preview-chrome { position: absolute; width: 0; height: 0; overflow: hidden; pointer-events: none; }
  .riotclient-app-controls .app-controls-button {
    height: 18px;
    width: 18px;
    -webkit-mask-size: contain;
    mask-size: contain;
    background-color: #a09b8c;
  }
  .riotclient-app-controls .app-controls-settings {
    -webkit-mask-image: url(/fe/app-controls/control-settings.png);
    mask-image: url(/fe/app-controls/control-settings.png);
  }
  .riotclient-app-controls .app-controls-close {
    -webkit-mask-image: url(/fe/app-controls/control-close.png);
    mask-image: url(/fe/app-controls/control-close.png);
  }
</style>
</head>
<body class="${bodyClass}">
<section id="rcp-fe-viewport-root">
<section class="rcp-fe-viewport-main" style="opacity:1">
${hostHtml}
</section>
</section>
<div class="riotclient-app-controls blc-preview-chrome" aria-hidden="true">
  <div class="app-controls-button app-controls-settings"></div>
  <div class="app-controls-button app-controls-close"></div>
</div>
<script type="application/json" id="blc-preview-shadows">${shadowJson}</script>
<script type="module">
function paintDialogFrame(el) {
  const frame = el.shadowRoot?.querySelector('.lol-uikit-dialog-frame');
  if (!frame) return;
  const inside = el.getAttribute('dismissable-type') === 'inside';
  const dismiss = el.hasAttribute('dismissable') || el.hasAttribute('close-button');
  frame.classList.add(el.getAttribute('orientation') || 'bottom', el.getAttribute('appearance') || 'enabled', el.getAttribute('frame') || 'bordered');
  frame.classList.toggle('dismissable-close-button', dismiss && !inside);
  frame.classList.toggle('dismissable-icon', dismiss && inside);
}

const templates = JSON.parse(document.getElementById('blc-preview-shadows').textContent);
for (const [tag, html] of Object.entries(templates)) {
  if (customElements.get(tag)) continue;
  customElements.define(tag, class extends HTMLElement {
    connectedCallback() {
      if (this.shadowRoot || !html) return;
      this.attachShadow({ mode: 'open' }).innerHTML = html;
      if (tag === 'lol-uikit-dialog-frame') paintDialogFrame(this);
    }
  });
}
const { init, load } = await import('/plugin/index.js');
init({ socket: { observe() {} } });
load();

async function previewDemo() {
  const frame = document.querySelector('iframe#embedded-messages-frame');
  if (!frame || typeof window.__blcInjectSampleMessages !== 'function') return;
  if (!frame.contentDocument?.querySelector('.messages')) {
    await new Promise((resolve) => {
      if (frame.contentDocument?.querySelector('.messages')) resolve();
      else frame.addEventListener('load', () => resolve(), { once: true });
    });
  }
  await window.__blcInjectSampleMessages();
}
previewDemo();

function previewSummoner() {
  const row = document.querySelector('.scoreboard-row-component.is-local-player');
  const name = row?.querySelector('.player-name__game-name')?.textContent || '';
  return name.replace(/[\\u200e\\u200f\\u202a-\\u202e\\u2066-\\u2069]/g, '').replace(/\\s+/g, ' ').trim();
}

function appendPreviewMessage(field, body) {
  const room = field.closest('lol-social-chat-room');
  const doc = room?.querySelector('iframe#embedded-messages-frame')?.contentDocument;
  const parent = doc?.querySelector('.messages');
  if (!doc || !parent) return;

  const box = doc.createElement('div');
  box.className = 'message-box mine';
  const chat = doc.createElement('div');
  chat.className = 'chat-message';
  const name = doc.createElement('div');
  name.className = 'message-name';
  name.textContent = previewSummoner() || 'You';
  const colon = doc.createElement('span');
  colon.className = 'message';
  colon.textContent = ':';
  const message = doc.createElement('span');
  message.className = 'message';
  message.textContent = body;
  chat.append(name, doc.createTextNode(' '), colon, doc.createTextNode(' '), message);
  box.appendChild(chat);
  parent.appendChild(box);

  const scroller = doc.scrollingElement || doc.body;
  if (scroller) scroller.scrollTop = scroller.scrollHeight;
  parent.scrollTop = parent.scrollHeight;
}

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
  const field = event.target?.closest?.('textarea.chat-input, textarea');
  const room = field?.closest?.('lol-social-chat-room[type="postGame"]');
  if (!field || !room) return;
  event.preventDefault();
  const body = field.value.replace(/^\\s+|\\s+$/g, '');
  field.value = '';
  const sizer = field.parentElement?.querySelector('.input-sizer span');
  if (sizer) sizer.textContent = '';
  field.dispatchEvent(new Event('input', { bubbles: true }));
  if (body) appendPreviewMessage(field, body);
}, true);
</script>
</body>
</html>`;
}

function pluginFile(url) {
  const pathname = decodeURIComponent(url.pathname);
  const rel = pathname.replace(/^\/plugin\//, '');
  const file = path.resolve(pluginDir, rel);
  if (file !== pluginDir && !file.startsWith(pluginDir + path.sep)) return null;
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return null;
  return file;
}

function pluginModule(url) {
  const file = pluginFile(url);
  if (!file) return null;
  const text = fs.readFileSync(file, 'utf8');
  if (url.searchParams.has('raw')) {
    return `export default ${JSON.stringify(text)};\n`;
  }
  if (url.searchParams.has('inject')) {
    const id = 'blc-preview-' + path.basename(file).replace(/\W+/g, '-');
    return `const style = document.createElement('style');
style.id = ${JSON.stringify(id)};
style.textContent = ${JSON.stringify(text)};
if (!document.getElementById(style.id)) document.head.appendChild(style);
`;
  }
  return text.replace(
    /(^|\n)(import\s+['"]\.\/[^'"]+\.css)(['"])/g,
    '$1$2?inject$3',
  );
}

function assetBody(asset) {
  return Buffer.from(asset.base64, 'base64');
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  const pathname = decodeURIComponent(url.pathname);

  if (pathname === '/' || pathname === '/index.html') {
    send(res, 200, page(), 'text/html; charset=utf-8');
    return;
  }
  if (pathname === '/messages') {
    send(res, 200, messagesHtml, 'text/html; charset=utf-8');
    return;
  }
  if (pathname === '/favicon.ico') {
    send(res, 204, '', 'image/x-icon');
    return;
  }
  if (apiRoutes.has(pathname)) {
    json(res, apiRoutes.get(pathname));
    return;
  }
  if (/^\/lol-chat\/v1\/conversations\/[^/]+\/messages$/.test(pathname)) {
    json(res, apis.messages ?? []);
    return;
  }
  if (pathname.startsWith('/plugin/')) {
    const code = pluginModule(url);
    if (code == null) {
      send(res, 404, 'missing plugin file', 'text/plain; charset=utf-8');
      return;
    }
    send(res, 200, code, 'text/javascript; charset=utf-8');
    return;
  }

  const cssKey = pathname + url.search;
  if (cssByPath.has(cssKey) || cssByPath.has(pathname)) {
    send(res, 200, cssByPath.get(cssKey) || cssByPath.get(pathname), 'text/css; charset=utf-8');
    return;
  }

  const chromeFile = chromeFiles.get(pathname);
  if (chromeFile && fs.existsSync(chromeFile)) {
    send(res, 200, fs.readFileSync(chromeFile), 'image/png');
    return;
  }
  if (pathname.startsWith('/fe/lol-uikit/images/')) {
    const file = path.join(uikitDir, path.basename(pathname));
    if (file.startsWith(uikitDir + path.sep) && fs.existsSync(file)) {
      send(res, 200, fs.readFileSync(file), 'image/png');
      return;
    }
  }

  const asset = assets.get(pathname);
  if (asset) {
    send(res, 200, assetBody(asset), asset.mime || 'application/octet-stream');
    return;
  }

  send(res, 404, 'not found', 'text/plain; charset=utf-8');
});

server.listen(port, '127.0.0.1', () => {
  console.log(`[preview] http://127.0.0.1:${port}`);
});
