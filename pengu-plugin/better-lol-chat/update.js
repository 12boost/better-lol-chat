import { settings, saveSettings } from './settings.js';
import { showUpdateDialog } from './update-dialog.js';

const REPO_URL = 'https://github.com/rdavis0/better-lol-chat';
const RELEASES_URL = 'https://api.github.com/repos/rdavis0/better-lol-chat/releases/latest';
const SAFE_TAG = /^[\w.+-]+$/;
const DOWNLOAD_PREFIX = `${REPO_URL}/releases/download/`;
const INSTALLER_NAME = /^blc-install-\d+(?:\.\d+){0,3}\.bat$/i;

let cached = null;
let checkGen = 0;
let statusRoot = null;

function compareVersions(a, b) {
  const pa = numericParts(a);
  const pb = numericParts(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

export function mountUpdateStatus(disclaimer, version) {
  const doc = disclaimer?.ownerDocument;
  if (!doc || !disclaimer.parentNode || doc.getElementById('blc-update')) return;
  const current = normalizeVersion(version) || String(version || '').trim();
  const row = createUpdateRow(doc, current);
  const bug = disclaimer.parentNode.querySelector('.blc-bug-report');
  if (bug) row.append(bug);
  disclaimer.parentNode.insertBefore(row, disclaimer);
}

function createUpdateRow(doc, version) {
  const root = doc.createElement('div');
  root.id = 'blc-update';
  root.className = 'blc-update';

  const line = doc.createElement('p');
  line.className = 'blc-update-line';

  const ver = doc.createElement('span');
  ver.className = 'blc-update-ver';
  ver.textContent = version ? `v${version.replace(/^v/i, '')}` : 'better-lol-chat';

  const status = doc.createElement('span');
  status.className = 'blc-update-status';
  status.setAttribute('aria-live', 'polite');

  const link = doc.createElement('button');
  link.type = 'button';
  link.className = 'blc-update-link';
  link.hidden = true;
  link.textContent = "What's new";

  line.append(ver, status, link);
  root.append(line);

  link.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    openUpdateFor(cached);
  });

  statusRoot = root;
  if (cached) applyStatus(root, cached);
  else if (checkGen) applyStatus(root, { status: 'Checking…' });

  return root;
}

export function beginPostGameUpdateCheck(version) {
  const gen = ++checkGen;
  cached = null;
  paintStatus({ status: 'Checking…' });
  fetchRelease()
    .then((release) => {
      if (gen !== checkGen) return;
      cached = describeRelease(version, release);
      paintNotice();
      paintStatus(cached);
    })
    .catch(() => {
      if (gen !== checkGen) return;
      cached = { status: "Couldn't check for updates" };
      paintNotice();
      paintStatus(cached);
    });
}

function paintStatus(next) {
  if (statusRoot?.isConnected) applyStatus(statusRoot, next);
}

function applyStatus(root, next) {
  const status = root.querySelector('.blc-update-status');
  const link = root.querySelector('.blc-update-link');
  if (!status || !link) return;
  status.textContent = next.status;
  link.hidden = !next.latest;
}

async function fetchRelease() {
  const signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout
    ? AbortSignal.timeout(8000)
    : undefined;
  const res = await fetch(RELEASES_URL, {
    headers: { Accept: 'application/vnd.github+json' },
    signal,
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`release check failed (${res.status})`);
  return res.json();
}

function describeRelease(version, release) {
  if (!release) {
    return { status: 'No release published yet' };
  }
  const tag = String(release.tag_name || '');
  const latest = normalizeVersion(tag);
  if (!latest || !SAFE_TAG.test(tag)) {
    return { status: "Couldn't check for updates" };
  }
  const current = normalizeVersion(version);
  const order = current ? compareVersions(latest, current) : 1;
  if (order > 0) {
    const installer = installerAsset(release);
    return {
      status: `Update available: v${latest}`,
      latest,
      tag,
      notes: typeof release.body === 'string' ? release.body : '',
      downloadUrl: installer?.url || '',
      installerName: installer?.name || '',
    };
  }
  if (order < 0) {
    return { status: `Ahead of the latest release (v${latest})` };
  }
  return { status: 'Up to date' };
}

function installerAsset(release) {
  const bats = (Array.isArray(release?.assets) ? release.assets : []).filter((asset) => {
    const name = String(asset?.name || '');
    const url = String(asset?.browser_download_url || '');
    return name.toLowerCase().endsWith('.bat') && url.startsWith(DOWNLOAD_PREFIX);
  });
  const named = bats.filter((asset) => INSTALLER_NAME.test(String(asset.name)));
  const chosen = named.length === 1 ? named[0] : bats.length === 1 ? bats[0] : null;
  if (!chosen) return null;
  return { name: String(chosen.name), url: String(chosen.browser_download_url) };
}

function openUpdateFor(info) {
  if (!info?.latest) return;
  const tag = encodeURIComponent(info.tag);
  showUpdateDialog({
    version: info.latest,
    notes: info.notes,
    downloadUrl: info.downloadUrl || '',
    installerName: info.installerName || '',
    releaseUrl: `${REPO_URL}/releases/tag/${tag}`,
    onSkip: () => skipUpdate(info),
  });
}

const PREVIEW_NOTES = [
  "What's new",
  '',
  '- Update dialog with release notes',
  '- Skip an update to hide its chat notice',
  '- Faster scoreboard icon placement',
  '- Fixed items overlapping the champion icon on narrow windows',
  '- Fixed sticky chat collapsing after the options panel closed',
  '- Smaller tweaks to the options menu',
  '- Improved spacing in the post-game header',
].join('\n');

export function previewUpdateDialog() {
  showUpdateDialog({
    version: '9.9',
    notes: PREVIEW_NOTES,
    downloadUrl: '',
    installerName: 'blc-install-9.9.bat',
    releaseUrl: `${REPO_URL}/releases`,
  });
}

window.__blcPreviewUpdateDialog = previewUpdateDialog;

function skipUpdate(info) {
  settings.skippedUpdate = info.latest;
  saveSettings();
  paintNotice();
}

let noticeDoc = null;

export function mountUpdateNotice(doc) {
  noticeDoc = doc;
  if (cached) paintNotice();
}

function paintNotice() {
  const doc = noticeDoc;
  if (!doc?.querySelector) return;
  if (cached?.latest && settings.skippedUpdate !== cached.latest) placeNotice(doc, cached);
  else if (cached) removeNotice(doc);
}

function removeNotice(doc) {
  doc.querySelectorAll('.blc-update-note').forEach((el) => el.remove());
}

function placeNotice(doc, info) {
  const list = doc.querySelector('.messages');
  if (!list) return;
  let note = null;
  for (const child of list.children) {
    if (child.classList?.contains('blc-update-note')) {
      note = child;
      break;
    }
  }
  if (!note) note = buildNotice(doc, info);
  else fillNotice(note, info);
  if (list.firstElementChild === note) return;
  const scroller = messageScroller(list);
  const prevTop = scroller ? scroller.scrollTop : 0;
  const prevHeight = scroller ? scroller.scrollHeight : 0;
  list.insertBefore(note, list.firstElementChild);
  if (!scroller || prevTop <= 0) return;
  const grown = scroller.scrollHeight - prevHeight;
  if (grown > 0) scroller.scrollTop = prevTop + grown;
}

function buildNotice(doc, info) {
  const box = doc.createElement('div');
  box.className = 'message-box blc-injected blc-update-note';
  box.setAttribute('role', 'link');

  const chat = doc.createElement('div');
  chat.className = 'chat-message';

  const name = doc.createElement('div');
  name.className = 'message-name';
  name.textContent = 'better-lol-chat';

  const colon = doc.createElement('span');
  colon.className = 'message';
  colon.textContent = ':';

  const body = doc.createElement('span');
  body.className = 'message blc-update-body';

  chat.append(name, doc.createTextNode(' '), colon, doc.createTextNode(' '), body);
  box.appendChild(chat);
  box.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    openUpdateFor(cached);
  });
  fillNotice(box, info);
  return box;
}

function fillNotice(box, info) {
  const latest = String(info.latest || '').replace(/^v/i, '');
  const label = latest
    ? `v${latest} is available. Click for details.`
    : 'An update is available. Click for details.';
  const body = box.querySelector('.blc-update-body');
  if (!body || body.textContent === label) return;
  body.textContent = label;
}

function messageScroller(list) {
  const doc = list.ownerDocument;
  let node = list;
  while (node && node !== doc.documentElement) {
    const style = doc.defaultView?.getComputedStyle(node);
    if (style && /(auto|scroll)/.test(style.overflowY)) return node;
    node = node.parentElement;
  }
  return doc.scrollingElement || null;
}

function normalizeVersion(value) {
  const raw = String(value || '').trim().replace(/^v/i, '');
  const match = raw.match(/^(\d+(?:\.\d+){0,3})/);
  return match ? match[1] : '';
}

function numericParts(value) {
  return normalizeVersion(value).split('.').filter(Boolean).map((part) => parseInt(part, 10) || 0);
}

