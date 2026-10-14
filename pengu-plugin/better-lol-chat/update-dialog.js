import './update-dialog.css';
import dialogHtml from './update-dialog.html?raw';

const DIALOG_ID = 'blc-update-dialog';
const EMPTY_NOTES = 'No release notes were published for this version.';
const WHATS_NEW = /^(?:#{1,6}\s*)?(?:\*\*|__)?what'?s new(?:\*\*|__)?$/i;
const CHANGELOG = /(?:\r?\n)*\*{0,2}Full Changelog\*{0,2}\s*:\s*\S+\s*$/i;

let active = null;
let viewGen = 0;

function ensureDialog() {
  const existing = document.getElementById(DIALOG_ID);
  if (existing) return existing;
  const template = document.createElement('template');
  template.innerHTML = dialogHtml.trim();
  const root = template.content.firstElementChild;
  root.addEventListener('click', onDialogClick);
  (document.body || document.documentElement).appendChild(root);
  return root;
}

function setText(root, key, text) {
  const el = root.querySelector(`[data-blc-text="${key}"]`);
  if (el) el.textContent = text;
}

function fillNotes(root, raw) {
  const heading = root.querySelector('[data-blc-notes="heading"]');
  const body = root.querySelector('[data-blc-notes="body"]');
  const text = String(raw || '').trim().replace(CHANGELOG, '').trim() || EMPTY_NOTES;
  const lines = text.split(/\r?\n/);
  const isHeading = WHATS_NEW.test(lines[0].trim());
  if (heading) {
    heading.hidden = !isHeading;
    heading.textContent = isHeading ? "What's new" : '';
  }
  if (body) body.textContent = (isHeading ? lines.slice(1).join('\n') : text).trim();
}

function setView(root, view) {
  root.querySelector('.blc-dialog-actions')?.classList.remove('is-leaving');
  for (const el of root.querySelectorAll('[data-blc-view]')) {
    el.hidden = el.dataset.blcView !== view;
  }
}

function showInstallStep(root) {
  const gen = viewGen;
  const actions = root.querySelector('.blc-dialog-actions');
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (!actions || actions.hidden || reduce) {
    setView(root, 'done');
    return;
  }
  actions.classList.add('is-leaving');
  let settled = false;
  const finish = () => {
    if (settled || gen !== viewGen) return;
    settled = true;
    setView(root, 'done');
  };
  actions.addEventListener('transitionend', (event) => {
    if (event.target === actions && event.propertyName === 'opacity') finish();
  });
  window.setTimeout(finish, 240);
}

export function updateDialogIsOpen() {
  const root = document.getElementById(DIALOG_ID);
  return !!root && !root.hidden;
}

function scoreboardScreen() {
  const nodes = document.querySelectorAll('.rcp-fe-viewport-main .screen-root, .screen-root');
  for (const el of nodes) {
    const rect = el.getBoundingClientRect();
    if (rect.width > 1 && rect.height > 1) return el;
  }
  return null;
}

function placeDialog(root) {
  const frame = root.querySelector('.dialog-frame');
  const screen = scoreboardScreen();
  if (!frame || !screen) return;
  const rect = screen.getBoundingClientRect();
  frame.style.left = `${Math.round(rect.left + rect.width / 2)}px`;
  frame.style.top = `${Math.round(rect.top + rect.height / 2)}px`;
}

export function closeUpdateDialog() {
  viewGen += 1;
  const root = document.getElementById(DIALOG_ID);
  if (root) root.hidden = true;
  active = null;
}

window.addEventListener('resize', () => {
  const root = document.getElementById(DIALOG_ID);
  if (root && !root.hidden) placeDialog(root);
});

/**
 * options: { version, notes, downloadUrl, installerName, releaseUrl, onSkip }
 * An empty downloadUrl with an installerName is a preview: Download Now still advances
 * to the install step and does not open a URL.
 */
export function showUpdateDialog(options) {
  viewGen += 1;
  const root = ensureDialog();
  active = options;
  const version = String(options.version || '').replace(/^v/i, '');
  setText(root, 'subtitle', version ? `better-lol-chat v${version} is ready to install.` : 'An update is ready to install.');
  setText(root, 'installer', options.installerName || 'the installer');
  fillNotes(root, options.notes);
  setView(root, 'notes');
  root.hidden = false;
  placeDialog(root);
  syncNotesMask(root.querySelector('.blc-dialog-notes'));
}

// The scrollable defaults to a bottom fade and only updates on scroll. Short notes never scroll,
// so mark both ends reached when the text fits. Same 1px buffer the component uses.
function syncNotesMask(scroller) {
  if (!scroller) return;
  scroller.scrollTop = 0;
  const buffer = Number(scroller.getAttribute('buffer')) || 1;
  const atBottom = scroller.offsetHeight + buffer >= scroller.scrollHeight;
  scroller.setAttribute('scrolled-top', 'true');
  scroller.setAttribute('scrolled-bottom', String(atBottom));
}

function openExternal(url) {
  if (url) window.open(url, '_blank', 'noopener');
}

function onDialogClick(event) {
  const root = event.currentTarget;
  const action = event.target?.closest?.('[data-blc-action]')?.dataset.blcAction;
  if (!action) {
    if (clickedCloseButton(event, root)) closeUpdateDialog();
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  const current = active;
  if (!current) return;
  if (action === 'download') {
    if (current.downloadUrl) {
      openExternal(current.downloadUrl);
      showInstallStep(root);
    } else if (current.installerName) {
      showInstallStep(root);
    } else {
      openExternal(current.releaseUrl);
    }
  } else if (action === 'release') {
    openExternal(current.releaseUrl);
  } else if (action === 'skip') {
    closeUpdateDialog();
    current.onSkip?.();
  }
}

// The frame itself is classed dismissable-close-button, so any "close" substring matches the whole dialog.
function clickedCloseButton(event, root) {
  for (const node of event.composedPath()) {
    if (node === root) return false;
    if (node?.tagName === 'LOL-UIKIT-CLOSE-BUTTON') return true;
    const cls = node?.className;
    const name = typeof cls === 'string' ? cls : cls?.baseVal || '';
    if (/(?:^|\s)lol-uikit-dialog-frame-(?:toast-)?close-button(?:\s|$)/i.test(name)) return true;
  }
  return false;
}
