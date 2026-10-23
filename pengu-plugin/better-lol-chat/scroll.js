import { settings } from './settings.js';

// The client scrolls the messages frame to the bottom when a row arrives.
// Pause scroll while reading lets that happen only when the reader is already
// there. A wheel, touch, scrollbar drag, or scroll key leaves the bottom, and
// the next programmatic jump is put back on the line that was in view.

const SCROLL_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'PageUp',
  'PageDown',
  'Home',
  'End',
  ' ',
]);

const NEAR_BOTTOM = 8;
const USER_SCROLL_MS = 400;

const docs = new WeakMap();
const patched = new WeakSet();

function ensureState(doc) {
  let state = docs.get(doc);
  if (state) return state;
  state = {
    applied: undefined,
    following: true,
    anchor: null,
    top: 0,
    restoring: false,
    userUntil: 0,
    pointerDown: false,
  };
  docs.set(doc, state);

  const mark = () => {
    state.userUntil = performance.now() + USER_SCROLL_MS;
  };
  doc.addEventListener('wheel', mark, { capture: true, passive: true });
  doc.addEventListener('touchmove', mark, { capture: true, passive: true });
  const press = () => {
    state.pointerDown = true;
    mark();
  };
  const release = () => {
    state.pointerDown = false;
    mark();
  };
  doc.addEventListener('pointerdown', press, true);
  doc.addEventListener('pointerup', release, true);
  doc.addEventListener('pointercancel', release, true);
  doc.addEventListener('mousedown', press, true);
  doc.addEventListener('mouseup', release, true);
  doc.addEventListener('keydown', (event) => {
    if (SCROLL_KEYS.has(event.key)) mark();
  }, true);
  doc.addEventListener('scroll', () => onScroll(doc, state), true);
  return state;
}

function userActive(state) {
  return state.pointerDown || performance.now() < state.userUntil;
}

function nearBottom(el) {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM;
}

function candidates(doc) {
  const found = [];
  const seen = new Set();
  const add = (el) => {
    if (!el || seen.has(el)) return;
    seen.add(el);
    found.push(el);
  };
  let node = doc.querySelector('.messages');
  while (node && node !== doc) {
    add(node);
    node = node.parentElement;
  }
  add(doc.scrollingElement);
  add(doc.body);
  add(doc.documentElement);
  return found;
}

function messageScroller(doc) {
  const view = doc.defaultView;
  let fallback = doc.scrollingElement || doc.body || null;
  for (const el of candidates(doc)) {
    const oy = view?.getComputedStyle(el)?.overflowY || '';
    const scrolls = /(auto|scroll)/.test(oy) || el === doc.scrollingElement;
    if (!scrolls) continue;
    if (el.scrollHeight > el.clientHeight + 1) return el;
    fallback = el;
  }
  return fallback;
}

// Distance from the visible top of the frame to the row. The document
// scroller's own border box moves with scrollTop, so it is not a stable origin.
function visualOffset(node, scroller) {
  const doc = node.ownerDocument;
  const top = node.getBoundingClientRect().top;
  if (
    scroller === doc.scrollingElement ||
    scroller === doc.body ||
    scroller === doc.documentElement
  ) {
    return top;
  }
  return top - scroller.getBoundingClientRect().top;
}

function captureAnchor(scroller) {
  const boxes = scroller.ownerDocument.querySelectorAll('.messages .message-box');
  for (const box of boxes) {
    if (!box.offsetHeight) continue;
    const top = visualOffset(box, scroller);
    if (top + box.offsetHeight > 1) return { node: box, offset: top };
  }
  return null;
}

function restoreAnchor(scroller, anchor) {
  if (!anchor?.node?.isConnected || !anchor.node.offsetHeight) return false;
  const delta = visualOffset(anchor.node, scroller) - anchor.offset;
  if (Math.abs(delta) < 1) return true;
  scroller.scrollTop += delta;
  return true;
}

function remember(state, el) {
  state.following = nearBottom(el);
  state.top = el.scrollTop;
  state.anchor = state.following ? null : captureAnchor(el);
}

function hold(state, el) {
  state.restoring = true;
  try {
    if (!restoreAnchor(el, state.anchor)) el.scrollTop = state.top;
    state.top = el.scrollTop;
  } finally {
    state.restoring = false;
  }
}

function onScroll(doc, state) {
  if (state.restoring) return;
  const el = messageScroller(doc);
  if (!el) return;
  if (userActive(state)) {
    remember(state, el);
    return;
  }
  if (!settings.pauseScroll || state.following) {
    state.top = el.scrollTop;
    return;
  }
  hold(state, el);
}

function patch(el, doc, state) {
  if (!el || patched.has(el)) return;
  const proto = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
  if (!proto?.get || !proto?.set) return;
  patched.add(el);
  try {
    Object.defineProperty(el, 'scrollTop', {
      configurable: true,
      enumerable: true,
      get() {
        return proto.get.call(this);
      },
      set(value) {
        // Wheel and scrollbar drags do not come through this setter. A write
        // while the reader is away from the bottom is the client's jump.
        if (state.restoring || !settings.pauseScroll || state.following) {
          proto.set.call(this, value);
          return;
        }
        const current = messageScroller(doc) || this;
        state.restoring = true;
        try {
          proto.set.call(this, value);
          if (!restoreAnchor(current, state.anchor)) proto.set.call(current, state.top);
          state.top = proto.get.call(current);
        } finally {
          state.restoring = false;
        }
      },
    });
  } catch {
    patched.delete(el);
  }
}

function applySetting(doc, state) {
  const next = settings.pauseScroll;
  const changed = state.applied !== undefined && state.applied !== next;
  state.applied = next;
  const el = messageScroller(doc);
  if (!el) return;
  // The frame often hooks before the client sticks to the latest line.
  // Only a reader gesture, or turning the option on mid-chat, leaves the bottom.
  if (!next || !changed) {
    state.following = true;
    state.anchor = null;
    state.top = el.scrollTop;
    return;
  }
  remember(state, el);
}

export function installScrollHold(doc) {
  if (!doc?.documentElement) return;
  const state = ensureState(doc);
  for (const el of candidates(doc)) patch(el, doc, state);
  if (state.applied !== settings.pauseScroll) applySetting(doc, state);
}

export function syncScrollHold(doc) {
  installScrollHold(doc);
}

export function followLatest(doc) {
  if (!doc) return;
  installScrollHold(doc);
  const state = docs.get(doc);
  const el = messageScroller(doc);
  if (!el) return;
  if (state) {
    state.following = true;
    state.anchor = null;
  }
  el.scrollTop = el.scrollHeight;
  if (state) state.top = el.scrollTop;
}
