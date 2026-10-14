import './style.css';
import frameCss from './frame.css?raw';
import { settings, applyFrameSettings } from './settings.js';
import {
  initOptions,
  closeOptions,
  optionsAreOpen,
  placeOptionsPanel,
  attachCreditChrome,
  syncOptionsScrollbar,
} from './options.js';
import { refreshIdentities, clearRoster, players, seedRoster } from './roster.js';
import { rewriteMessages, matchAlias, stripBidi } from './messages.js';
import { installSampleCommands } from './commands.js';
import { beginPostGameUpdateCheck, mountUpdateNotice } from './update.js';
import { beginPostGameNoticeCheck, mountNotice, clearNoticeMount } from './notice.js';
import { closeUpdateDialog, updateDialogIsOpen } from './update-dialog.js';

const LOG = '[better-lol-chat]';
const VERSION = '0.6.6';
const CREDIT_TEXT = `better-lol-chat by wryguy`;
const POSTGAME_PHASES = new Set([
  'WaitingForStats',
  'PreEndOfGame',
  'EndOfGame',
]);

const ROOM_SEL = 'lol-social-chat-room[type="postGame"]';
const TOGGLE_SEL = '.chat-toggle-button';
const FRAME_SEL = 'iframe#embedded-messages-frame, iframe';
const FOCUSED_CLASS = 'focused-chat-box';
const COLLAPSED_CLASS = 'blc-collapsed';

let socket = null;
let inPostGame = false;
let windowCollapsed = false;
let applying = false;
let chatRoom = null;
let focusClassObserver = null;
let focusWatchRoom = null;
let focusWatchBox = null;
let chatBottomViewport = 0;
let onScoreboard = false;
let wasOnScoreboard = false;
const frameObservers = new WeakMap();

window.__blcSeedRoster = (entries) => {
  const added = seedRoster(entries);
  scheduleEnhance();
  return added;
};

initOptions({
  version: VERSION,
  creditText: CREDIT_TEXT,
  getRoom: () => chatRoom || findPostGameRoom(),
  getFrameDocument,
  onCommit() {
    scheduleEnhance();
    ensureOpen();
  },
  armFrameEscape,
  collapseChat() {
    if (optionsAreOpen()) closeOptions();
    collapseWindow();
  },
  onOptionsOpen() {
    holdChatForOptions();
  },
});

export function init(context) {
  socket = context.socket;

  socket.observe('/lol-gameflow/v1/gameflow-phase', ({ data }) => {
    onPhase(typeof data === 'string' ? data : data?.phase || data);
  });
  socket.observe('/lol-end-of-game/v1/eog-stats-block', () => {
    if (inPostGame) refreshIdentities().catch((err) => console.warn(LOG, err));
  });
  socket.observe('/lol-chat/v1/conversations', () => {
    if (inPostGame) refreshIdentities().catch((err) => console.warn(LOG, err));
  });
}

export function load() {
  console.log(LOG, `v${VERSION}`);

  fetch('/lol-gameflow/v1/gameflow-phase')
    .then((r) => (r.ok ? r.json() : null))
    .then((phase) => onPhase(phase))
    .catch(() => {});

  const observer = new MutationObserver(() => {
    if (!inPostGame || applying || focusWrite) return;
    scheduleEnhance();
    scheduleEnsureOpen();
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class'],
  });

  installSampleCommands({
    collapsed: () => windowCollapsed,
    findRoom: findPostGameRoom,
  });

  document.addEventListener('pointerdown', onOptionsHold, true);
  document.addEventListener('pointerup', onOptionsHold, true);
  document.addEventListener('pointerdown', onHostPointerDown, true);
  document.addEventListener('pointerdown', onToggleIntercept, true);
  document.addEventListener('click', onToggleIntercept, true);
  document.addEventListener('pointerdown', onInputOpen, true);
  document.addEventListener('focusin', onInputOpen, true);
  document.addEventListener('pointerdown', onOutsidePointerDown, true);
  document.addEventListener('pointerup', onOutsidePointerUp, true);
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('focusout', onFocusOut, true);

  window.addEventListener('blur', () => {
    if (!inPostGame) return;
    scheduleEnsureOpen(0);
    scheduleEnsureOpen(50);
    scheduleEnsureOpen(150);
  });
  window.addEventListener('focus', () => {
    if (!inPostGame) return;
    scheduleEnsureOpen(0);
  });
  document.addEventListener('visibilitychange', () => {
    if (!inPostGame) return;
    scheduleEnsureOpen();
  });

  setInterval(() => {
    if (inPostGame) ensureOpen();
  }, 250);

  window.addEventListener('resize', () => {
    clearStretch(chatRoom);
    clearScoreboardIcons();
    if (inPostGame) scheduleEnsureOpen(0);
  });
}

function onPhase(phase) {
  const next = POSTGAME_PHASES.has(String(phase || ''));
  if (next === inPostGame && next) return;
  const leavingPostGame = inPostGame && !next;
  inPostGame = next;
  if (!inPostGame) {
    windowCollapsed = false;
    clearStretch(chatRoom);
    chatRoom = null;
    onScoreboard = false;
    wasOnScoreboard = false;
    clearRoster();
    if (focusClassObserver) {
      focusClassObserver.disconnect();
      focusClassObserver = null;
    }
    focusWatchRoom = null;
    focusWatchBox = null;
    clearScoreboardIcons();
    closeOptions();
    clearNoticeMount();
    if (leavingPostGame) closeUpdateDialog();
    return;
  }
  beginPostGameUpdateCheck(VERSION);
  beginPostGameNoticeCheck();
  windowCollapsed = false;
  refreshIdentities()
    .then(() => {
      scheduleEnhance();
      ensureOpen();
      setTimeout(ensureOpen, 300);
      setTimeout(ensureOpen, 1000);
      setTimeout(ensureOpen, 2500);
    })
    .catch((err) => console.warn(LOG, err));
}

function findPostGameRoom() {
  return document.querySelector(ROOM_SEL);
}

function getChatBox(room) {
  return room?.querySelector?.('.chat-box') || room;
}

function isChatOpen(room = chatRoom || findPostGameRoom()) {
  if (!room) return false;
  return room.classList.contains(FOCUSED_CLASS);
}

function releaseVanillaChat(room) {
  if (!room || isChatOpen(room) || optionsAreOpen()) return;
  clearStretch(room);
  syncCredit(room);
}

let focusWrite = 0;

function forceFocusedClass(room = chatRoom || findPostGameRoom()) {
  if (!room) return;
  focusWrite += 1;
  try {
    room.classList.add(FOCUSED_CLASS);
    const box = getChatBox(room);
    if (box && box !== room) box.classList.add(FOCUSED_CLASS);
  } finally {
    queueMicrotask(() => {
      focusWrite -= 1;
    });
  }
}

function burstRestoreFocus(room, allow = () => true) {
  const restore = () => {
    if (!allow()) return;
    const current = room?.isConnected ? room : findPostGameRoom();
    if (!current || isChatOpen(current)) return;
    withFrozenScroll(() => forceFocusedClass(current));
  };
  restore();
  const raf = requestAnimationFrame(restore);
  const timers = [0, 50, 150].map((delay) => setTimeout(restore, delay));
  return () => {
    cancelAnimationFrame(raf);
    for (const id of timers) clearTimeout(id);
  };
}

let optionsHoldingChat = false;
let optionsHoldCancel = () => {};

function clearOptionsHoldTimers() {
  const cancel = optionsHoldCancel;
  optionsHoldCancel = () => {};
  cancel();
}

function holdChatForOptions(room = findPostGameRoom()) {
  if (!inPostGame || !onScoreboard || windowCollapsed || !optionsAreOpen()) return;
  optionsHoldingChat = true;
  clearOptionsHoldTimers();
  optionsHoldCancel = burstRestoreFocus(
    room,
    () => optionsHoldingChat && !windowCollapsed && optionsAreOpen(),
  );
}

function releaseOptionsHeldChat(room = findPostGameRoom()) {
  optionsHoldingChat = false;
  clearOptionsHoldTimers();
  if (!room || settings.stickyChat) return;
  withFrozenScroll(() => clearFocusedClass(room));
  releaseVanillaChat(room);
}

function onOptionsHold(event) {
  if (!event.target?.closest?.('#blc-options')) return;
  holdChatForOptions();
}

function clearFocusedClass(room = chatRoom || findPostGameRoom()) {
  if (!room) return;
  room.classList.remove(FOCUSED_CLASS);
  getChatBox(room)?.classList?.remove(FOCUSED_CLASS);
  room.querySelectorAll(`.${FOCUSED_CLASS}`).forEach((el) => el.classList.remove(FOCUSED_CLASS));
}

function withFrozenScroll(fn) {
  const nodes = [
    document.documentElement,
    document.body,
    document.scrollingElement,
    document.querySelector('.lol-responsive-app'),
    document.querySelector('#rcp-fe-viewport-root'),
    document.querySelector('[data-screen-root]'),
  ].filter(Boolean);

  const snaps = nodes.map((el) => ({ el, top: el.scrollTop, left: el.scrollLeft }));
  const wx = window.scrollX;
  const wy = window.scrollY;
  try {
    return fn();
  } finally {
    for (const s of snaps) {
      try {
        s.el.scrollTop = s.top;
        s.el.scrollLeft = s.left;
      } catch {
        /* ignore */
      }
    }
    try {
      window.scrollTo(wx, wy);
    } catch {
      /* ignore */
    }
  }
}

function classHadFocused(value) {
  return String(value || '').split(/\s+/).includes(FOCUSED_CLASS);
}

function watchFocusClass(room) {
  if (!room) return;
  const box = getChatBox(room);
  if (focusClassObserver && focusWatchRoom === room && focusWatchBox === box) return;
  if (focusClassObserver) focusClassObserver.disconnect();
  focusWatchRoom = room;
  focusWatchBox = box;
  const targets = box && box !== room ? [room, box] : [room];
  focusClassObserver = new MutationObserver((mutations) => {
    if (!inPostGame || !onScoreboard || focusWrite) return;
    const stripped = mutations.some(
      (m) => m.target === room && classHadFocused(m.oldValue) && !room.classList.contains(FOCUSED_CLASS),
    );
    if (!stripped) return;
    if (!settings.stickyChat) {
      if (windowCollapsed) {
        windowCollapsed = false;
        room.classList.remove(COLLAPSED_CLASS);
        updateCollapsePlaceholder(room, false);
      }
      releaseVanillaChat(room);
      return;
    }
    if (windowCollapsed) {
      if (isChatOpen(room)) withFrozenScroll(() => clearFocusedClass(room));
    }
  });
  for (const el of targets) {
    focusClassObserver.observe(el, {
      attributes: true,
      attributeFilter: ['class'],
      attributeOldValue: true,
    });
  }
}

let ensureTimer = 0;
function scheduleEnsureOpen(delay = 0) {
  if (ensureTimer) clearTimeout(ensureTimer);
  ensureTimer = setTimeout(() => {
    ensureTimer = 0;
    ensureOpen();
  }, delay);
}

function ensureOpen() {
  if (!inPostGame) return;
  const room = findPostGameRoom();
  if (!room) {
    onScoreboard = scoreboardIsShowing();
    if (onScoreboard) placeScoreboardIcons();
    else clearScoreboardIcons();
    return;
  }
  chatRoom = room;
  onScoreboard = scoreboardIsShowing();
  const enteredScoreboard = onScoreboard && !wasOnScoreboard;
  if (wasOnScoreboard && !onScoreboard) {
    clearStretch(room);
    withFrozenScroll(() => clearFocusedClass(room));
  }
  wasOnScoreboard = onScoreboard;
  watchFocusClass(room);
  ensurePlayerMessagesVisible(room);

  if (onScoreboard) {
    if (!settings.stickyChat) {
      if (windowCollapsed) {
        windowCollapsed = false;
        room.classList.remove(COLLAPSED_CLASS);
        updateCollapsePlaceholder(room, false);
      }
      if (enteredScoreboard && settings.autoOpen && !isChatOpen(room)) {
        withFrozenScroll(() => forceFocusedClass(room));
      }
      if (optionsAreOpen()) restoreClosedChat(room);
      if (isChatOpen(room) || optionsAreOpen()) paintOpenChrome(room);
      else releaseVanillaChat(room);
    } else if (windowCollapsed) {
      clearStretch(room);
      room.classList.add(COLLAPSED_CLASS);
      updateCollapsePlaceholder(room, true);
      withFrozenScroll(() => clearFocusedClass(room));
    } else if (!optionsAreOpen() && !settings.autoOpen && !isChatOpen(room)) {
      clearStretch(room);
    } else {
      room.classList.remove(COLLAPSED_CLASS);
      updateCollapsePlaceholder(room, false);
      if (optionsAreOpen()) restoreClosedChat(room);
      else if (settings.autoOpen || isChatOpen(room)) withFrozenScroll(() => forceFocusedClass(room));
      paintOpenChrome(room);
    }
    placeScoreboardIcons();
  } else {
    clearScoreboardIcons();
  }
  syncCredit(room);
}

function ensurePlayerMessagesVisible(room) {
  if (!room) return;
  room.classList.add('blc-messages-unlocked');

  room.removeAttribute('can-hide-player-messages');
  room.querySelector('lol-social-chat-input')?.removeAttribute('can-hide-player-messages');

  const toggle = room.querySelector(TOGGLE_SEL);
  if (toggle) {
    toggle.classList.remove('can-hide-player-messages');
  }
}

function updateCollapsePlaceholder(room, collapsed) {
  const toggle = room?.querySelector?.(TOGGLE_SEL);
  if (!toggle) return;
  const hint = toggle.querySelector('.chat-placeholder-text');
  if (!hint) return;
  if (collapsed) {
    toggle.classList.add('has-placeholder');
    hint.classList.add('chat-placeholder-visible');
    if (!hint.dataset.blcOrig) hint.dataset.blcOrig = hint.textContent || '';
    hint.textContent = hint.dataset.blcOrig || 'Click or Enter to View';
  } else {
    hint.classList.remove('chat-placeholder-visible');
    toggle.classList.remove('has-placeholder');
  }
}

const ROW_SEL =
  '.scoreboard-row-component, .strawberry-scoreboard-row-component, .jade-scoreboard-row-component';
const ITEMS_SEL =
  '.scoreboard-row-items-container, .strawberry-scoreboard-row-items-container, .jade-scoreboard-row-items-container';
const CONTENT_SEL =
  '.scoreboard-row-content-container, .strawberry-scoreboard-row-content-container, .jade-scoreboard-row-content-container';
const PIKE_SEL = '.scoreboard-row-pike, .strawberry-scoreboard-row-pike, .jade-scoreboard-row-pike';
const KEY_SEL =
  '.scoreboard-row-keystone-container, .strawberry-scoreboard-row-keystone-container, .jade-scoreboard-row-keystone-container';
const LEVEL_SEL =
  '.scoreboard-row-in-game-level, .strawberry-scoreboard-row-in-game-level, .jade-scoreboard-row-in-game-level';
const DETAILS_SEL =
  '.scoreboard-row-player-details-container, .strawberry-scoreboard-row-player-details-container, .jade-scoreboard-row-player-details-container';
const CONTROLS_SEL =
  '.scoreboard-row-player-controls-container, .strawberry-scoreboard-row-player-controls-container, .jade-scoreboard-row-player-controls-container';
const ACTIONS_SEL =
  '.scoreboard-row-actions-button-container, .strawberry-scoreboard-row-actions-button-container, .jade-scoreboard-row-actions-button-container';
const ROW_NAME_SEL =
  '.scoreboard-row-player-name, .strawberry-scoreboard-row-player-name, .jade-scoreboard-row-player-name';
const ROW_CHAMP_SEL =
  '.scoreboard-row-champ-name, .strawberry-scoreboard-row-champ-name, .jade-scoreboard-row-champ-name';
const MID_ROW = 'blc-mid-row';

let midRowSizes = new WeakMap();
const midRowInline = new WeakMap();
const midRowTouched = new Set();
let runeGap = new WeakMap();
const RUNE_GAP = 4;
const RUNE_SEL =
  '.scoreboard-row-keystone-alignment-container, .strawberry-scoreboard-row-keystone-alignment-container, .jade-scoreboard-row-keystone-alignment-container';
let levelSlot = 0;
let levelSlotKey = '';

function playerForRow(row) {
  const name = stripBidi(row.querySelector(ROW_NAME_SEL)?.textContent || '').trim();
  const byName = name && matchAlias(name);
  if (byName?.player?.iconPath) return byName.player;
  const champ = stripBidi(row.querySelector(ROW_CHAMP_SEL)?.textContent || '')
    .trim()
    .toLowerCase();
  if (!champ) return null;
  return players().find((p) => p.championName && p.championName.toLowerCase() === champ && p.iconPath) || null;
}

function clearScoreboardIcons() {
  document.querySelectorAll('.' + MID_ROW + ', .blc-row-champ').forEach((el) => el.remove());
  for (const el of midRowTouched) {
    const saved = midRowInline.get(el);
    if (!saved || !el.isConnected) continue;
    el.style.width = saved.width;
    el.style.flexGrow = saved.flexGrow;
    el.style.flexShrink = saved.flexShrink;
    el.style.flexBasis = saved.flexBasis;
    el.style.minWidth = saved.minWidth;
    el.style.maxWidth = saved.maxWidth;
    el.style.marginLeft = saved.marginLeft;
  }
  midRowTouched.clear();
  runeGap = new WeakMap();
  midRowSizes = new WeakMap();
  levelSlot = 0;
  levelSlotKey = '';
}

function champIconSize() {
  const icon = document.querySelector(
    '.postgame-player-keystone-icon.circle-icon-holder:not(.is-sub-style)',
  );
  const rect = icon?.getBoundingClientRect();
  const measured = rect ? Math.round(Math.min(rect.width, rect.height)) : 0;
  return measured >= 16 ? measured : 30;
}

function midRowHidden() {
  if (!settings.showMidRow || !onScoreboard || !players().length) return true;
  if (windowCollapsed) return true;
  const room = chatRoom || findPostGameRoom();
  if (!room) return false;
  return room.classList.contains(COLLAPSED_CLASS) || !isChatOpen(room);
}

function outerWidth(el) {
  return el ? el.getBoundingClientRect().width : 0;
}

function rememberMidRowInline(el) {
  if (!el) return;
  if (!midRowInline.has(el)) {
    midRowInline.set(el, {
      width: el.style.width,
      flexGrow: el.style.flexGrow,
      flexShrink: el.style.flexShrink,
      flexBasis: el.style.flexBasis,
      minWidth: el.style.minWidth,
      maxWidth: el.style.maxWidth,
      marginLeft: el.style.marginLeft,
    });
  }
  midRowTouched.add(el);
}

function applyOuterWidth(el, outer) {
  if (!el || !(outer > 0)) return;
  rememberMidRowInline(el);
  const cs = getComputedStyle(el);
  let width = outer;
  if (cs.boxSizing !== 'border-box') {
    width -=
      parseFloat(cs.paddingLeft) +
      parseFloat(cs.paddingRight) +
      parseFloat(cs.borderLeftWidth) +
      parseFloat(cs.borderRightWidth);
  }
  width = Math.max(0, width);
  const px = width + 'px';
  el.style.flexGrow = '0';
  el.style.flexShrink = '0';
  el.style.flexBasis = px;
  el.style.width = px;
  el.style.minWidth = px;
  el.style.maxWidth = px;
}

function tightenRuneGap(key) {
  const align = key?.querySelector(RUNE_SEL);
  if (!align) return 0;
  let original = runeGap.get(align);
  if (original == null) {
    original = parseFloat(getComputedStyle(align).marginLeft) || 0;
    runeGap.set(align, original);
    rememberMidRowInline(align);
  }
  if (original > RUNE_GAP) align.style.marginLeft = RUNE_GAP + 'px';
  return Math.max(0, original - RUNE_GAP);
}

function captureMidRowSizes(row, content) {
  const saved = midRowSizes.get(row);
  if (saved) return saved;
  const badge = content.querySelector(':scope > .' + MID_ROW);
  const next = badge?.nextSibling;
  if (badge) badge.remove();
  const sizes = {
    details: outerWidth(content.querySelector(DETAILS_SEL)),
    controls: outerWidth(row.querySelector(CONTROLS_SEL)),
    actions: outerWidth(content.querySelector(ACTIONS_SEL)),
    items: outerWidth(content.querySelector(ITEMS_SEL)),
  };
  if (badge) content.insertBefore(badge, next);
  midRowSizes.set(row, sizes);
  return sizes;
}

function levelBoxWidth(realStyle) {
  const key = [realStyle.fontSize, realStyle.fontFamily, realStyle.fontWeight, realStyle.lineHeight].join('|');
  if (levelSlot && levelSlotKey === key) return levelSlot;
  const probe = document.createElement('span');
  probe.textContent = '18';
  probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;font-variant-numeric:tabular-nums;';
  probe.style.fontSize = realStyle.fontSize;
  probe.style.fontFamily = realStyle.fontFamily;
  probe.style.fontWeight = realStyle.fontWeight;
  probe.style.lineHeight = realStyle.lineHeight;
  (document.body || document.documentElement).appendChild(probe);
  levelSlot = Math.ceil(probe.getBoundingClientRect().width);
  levelSlotKey = key;
  probe.remove();
  return levelSlot;
}

function ensureMidRow(content, key) {
  let box = content.querySelector(':scope > .' + MID_ROW);
  if (!box) {
    box = document.createElement('div');
    box.className = MID_ROW;
    const level = document.createElement('span');
    level.className = MID_ROW + '-level';
    const img = document.createElement('img');
    img.className = MID_ROW + '-icon';
    img.alt = '';
    img.draggable = false;
    box.append(level, img);
  }
  if (box.nextElementSibling !== key) content.insertBefore(box, key);
  return box;
}

function placeScoreboardIcons() {
  if (midRowHidden()) {
    clearScoreboardIcons();
    return;
  }
  const iconSize = champIconSize();
  const seen = new Set();
  document.querySelectorAll('.blc-row-champ').forEach((el) => el.remove());
  for (const row of document.querySelectorAll(ROW_SEL)) {
    const rowRect = row.getBoundingClientRect();
    if (rowRect.width < 1 || rowRect.height < 1) continue;
    const content = row.querySelector(CONTENT_SEL);
    const key = content?.querySelector(KEY_SEL);
    const pike = content?.querySelector(PIKE_SEL);
    if (!content || !key || !pike || key.parentElement !== content) continue;
    const player = playerForRow(row);
    if (!player?.iconPath) continue;
    const levelNode = row.querySelector(LEVEL_SEL);
    const levelText = stripBidi(levelNode?.textContent || '').replace(/\s+/g, '');
    const sizes = captureMidRowSizes(row, content);
    const box = ensureMidRow(content, key);
    const levelEl = box.querySelector('.' + MID_ROW + '-level');
    const img = box.querySelector('.' + MID_ROW + '-icon');
    const realStyle = levelNode ? getComputedStyle(levelNode) : null;

    levelEl.textContent = levelText;
    levelEl.style.display = levelText ? '' : 'none';
    if (realStyle) {
      levelEl.style.fontSize = realStyle.fontSize;
      levelEl.style.fontFamily = realStyle.fontFamily;
      levelEl.style.fontWeight = realStyle.fontWeight;
      levelEl.style.lineHeight = realStyle.lineHeight;
      levelEl.style.color = realStyle.color;
      levelEl.style.width = levelBoxWidth(realStyle) + 'px';
    }

    img.style.width = iconSize + 'px';
    img.style.height = iconSize + 'px';
    if (img.getAttribute('src') !== player.iconPath) img.src = player.iconPath;

    const boxStyle = getComputedStyle(box);
    const badgeWidth = box.offsetWidth + parseFloat(boxStyle.marginLeft) + parseFloat(boxStyle.marginRight);
    const runeSpace = tightenRuneGap(key);
    applyOuterWidth(content.querySelector(DETAILS_SEL), sizes.details);
    applyOuterWidth(row.querySelector(CONTROLS_SEL), sizes.controls);
    applyOuterWidth(content.querySelector(ACTIONS_SEL), sizes.actions);
    applyOuterWidth(content.querySelector(ITEMS_SEL), Math.max(0, sizes.items - badgeWidth + runeSpace));
    seen.add(box);
  }
  document.querySelectorAll('.' + MID_ROW).forEach((el) => {
    if (!seen.has(el)) el.remove();
  });
}

function scoreboardIsShowing() {
  const team = firstTeamContainer();
  if (!team) return false;
  const rect = team.getBoundingClientRect();
  const viewW = window.innerWidth || document.documentElement.clientWidth;
  const viewH = window.innerHeight || document.documentElement.clientHeight;
  if (rect.bottom < 0 || rect.right < 0 || rect.top > viewH || rect.left > viewW) return false;
  const style = getComputedStyle(team);
  if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
  return true;
}

function topmostVisible(selector) {
  let best = null;
  let bestTop = Infinity;
  for (const el of document.querySelectorAll(selector)) {
    const rect = el.getBoundingClientRect();
    if (rect.height < 1 || rect.width < 1) continue;
    if (rect.top < bestTop) {
      bestTop = rect.top;
      best = el;
    }
  }
  return best;
}

function firstTeamContainer() {
  return topmostVisible('.scoreboard-team-container');
}

function clearStretch(room) {
  chatBottomViewport = 0;
  clearHeaderShift();
  if (!room) return;
  room.classList.remove('blc-stretched');
  for (const name of ['--blc-chat-h', '--blc-chat-top', '--blc-chat-left', '--blc-chat-w', '--blc-frame-h']) {
    room.style.removeProperty(name);
  }
}

function setVar(el, name, value) {
  if (el.style.getPropertyValue(name) !== value) el.style.setProperty(name, value);
}

function restoreClosedChat(room) {
  if (!room || isChatOpen(room)) return;
  withFrozenScroll(() => forceFocusedClass(room));
}

function paintOpenChrome(room) {
  if (settings.tallerChat) stretchChat(room);
  else clearStretch(room);
  placeOptionsPanel();
}

function stretchChat(room) {
  if (!room || windowCollapsed) return;
  const header = playerTeamHeader();
  const anchor = header || firstTeamContainer();
  if (!anchor) return;

  const parent = room.offsetParent instanceof Element ? room.offsetParent : room.parentElement;
  if (!parent) return;
  const parentRect = parent.getBoundingClientRect();

  if (!room.classList.contains('blc-stretched') || !chatBottomViewport) {
    const rect = room.getBoundingClientRect();
    if (rect.height < 1 || rect.width < 1) return;
    chatBottomViewport = rect.bottom;
    setVar(room, '--blc-chat-left', `${Math.round(rect.left - parentRect.left)}px`);
    setVar(room, '--blc-chat-w', `${Math.round(rect.width)}px`);
  }

  const anchorTop = anchor.getBoundingClientRect().top;
  const height = Math.round(chatBottomViewport - anchorTop);
  if (height < 48) return;

  const input = room.querySelector('lol-social-chat-input');
  const inputH = Math.round(input?.getBoundingClientRect().height || 0);
  setVar(room, '--blc-chat-top', `${Math.round(anchorTop - parentRect.top)}px`);
  setVar(room, '--blc-chat-h', `${height}px`);
  setVar(room, '--blc-frame-h', `${Math.max(48, height - inputH)}px`);
  if (!room.classList.contains('blc-stretched')) {
    withFrozenScroll(() => room.classList.add('blc-stretched'));
  }
  if (header) shiftHeadersToChat(room);
  else clearHeaderShift();
}

function playerTeamHeader() {
  return topmostVisible('.scoreboard-header-component.is-player-team');
}

function visibleScoreboardHeaders() {
  const headers = [];
  for (const el of document.querySelectorAll('.scoreboard-header-component')) {
    const rect = el.getBoundingClientRect();
    if (rect.height < 1 || rect.width < 1) continue;
    headers.push(el);
  }
  return headers;
}

function clearHeaderShift() {
  document.querySelectorAll('.blc-header-chat-gutter').forEach((el) => el.remove());
  document.querySelectorAll('.scoreboard-header-component.blc-header-shifted').forEach((el) => {
    el.classList.remove('blc-header-shifted');
  });
  document.querySelectorAll('.scoreboard-header-content').forEach((content) => {
    content.style.removeProperty('width');
    content.style.removeProperty('min-width');
    content.style.removeProperty('max-width');
    content.style.removeProperty('flex');
  });
}

function releaseHeaderContentWidth(header) {
  const content = header.querySelector(':scope > .scoreboard-header-content');
  if (!content) return;
  // Inline !important beats Riot's fixed 500px header width.
  content.style.setProperty('width', 'max-content', 'important');
  content.style.setProperty('min-width', '0', 'important');
  content.style.setProperty('max-width', 'none', 'important');
  content.style.setProperty('flex', '0 0 auto', 'important');
}

function viewportToCss(el, viewportPx) {
  const width = el.getBoundingClientRect().width;
  const local = el.offsetWidth;
  if (width < 1 || local < 1) return viewportPx;
  return viewportPx * (local / width);
}

function ensureHeaderGutter(header) {
  let gutter = header.querySelector(':scope > .blc-header-chat-gutter');
  if (!gutter) {
    gutter = document.createElement('div');
    gutter.className = 'blc-header-chat-gutter';
    gutter.setAttribute('aria-hidden', 'true');
  }
  if (header.firstElementChild !== gutter) header.insertBefore(gutter, header.firstChild);
  header.classList.add('blc-header-shifted');
  return gutter;
}

function setHeaderGutter(headers, px) {
  const value = `${Math.max(0, Math.round(px))}px`;
  for (const header of headers) {
    const gutter = ensureHeaderGutter(header);
    gutter.style.setProperty('width', value, 'important');
  }
}

function shiftHeadersToChat(room) {
  const headers = visibleScoreboardHeaders();
  const player = headers.find((el) => el.classList.contains('is-player-team'));
  const chatRight = room?.getBoundingClientRect().right || 0;
  if (!player || chatRight < 1) {
    clearHeaderShift();
    return;
  }

  for (const header of headers) releaseHeaderContentWidth(header);
  const gutter = ensureHeaderGutter(player);
  const span = chatRight - gutter.getBoundingClientRect().left;
  if (span < 1) {
    clearHeaderShift();
    return;
  }
  setHeaderGutter(headers, viewportToCss(player, span));
}

function collapseWindow(room = findPostGameRoom()) {
  if (!room) return;
  windowCollapsed = true;
  clearStretch(room);
  room.classList.add(COLLAPSED_CLASS);
  updateCollapsePlaceholder(room, true);
  withFrozenScroll(() => clearFocusedClass(room));
  room.querySelector('textarea.chat-input, textarea')?.blur?.();
  syncCredit(room);
  closeOptions();
}

function expandWindow(room = findPostGameRoom()) {
  if (!room) return;
  windowCollapsed = false;
  room.classList.remove(COLLAPSED_CLASS);
  updateCollapsePlaceholder(room, false);
  ensurePlayerMessagesVisible(room);
  withFrozenScroll(() => forceFocusedClass(room));
  syncCredit(room);
}

function toggleFullWindow(room = findPostGameRoom()) {
  if (!room) return;
  if (windowCollapsed || !isChatOpen(room) || room.classList.contains(COLLAPSED_CLASS)) {
    expandWindow(room);
  } else {
    collapseWindow(room);
  }
}

function onToggleIntercept(event) {
  if (!inPostGame || !settings.stickyChat) return;
  const room = findPostGameRoom();
  if (!room) return;
  const toggle = event.target?.closest?.(TOGGLE_SEL);
  if (!toggle || !room.contains(toggle)) return;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  if (event.type === 'pointerdown' && event.button === 0) {
    toggleFullWindow(room);
  }
}

function onInputOpen(event) {
  if (!inPostGame || !windowCollapsed) return;
  if (event.type === 'pointerdown' && event.button !== 0) return;
  const room = findPostGameRoom();
  if (!room || !room.contains(event.target)) return;
  if (event.target.closest?.(TOGGLE_SEL)) return;
  const field = event.target.closest?.(
    'textarea, input.chat-input, lol-social-chat-input, .chat-placeholder-text, .input-sizer',
  );
  if (!field) return;
  expandWindow(room);
}

function onHostPointerDown(event) {
  if (event.target?.closest?.('#blc-options, #blc-update-dialog')) return;
  const menuWasOpen = optionsAreOpen();
  closeOptions();
  if (settings.stickyChat || !inPostGame || windowCollapsed) return;
  if (!menuWasOpen && !optionsHoldingChat) return;
  const room = findPostGameRoom();
  if (!room || room.contains(event.target)) return;
  releaseOptionsHeldChat(room);
}

function onOutsidePointerDown(event) {
  if (!inPostGame || !settings.stickyChat || !onScoreboard || windowCollapsed) return;
  const room = findPostGameRoom();
  if (!room || (!settings.autoOpen && !isChatOpen(room))) return;
  if (event.target?.closest?.(TOGGLE_SEL)) return;
  if (room.contains(event.target)) return;
  withFrozenScroll(() => forceFocusedClass(room));
}

function onOutsidePointerUp(event) {
  if (!inPostGame || !settings.stickyChat || !onScoreboard || windowCollapsed) return;
  const room = findPostGameRoom();
  if (!room || (!settings.autoOpen && !isChatOpen(room))) return;
  if (event.target?.closest?.(TOGGLE_SEL)) return;

  if (!room.contains(event.target)) burstRestoreFocus(room);
}

function onFocusOut(event) {
  if (!inPostGame || !onScoreboard || windowCollapsed) return;
  const room = findPostGameRoom();
  if (!room) return;
  const leaving = event.target;
  if (!room.contains(leaving)) return;
  const next = event.relatedTarget;
  if (next && room.contains(next)) return;
  if (optionsAreOpen()) {
    holdChatForOptions(room);
    return;
  }
  if (!settings.stickyChat) return;
  withFrozenScroll(() => forceFocusedClass(room));
}

function onKeyDown(event) {
  if (event.key === 'Escape') {
    onEscape(event);
    return;
  }
  if (!inPostGame) return;
  if (event.key !== 'Enter') return;
  if (windowCollapsed) {
    expandWindow(findPostGameRoom());
    return;
  }
  scheduleEnsureOpen(0);
}

function foreignTextEntry(room) {
  const active = document.activeElement;
  if (!active || active === document.body || active === document.documentElement) return false;
  if (room?.contains(active)) return false;
  if (active.closest?.('#blc-options')) return false;
  return active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || !!active.isContentEditable;
}

function chatWindowIsFocused(room = findPostGameRoom()) {
  if (!inPostGame || !onScoreboard || windowCollapsed || !room) return false;
  if (room.classList.contains(COLLAPSED_CLASS) || !isChatOpen(room)) return false;
  if (foreignTextEntry(room)) return false;
  return true;
}

function onEscape(event) {
  if (event.key !== 'Escape') return;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (updateDialogIsOpen()) {
    event.preventDefault();
    event.stopPropagation();
    closeUpdateDialog();
    return;
  }
  if (optionsAreOpen()) {
    closeOptions();
    return;
  }
  if (!settings.stickyChat) return;
  const room = findPostGameRoom();
  if (!chatWindowIsFocused(room)) return;
  event.preventDefault();
  event.stopPropagation();
  collapseWindow(room);
}

function armFrameEscape(doc) {
  const root = doc?.documentElement;
  if (!root || root.dataset.blcEscHooked) return;
  root.dataset.blcEscHooked = '1';
  doc.addEventListener('keydown', onEscape, true);
}

let enhanceTimer = 0;
function scheduleEnhance() {
  if (enhanceTimer) cancelAnimationFrame(enhanceTimer);
  enhanceTimer = requestAnimationFrame(() => {
    enhanceTimer = 0;
    enhance();
  });
}

function enhance() {
  if (!inPostGame || applying) return;
  applying = true;
  try {
    annotateHonorTooltip();
    const room = findPostGameRoom();
    if (!room) return;
    chatRoom = room;
    ensurePlayerMessagesVisible(room);
    hookMessageFrame(room);
    const doc = getFrameDocument(room);
    if (doc) {
      injectFrameStyles(doc);
      insertCredit(doc);
      rewriteMessages(doc);
      mountUpdateNotice(doc);
      mountNotice(doc);
    }
  } catch (err) {
    console.warn(LOG, err);
  } finally {
    applying = false;
  }
}

function plainText(value) {
  return stripBidi(value).replace(/\s+/g, ' ').trim();
}

// Honor pips hover a name-only system tooltip. The same player-name span is on
// scoreboard rows; those stay outside #lol-uikit-tooltip-root.
function annotateHonorTooltip() {
  const root = document.getElementById('lol-uikit-tooltip-root');
  if (!root) return;
  const blocks = root.querySelectorAll('lol-uikit-content-block[type="tooltip-system"]');
  for (const block of blocks) {
    const names = block.querySelectorAll('p .player-name__game-name');
    if (names.length !== 1) continue;
    const nameEl = names[0];
    const gameName = plainText(nameEl.textContent);
    if (!gameName) continue;
    const note = nameEl.nextElementSibling?.classList?.contains('blc-honor-champ')
      ? nameEl.nextElementSibling
      : null;
    let extra = plainText(block.textContent);
    const noteText = note ? plainText(note.textContent) : '';
    if (noteText && extra.endsWith(noteText)) extra = plainText(extra.slice(0, -noteText.length));
    if (extra !== gameName) {
      note?.remove();
      continue;
    }
    const champ = matchAlias(gameName)?.player?.championName;
    if (!champ || champ === 'Unknown') {
      note?.remove();
      continue;
    }
    const label = ` (${champ})`;
    if (note) {
      if (note.textContent !== label) note.textContent = label;
      continue;
    }
    const span = nameEl.ownerDocument.createElement('span');
    span.className = 'blc-honor-champ';
    span.textContent = label;
    nameEl.after(span);
  }
}

function getFrameDocument(room) {
  const iframe = room.querySelector(FRAME_SEL);
  if (!iframe) return null;
  try {
    return iframe.contentDocument || iframe.contentWindow?.document || null;
  } catch (err) {
    console.warn(LOG, 'cannot access messages iframe (cross-origin?)', err);
    return null;
  }
}

function hookMessageFrame(room) {
  const iframe = room.querySelector(FRAME_SEL);
  if (!iframe || iframe.dataset.blcHooked === '1') return;
  iframe.dataset.blcHooked = '1';

  const attach = () => {
    const doc = getFrameDocument(room);
    if (!doc) return;
    armFrameEscape(doc);
    if (frameObservers.has(doc)) return;
    const mo = new MutationObserver(() => {
      if (!inPostGame || applying) return;
      scheduleEnhance();
    });
    mo.observe(doc.documentElement || doc.body || doc, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    frameObservers.set(doc, mo);
    injectFrameStyles(doc);
    insertCredit(doc);
  };

  iframe.addEventListener('load', attach);
  attach();
  let tries = 0;
  const poll = setInterval(() => {
    attach();
    const doc = getFrameDocument(room);
    if ((doc && frameObservers.has(doc)) || ++tries > 40) clearInterval(poll);
  }, 250);
}

function scrollParent(el) {
  let node = el?.parentElement;
  const doc = el?.ownerDocument;
  while (node && node !== doc?.documentElement) {
    const style = doc.defaultView?.getComputedStyle(node);
    if (style && /(auto|scroll)/.test(style.overflowY)) return node;
    node = node.parentElement;
  }
  return doc?.scrollingElement || doc?.body || null;
}

function insertCredit(doc) {
  applyFrameSettings(doc);
  const host = doc.documentElement || doc.body;
  if (!host) return;
  let el = doc.getElementById('blc-credit');
  if (!el) {
    el = doc.createElement('div');
    el.id = 'blc-credit';
    el.className = 'blc-credit';
  }
  attachCreditChrome(doc, el);
  if (el.parentElement !== host) host.appendChild(el);
  applyCreditFont(doc, el);
  syncOptionsScrollbar(doc);
  syncCredit(roomForCredit(doc) || chatRoom);
}

function roomForCredit(doc) {
  const room = chatRoom || findPostGameRoom();
  if (room && getFrameDocument(room) === doc) return room;
  return null;
}

function syncCreditPadding(doc, el, hidden) {
  const scroller = scrollParent(doc.querySelector('.message-box') || el);
  if (!scroller || scroller === el) return;
  if (!scroller.dataset.blcCreditPad) {
    const base = parseFloat(doc.defaultView?.getComputedStyle(scroller).paddingTop) || 0;
    scroller.dataset.blcCreditPad = String(base);
  }
  const base = parseFloat(scroller.dataset.blcCreditPad) || 0;
  const next = hidden ? `${base}px` : `${base + (el.offsetHeight || 22)}px`;
  if (scroller.style.paddingTop !== next) scroller.style.paddingTop = next;
}

function applyCreditFont(doc, el) {
  const sample = doc.querySelector('.chat-message .message, .chat-message, .system-message, .message-name');
  const cs = sample ? doc.defaultView?.getComputedStyle(sample) : null;
  const label = el.querySelector('.blc-credit-label');
  if (label && cs) {
    label.style.fontFamily = cs.fontFamily;
    label.style.fontStyle = cs.fontStyle;
    label.style.letterSpacing = cs.letterSpacing;
    const size = parseFloat(cs.fontSize);
    label.style.fontSize = size ? `${size + 2}px` : cs.fontSize;
    label.style.lineHeight = '1.15';
  }
  const panel = document.getElementById('blc-options');
  if (panel && cs) {
    panel.style.fontFamily = cs.fontFamily;
    panel.style.fontStyle = cs.fontStyle;
    panel.style.letterSpacing = cs.letterSpacing;
  }
}

function syncCredit(room = chatRoom) {
  const doc = room ? getFrameDocument(room) : null;
  const el = doc?.getElementById('blc-credit');
  if (!el) return;
  const hidden = !room || windowCollapsed || !isChatOpen(room);
  el.classList.toggle('blc-credit-hidden', hidden);
  syncCreditPadding(doc, el, hidden);
}

function lolBodyBoldFace() {
  for (const sheet of document.styleSheets) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    if (!rules || !sheet.href) continue;
    for (const rule of rules) {
      if (rule.type !== CSSRule.FONT_FACE_RULE) continue;
      const family = rule.style.getPropertyValue('font-family').replace(/["']/g, '').trim();
      const weight = rule.style.getPropertyValue('font-weight').trim();
      const fontStyle = rule.style.getPropertyValue('font-style').trim() || 'normal';
      if (family !== 'LoL Body' || fontStyle === 'italic') continue;
      if (weight !== '700' && weight !== 'bold') continue;
      const src = rule.style.getPropertyValue('src');
      if (!src) continue;
      const resolved = src.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (_match, _quote, url) => {
        try {
          return `url("${new URL(url, sheet.href).href}")`;
        } catch {
          return `url("${url}")`;
        }
      });
      return `@font-face{font-family:"LoL Body";font-style:normal;font-weight:700;src:${resolved};}`;
    }
  }
  return '';
}

function injectFrameStyles(doc) {
  let style = doc.getElementById('blc-frame-style');
  if (!style) {
    style = doc.createElement('style');
    style.id = 'blc-frame-style';
    (doc.head || doc.documentElement).appendChild(style);
  }
  if (style.textContent !== frameCss) style.textContent = frameCss;

  const face = lolBodyBoldFace();
  let fontStyle = doc.getElementById('blc-frame-font');
  if (!face) {
    fontStyle?.remove();
    return;
  }
  if (!fontStyle) {
    fontStyle = doc.createElement('style');
    fontStyle.id = 'blc-frame-font';
    (doc.head || doc.documentElement).appendChild(fontStyle);
  }
  if (fontStyle.textContent !== face) fontStyle.textContent = face;
}
