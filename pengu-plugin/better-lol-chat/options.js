import './options.css';
import panelHtml from './options.html?raw';
import { mountUpdateStatus } from './update.js';
import {
  COLOR_DEFAULTS,
  applyFrameSettings,
  applyHostSettings,
  normalizeHex,
  saveSettings,
  scheduleSave,
  settings,
} from './settings.js';

const PAINT_PROPS = [
  'backgroundImage',
  'backgroundPosition',
  'backgroundSize',
  'backgroundRepeat',
  'webkitMaskImage',
  'webkitMaskPosition',
  'webkitMaskSize',
  'webkitMaskRepeat',
  'maskImage',
  'maskPosition',
  'maskSize',
  'maskRepeat',
];

const chromeToken = String(Math.random());
const ISSUES_URL = 'https://github.com/12boost/better-lol-chat/issues';
const BUG_TIP_TEXT = 'Report a Bug';
const BUG_TIP_DELAY = 450;

let bugTipTimer = 0;

let deps = {
  version: '',
  creditText: '',
  getRoom: () => null,
  getFrameDocument: () => null,
  onCommit: () => {},
  armFrameEscape: () => {},
  collapseChat: () => {},
  onOptionsOpen: () => {},
};

export function initOptions(next) {
  deps = next;
}

function frameDocument() {
  const room = deps.getRoom();
  return room ? deps.getFrameDocument(room) : null;
}

function commitSettings() {
  saveSettings();
  applyHostSettings();
  const doc = frameDocument();
  if (doc) applyFrameSettings(doc);
  deps.onCommit();
}

function hasPaint(cs) {
  if (!cs) return false;
  const bg = cs.backgroundImage;
  const mask = cs.maskImage || cs.webkitMaskImage;
  return (bg && bg !== 'none') || (mask && mask !== 'none');
}

function copyPaint(target, cs) {
  target.textContent = '';
  target.style.width = cs.width;
  target.style.height = cs.height;
  for (const prop of PAINT_PROPS) {
    const value = cs[prop];
    if (!value || value === 'none' || value === 'normal') continue;
    target.style[prop] = value;
  }
  const mask = cs.maskImage || cs.webkitMaskImage;
  if (mask && mask !== 'none' && cs.backgroundColor) target.style.backgroundColor = cs.backgroundColor;
  target.dataset.blcPainted = '1';
}

function findSettingsControl() {
  return document.querySelector('.app-controls-settings:not(.app-controls-settings-disabled)')
    || document.querySelector('.app-controls-setting')
    || document.querySelector('.app-controls-settings');
}

function paintChromeButton(button, src, fallback, restVar) {
  if (!button || button.dataset.blcPainted) return;
  const cs = src ? getComputedStyle(src) : null;
  if (!hasPaint(cs)) {
    button.textContent = fallback;
    return;
  }
  copyPaint(button, cs);
  // Resting color stays a variable so :hover can replace it. An inline color would win.
  if (button.style.backgroundColor) {
    button.style.setProperty(restVar, button.style.backgroundColor);
    button.style.backgroundColor = '';
  }
}

function paintCog(button) {
  paintChromeButton(button, findSettingsControl(), '⚙', '--blc-cog-rest');
}

function paintClose(button) {
  paintChromeButton(button, document.querySelector('.app-controls-close'), '×', '--blc-close-rest');
}

function findResetPaint() {
  const nodes = document.querySelectorAll('[class*="reset" i], [class*="refresh" i], [class*="restore" i]');
  for (const el of nodes) {
    if (el.classList.contains('app-controls-setting')) continue;
    const cs = getComputedStyle(el);
    const w = parseFloat(cs.width);
    const h = parseFloat(cs.height);
    if (w < 8 || h < 8 || w > 32 || h > 32) continue;
    if (!hasPaint(cs)) continue;
    return cs;
  }
  return null;
}

export function closeOptions() {
  const panel = document.getElementById('blc-options');
  if (!panel || panel.hidden) return;
  panel.hidden = true;
  hideBugTip();
  document.getElementById('blc-options-cog')?.setAttribute('aria-expanded', 'false');
}

function toggleOptions() {
  const panel = document.getElementById('blc-options');
  const cog = document.getElementById('blc-options-cog');
  if (!panel) return;
  const willOpen = panel.hidden;
  panel.hidden = !willOpen;
  cog?.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
  if (willOpen) {
    placeOptionsPanel();
    deps.onOptionsOpen();
  } else {
    hideBugTip();
  }
}

export function placeOptionsPanel() {
  const panel = document.getElementById('blc-options');
  if (!panel || panel.hidden) return;
  const room = deps.getRoom();
  const footer = document.querySelector('.postgame-footer');
  if (!room || !footer) return;
  const roomRect = room.getBoundingClientRect();
  const footerTop = footer.getBoundingClientRect().top;
  if (roomRect.width < 1 || footerTop < 1) return;
  panel.style.left = `${Math.round(roomRect.right)}px`;
  panel.style.right = 'auto';
  panel.style.top = 'auto';
  panel.style.bottom = `${Math.round(window.innerHeight - footerTop)}px`;
  panel.style.height = '';
  panel.style.maxHeight = '';
  const tip = document.getElementById('blc-bug-tip');
  const button = panel.querySelector('.blc-bug-report');
  if (tip && !tip.hidden && button) positionBugTip(button, tip);
}

function hookOptionsDismiss(doc) {
  if (doc.documentElement.dataset.blcOptionsHooked) return;
  doc.documentElement.dataset.blcOptionsHooked = '1';
  doc.addEventListener('pointerdown', (event) => {
    const panel = document.getElementById('blc-options');
    const cog = doc.getElementById('blc-options-cog');
    if (!panel || panel.hidden) return;
    const target = event.target;
    if (cog?.contains(target)) return;
    closeOptions();
  });
  deps.armFrameEscape(doc);
}

function bindToggle(input) {
  const key = input.dataset.blcToggle;
  if (!key || !(key in settings)) return;
  input.checked = !!settings[key];
  input.addEventListener('change', () => {
    settings[key] = input.checked;
    if (key === 'coloredBodies') syncMessageColorLock();
    commitSettings();
  });
}

function bindNameChoice(input) {
  if (input.value !== 'summoner' && input.value !== 'champion' && input.value !== 'both') return;
  input.checked = settings.nameStyle === input.value;
  input.addEventListener('change', () => {
    if (!input.checked) return;
    settings.nameStyle = input.value;
    commitSettings();
  });
}

function syncMessageColorLock(root) {
  const scope = root || document.getElementById('blc-options');
  if (!scope) return;
  const locked = !settings.coloredBodies;
  scope.querySelectorAll('.blc-color-row[data-blc-group="Messages"]').forEach((row) => {
    row.classList.toggle('blc-color-disabled', locked);
    row.querySelectorAll('input, button').forEach((el) => {
      el.disabled = locked;
    });
  });
}

function bindColorRow(row, resetPaint) {
  const key = row.dataset.blcColor;
  if (!key || !(key in COLOR_DEFAULTS)) return;
  const picker = row.querySelector('input[type="color"]');
  const text = row.querySelector('input[type="text"]');
  const reset = row.querySelector('.blc-color-reset');
  if (!picker || !text || !reset) return;
  picker.value = settings.colors[key];
  text.value = settings.colors[key];
  if (resetPaint) copyPaint(reset, resetPaint);

  const applyHex = (hex, immediate) => {
    picker.value = hex;
    text.value = hex;
    if (settings.colors[key] === hex) return;
    settings.colors[key] = hex;
    const frame = frameDocument();
    if (frame) applyFrameSettings(frame);
    if (immediate) saveSettings();
    else scheduleSave();
  };

  picker.addEventListener('input', () => {
    const hex = normalizeHex(picker.value, false);
    if (hex) applyHex(hex, false);
  });
  // #RGB is valid, but so is the first four characters of a six-digit code. Expand short form on blur.
  text.addEventListener('input', () => {
    const hex = normalizeHex(text.value, false);
    if (hex) applyHex(hex, true);
  });
  text.addEventListener('blur', () => {
    const hex = normalizeHex(text.value, true);
    if (hex) applyHex(hex, true);
    else text.value = settings.colors[key];
  });
  reset.addEventListener('click', () => applyHex(COLOR_DEFAULTS[key], true));
}

function buildCreditChrome(el) {
  el.replaceChildren();

  const label = document.createElement('span');
  label.className = 'blc-credit-label';
  label.textContent = deps.creditText;

  const cog = document.createElement('button');
  cog.type = 'button';
  cog.id = 'blc-options-cog';
  cog.className = 'blc-options-cog';
  cog.setAttribute('aria-label', 'Options');
  cog.setAttribute('aria-expanded', 'false');
  cog.setAttribute('aria-controls', 'blc-options');
  cog.addEventListener('pointerdown', (event) => {
    event.preventDefault();
  });
  cog.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleOptions();
  });

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'blc-chat-close';
  close.setAttribute('aria-label', 'Close chat');
  close.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  close.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    deps.collapseChat();
  });

  const tools = document.createElement('div');
  tools.className = 'blc-credit-tools';
  tools.append(cog, close);
  el.append(label, tools);
  paintCog(cog);
  paintClose(close);
  ensureOptionsPanel();
}

function hideBugTip() {
  if (bugTipTimer) {
    clearTimeout(bugTipTimer);
    bugTipTimer = 0;
  }
  const tip = document.getElementById('blc-bug-tip');
  if (tip) tip.hidden = true;
  document.querySelector('#blc-options .blc-bug-report')?.removeAttribute('aria-describedby');
}

function ensureBugTip() {
  let tip = document.getElementById('blc-bug-tip');
  if (tip) return tip;
  tip = document.createElement('lol-uikit-tooltip');
  tip.id = 'blc-bug-tip';
  tip.className = 'blc-bug-tip';
  tip.setAttribute('type', 'system');
  tip.setAttribute('role', 'tooltip');
  const block = document.createElement('lol-uikit-content-block');
  block.setAttribute('type', 'tooltip-system');
  const text = document.createElement('p');
  text.textContent = BUG_TIP_TEXT;
  block.appendChild(text);
  tip.appendChild(block);
  tip.hidden = true;
  (document.body || document.documentElement).appendChild(tip);
  return tip;
}

function positionBugTip(button, tip) {
  const rect = button.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return false;
  const margin = 4;
  let pos = 'top';
  tip.setAttribute('tooltip-position', pos);
  tip.setAttribute('data-tooltip-position', pos);
  let tipW = tip.offsetWidth;
  let tipH = tip.offsetHeight;
  if (tipW < 1 || tipH < 1) return false;
  if (rect.top - tipH < margin) pos = 'bottom';
  if (pos === 'bottom') {
    tip.setAttribute('tooltip-position', pos);
    tip.setAttribute('data-tooltip-position', pos);
    tipW = tip.offsetWidth;
    tipH = tip.offsetHeight;
  }
  let left = rect.left + rect.width / 2 - tipW / 2;
  left = Math.max(margin, Math.min(left, window.innerWidth - tipW - margin));
  const top = pos === 'top' ? rect.top - tipH : rect.bottom;
  tip.style.left = `${Math.round(left)}px`;
  tip.style.top = `${Math.round(top)}px`;
  const caret = tip.shadowRoot?.querySelector('.lol-uikit-tooltip-caret');
  if (caret) {
    const delta = Math.round(rect.left + rect.width / 2 - (left + tipW / 2));
    caret.style.left = delta ? `calc(50% + ${delta}px)` : '';
  }
  return true;
}

function showBugTip(button) {
  const tip = ensureBugTip();
  tip.hidden = false;
  button.setAttribute('aria-describedby', tip.id);
  if (positionBugTip(button, tip)) return;
  requestAnimationFrame(() => {
    if (!tip.hidden) positionBugTip(button, tip);
  });
}

function scheduleBugTip(button) {
  const showing = document.getElementById('blc-bug-tip');
  if (showing && !showing.hidden && button.getAttribute('aria-describedby') === showing.id) return;
  if (bugTipTimer) {
    clearTimeout(bugTipTimer);
    bugTipTimer = 0;
  }
  bugTipTimer = setTimeout(() => {
    bugTipTimer = 0;
    const panel = document.getElementById('blc-options');
    if (!panel || panel.hidden || !panel.contains(button)) return;
    showBugTip(button);
  }, BUG_TIP_DELAY);
}

function bindBugReport(panel) {
  const button = panel.querySelector('.blc-bug-report');
  if (!button || button.dataset.blcBound) return;
  button.dataset.blcBound = '1';
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    hideBugTip();
    window.open(ISSUES_URL, '_blank', 'noopener');
  });
  button.addEventListener('pointerenter', () => scheduleBugTip(button));
  button.addEventListener('pointerleave', hideBugTip);
  button.addEventListener('focus', () => scheduleBugTip(button));
  button.addEventListener('blur', hideBugTip);
}

function ensureOptionsPanel() {
  const existing = document.getElementById('blc-options');
  if (existing?.dataset.blcChrome === chromeToken) return;
  existing?.remove();

  const template = document.createElement('template');
  template.innerHTML = panelHtml.trim();
  const panel = template.content.firstElementChild;
  if (!panel) return;
  panel.dataset.blcChrome = chromeToken;

  panel.querySelectorAll('[data-blc-toggle]').forEach(bindToggle);
  panel.querySelectorAll('input[name="blc-name-style"]').forEach(bindNameChoice);
  const resetPaint = findResetPaint();
  panel.querySelectorAll('.blc-color-row').forEach((row) => bindColorRow(row, resetPaint));
  syncMessageColorLock(panel);

  panel.addEventListener('pointerdown', (event) => {
    const field = event.target?.closest?.('input[type="text"], input[type="color"], textarea, .blc-bug-report');
    if (field) return;
    event.preventDefault();
  });
  bindBugReport(panel);
  (document.body || document.documentElement).appendChild(panel);

  const disclaimer = panel.querySelector('.blc-options-disclaimer');
  mountUpdateStatus(disclaimer, deps.version);
}

function retargetScrollSelector(selector) {
  if (!/scrollbar/i.test(selector)) return null;
  if (/\.messages\b/.test(selector)) return selector.replace(/\.messages\b/g, '.blc-options-body');
  if (/^(html|body|\*)?::-webkit-scrollbar/i.test(selector)) {
    return selector.replace(/^(html|body|\*)?/, '.blc-options-body');
  }
  return null;
}

function collectScrollRules(rules, out) {
  for (const rule of rules) {
    if (rule.cssRules) {
      collectScrollRules(rule.cssRules, out);
      continue;
    }
    if (!rule.selectorText || !rule.style) continue;
    const parts = [];
    let fromMessages = false;
    for (const part of rule.selectorText.split(',')) {
      const trimmed = part.trim();
      const next = retargetScrollSelector(trimmed);
      if (!next) continue;
      if (/\.messages\b/.test(trimmed)) fromMessages = true;
      parts.push(next);
    }
    if (!parts.length || !rule.style.cssText) continue;
    out.push({ text: `${parts.join(', ')} { ${rule.style.cssText} }`, fromMessages });
  }
}

export function syncOptionsScrollbar(frameDoc) {
  const messages = frameDoc.querySelector?.('.messages');
  const body = document.querySelector('#blc-options .blc-options-body');
  if (messages && body) {
    const cs = frameDoc.defaultView?.getComputedStyle(messages);
    if (cs?.scrollbarColor && cs.scrollbarColor !== 'auto') body.style.scrollbarColor = cs.scrollbarColor;
    if (cs?.scrollbarWidth && cs.scrollbarWidth !== 'auto') body.style.scrollbarWidth = cs.scrollbarWidth;
  }

  const found = [];
  for (const sheet of frameDoc.styleSheets || []) {
    try {
      if (sheet.cssRules) collectScrollRules(sheet.cssRules, found);
    } catch {
      /* unreadable stylesheet */
    }
  }
  const fromMessages = found.filter((rule) => rule.fromMessages);
  const rules = fromMessages.length ? fromMessages : found;
  if (!rules.length) return;
  const css = rules.map((rule) => rule.text).join('\n');
  let style = document.getElementById('blc-options-scrollbar');
  if (!style) {
    style = document.createElement('style');
    style.id = 'blc-options-scrollbar';
    (document.head || document.documentElement).appendChild(style);
  }
  if (style.textContent !== css) style.textContent = css;
}

export function optionsAreOpen() {
  const panel = document.getElementById('blc-options');
  return !!panel && !panel.hidden;
}

export function attachCreditChrome(el) {
  if (el.dataset.blcChrome !== chromeToken) {
    buildCreditChrome(el);
    el.dataset.blcChrome = chromeToken;
  } else {
    paintCog(el.querySelector('.blc-options-cog'));
    paintClose(el.querySelector('.blc-chat-close'));
  }
}

export function hookFrameOptions(doc) {
  if (!doc) return;
  hookOptionsDismiss(doc);
}
