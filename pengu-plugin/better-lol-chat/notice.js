import { settings, saveSettings } from './settings.js';

const NOTICE_URL =
  'https://gist.githubusercontent.com/rdavis0/9497829e2a22303e26fcad09950bcd93/raw/notice.json';
const SAFE_ID = /^[\w.-]{1,64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_MESSAGE = 120;
const DEFAULT_GAP = 5;
const PREVIEW = {
  id: 'preview',
  url: 'https://getyarn.io/yarn-clip/d9fade7d-15ac-4be2-aa6c-83dada633eae',
  messages: ['Tip: Flash\'s 300 second cooldown is the longest in the game. Get an early start on your flash cooldown by flashing at spawn.'],
};

let checkGen = 0;
let cached = null;
let pick = null;
let pickResolved = false;
let counted = false;
let noticeDoc = null;
let forcePreview = false;

function noticeState() {
  if (!settings.notice || typeof settings.notice !== 'object') {
    settings.notice = emptyNoticeState();
  }
  return settings.notice;
}

function emptyNoticeState() {
  return {
    gamesSince: 0,
    priorityActive: false,
    shown: {},
  };
}

export function beginPostGameNoticeCheck() {
  const gen = ++checkGen;
  cached = null;
  pick = null;
  pickResolved = false;
  counted = false;
  forcePreview = false;
  fetchConfig()
    .then((config) => {
      if (gen !== checkGen) return;
      cached = config;
      paintNotice();
    })
    .catch(() => {
      if (gen !== checkGen) return;
      cached = { gap: DEFAULT_GAP, priorityGap: DEFAULT_GAP, notices: [] };
      paintNotice();
    });
}

export function clearNoticeMount() {
  noticeDoc = null;
  pick = null;
  pickResolved = false;
}

export function mountNotice(doc) {
  noticeDoc = doc;
  paintNotice();
}

export function previewNotice() {
  const config = previewConfig();
  const chosen = chooseNotice(config, true);
  if (!chosen) {
    console.warn('[better-lol-chat] no notice to preview');
    return;
  }
  const doc = noticeDoc || document.querySelector(
    'lol-social-chat-room[type="postGame"] iframe#embedded-messages-frame, lol-social-chat-room[type="postGame"] iframe',
  )?.contentDocument;
  if (!doc?.querySelector) {
    console.warn('[better-lol-chat] open post-game chat before /notice');
    return;
  }
  forcePreview = true;
  noticeDoc = doc;
  placeNotice(doc, chosen);
  revealNotice(doc);
}

function revealNotice(doc) {
  const note = doc.querySelector('.blc-notice');
  const list = note?.parentElement;
  if (!note || !list) return;
  const scroller = messageScroller(list) || doc.scrollingElement;
  if (!scroller) return;
  const credit = doc.getElementById('blc-credit');
  const creditH = credit && doc.defaultView?.getComputedStyle(credit).display !== 'none' ? credit.offsetHeight : 0;
  const viewTop = scroller === doc.scrollingElement || scroller === doc.body || scroller === doc.documentElement
    ? 0
    : scroller.getBoundingClientRect().top;
  const delta = note.getBoundingClientRect().top - viewTop - creditH;
  scroller.scrollTop += delta;
}

window.__blcPreviewNotice = previewNotice;

async function fetchConfig() {
  const signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout
    ? AbortSignal.timeout(8000)
    : undefined;
  const res = await fetch(NOTICE_URL, { signal });
  if (!res.ok) throw new Error(`notice check failed (${res.status})`);
  const text = (await res.text()).replace(/^\uFEFF/, '');
  return parseConfig(JSON.parse(text));
}

function parseConfig(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('invalid notice config');
  const gap = normalizeGap(raw.gamesBetweenNotices, DEFAULT_GAP);
  const priorityGap = normalizeGap(raw.gamesBetweenPriority, gap);
  const notices = [];
  if (!Array.isArray(raw.notices)) throw new Error('invalid notice list');
  for (const item of raw.notices) {
    const notice = parseNotice(item);
    if (notice) notices.push(notice);
  }
  return { gap, priorityGap, notices };
}

function normalizeGap(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.floor(n));
}

function parseNotice(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '');
  if (!SAFE_ID.test(id)) return null;
  const messages = [];
  if (!Array.isArray(raw.messages)) return null;
  for (const line of raw.messages) {
    if (typeof line !== 'string') continue;
    const text = line.trim().slice(0, MAX_MESSAGE);
    if (text) messages.push(text);
  }
  if (!messages.length) return null;
  let url = '';
  if (typeof raw.url === 'string' && /^https:\/\//i.test(raw.url.trim())) {
    url = raw.url.trim();
  }
  const from = parseDate(raw.from);
  const until = parseDate(raw.until);
  return {
    id,
    priority: raw.priority === true,
    from,
    until,
    url,
    messages,
  };
}

function parseDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return '';
  return value;
}

function previewConfig() {
  if (cached?.notices?.length) return cached;
  return {
    gap: DEFAULT_GAP,
    priorityGap: DEFAULT_GAP,
    notices: [PREVIEW],
  };
}

function paintNotice() {
  const doc = noticeDoc;
  if (!doc?.querySelector) return;
  if (forcePreview) {
    const chosen = chooseNotice(previewConfig(), true);
    if (chosen) placeNotice(doc, chosen);
    return;
  }
  if (!cached) {
    removeNotice(doc);
    return;
  }
  const chosen = resolvePick(cached);
  if (chosen) placeNotice(doc, chosen);
  else removeNotice(doc);
}

function resolvePick(config) {
  if (pickResolved) return pick;
  pickResolved = true;
  pick = chooseNotice(config, false);
  return pick;
}

function chooseNotice(config, preview) {
  const state = noticeState();
  const today = localDateString(new Date());
  const eligible = config.notices.filter((n) => isEligible(n, today));
  const priorityPool = eligible.filter((n) => n.priority);
  const pool = priorityPool.length ? priorityPool : eligible.filter((n) => !n.priority);
  const priorityMode = priorityPool.length > 0;
  const gap = priorityMode ? config.priorityGap : config.gap;

  if (!preview) {
    advanceGame(state, priorityMode, config.notices);
  }

  pruneShown(state, config.notices);

  if (!pool.length) {
    if (!preview) persistNotice(state);
    return null;
  }

  if (!preview && state.gamesSince < gap) {
    persistNotice(state);
    return null;
  }

  const chosen = longestWaiting(pool, state.shown);
  if (!chosen) {
    if (!preview) persistNotice(state);
    return null;
  }

  const entry = state.shown[chosen.id] || { gamesSince: 0, message: 0 };
  const index = ((entry.message % chosen.messages.length) + chosen.messages.length) % chosen.messages.length;
  const text = chosen.messages[index];

  if (!preview) {
    state.gamesSince = 0;
    state.shown[chosen.id] = {
      gamesSince: 0,
      message: (index + 1) % chosen.messages.length,
    };
    persistNotice(state);
  }

  return { id: chosen.id, text, url: chosen.url };
}

function advanceGame(state, priorityMode, notices) {
  if (counted) return;
  counted = true;

  if (state.priorityActive && !priorityMode) {
    state.gamesSince = 0;
  } else {
    state.gamesSince = Math.max(0, Number(state.gamesSince) || 0) + 1;
  }

  const known = new Set(notices.map((n) => n.id));
  for (const id of Object.keys(state.shown)) {
    if (!known.has(id)) {
      delete state.shown[id];
      continue;
    }
    const entry = state.shown[id];
    entry.gamesSince = Math.max(0, Number(entry.gamesSince) || 0) + 1;
  }

  state.priorityActive = priorityMode;
}

function pruneShown(state, notices) {
  const known = new Set(notices.map((n) => n.id));
  for (const id of Object.keys(state.shown)) {
    if (!known.has(id)) delete state.shown[id];
  }
}

function persistNotice(state) {
  settings.notice = state;
  saveSettings();
}

function isEligible(notice, today) {
  if (notice.from && today < notice.from) return false;
  if (notice.until && today > notice.until) return false;
  return true;
}

function localDateString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function longestWaiting(pool, shown) {
  let best = null;
  let bestWait = -1;
  for (const notice of pool) {
    const entry = shown[notice.id];
    const wait = entry ? Number(entry.gamesSince) || 0 : Number.POSITIVE_INFINITY;
    if (
      wait > bestWait
      || (wait === bestWait && (!best || notice.id < best.id))
    ) {
      best = notice;
      bestWait = wait;
    }
  }
  return best;
}

function removeNotice(doc) {
  doc.querySelectorAll('.blc-notice').forEach((el) => el.remove());
}

function placeNotice(doc, info) {
  const list = doc.querySelector('.messages');
  if (!list) return;
  let note = null;
  for (const child of list.children) {
    if (child.classList?.contains('blc-notice')) {
      note = child;
      break;
    }
  }
  if (!note) note = buildNotice(doc, info);
  else fillNotice(note, info);

  const update = list.querySelector('.blc-update-note');
  const placed = update
    ? note.previousElementSibling === update
    : list.firstElementChild === note;
  if (placed) return;

  const scroller = messageScroller(list);
  const prevTop = scroller ? scroller.scrollTop : 0;
  const prevHeight = scroller ? scroller.scrollHeight : 0;
  if (update) list.insertBefore(note, update.nextSibling);
  else list.insertBefore(note, list.firstElementChild);
  if (!scroller || prevTop <= 0) return;
  const grown = scroller.scrollHeight - prevHeight;
  if (grown > 0) scroller.scrollTop = prevTop + grown;
}

function buildNotice(doc, info) {
  const box = doc.createElement('div');
  box.className = 'message-box blc-injected blc-notice';

  const chat = doc.createElement('div');
  chat.className = 'chat-message';

  const name = doc.createElement('div');
  name.className = 'message-name';
  name.textContent = 'better-lol-chat';

  const colon = doc.createElement('span');
  colon.className = 'message';
  colon.textContent = ':';

  const body = doc.createElement('span');
  body.className = 'message blc-notice-body';

  chat.append(name, doc.createTextNode(' '), colon, doc.createTextNode(' '), body);
  box.appendChild(chat);
  box.addEventListener('click', (event) => {
    const url = box.dataset.blcUrl;
    if (!url) return;
    event.preventDefault();
    event.stopPropagation();
    window.open(url, '_blank', 'noopener');
  });
  fillNotice(box, info);
  return box;
}

function fillNotice(box, info) {
  const body = box.querySelector('.blc-notice-body');
  if (body && body.textContent !== info.text) body.textContent = info.text;
  if (info.url) {
    box.dataset.blcUrl = info.url;
    box.setAttribute('role', 'link');
    box.classList.add('blc-notice-link');
  } else {
    delete box.dataset.blcUrl;
    box.removeAttribute('role');
    box.classList.remove('blc-notice-link');
  }
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
