const SETTINGS_KEY = 'blc-settings';

export const COLOR_DEFAULTS = {
  nameAlly: '#16cae5',
  nameEnemy: '#ff1a3e',
  nameMine: '#fabe0a',
  messageAlly: '#a1deed',
  messageEnemy: '#e7c1c8',
  messageMine: '#bfb9a5',
};

const COLOR_VARS = {
  nameAlly: '--blc-name-ally',
  nameEnemy: '--blc-name-enemy',
  nameMine: '--blc-name-mine',
  messageAlly: '--blc-message-ally',
  messageEnemy: '--blc-message-enemy',
  messageMine: '--blc-message-mine',
};

const TOGGLE_KEYS = ['tallerChat', 'showMidRow', 'strongDim', 'autoOpen', 'stickyChat', 'pauseScroll', 'showChatIcons'];

export function normalizeHex(value, allowShort) {
  const match = String(value || '').trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return null;
  let hex = match[1].toLowerCase();
  if (hex.length === 3) {
    if (!allowShort) return null;
    hex = hex.split('').map((ch) => ch + ch).join('');
  }
  return `#${hex}`;
}

function nameStyleFrom(showSummoner, showChampion) {
  if (showSummoner && showChampion) return 'both';
  if (showSummoner) return 'summoner';
  return 'champion';
}

function emptyNoticeState() {
  return {
    gamesSince: 0,
    priorityActive: false,
    shown: {},
  };
}

function mergeNoticeState(saved) {
  const next = emptyNoticeState();
  if (Number.isFinite(Number(saved.gamesSince))) {
    next.gamesSince = Math.max(0, Math.floor(Number(saved.gamesSince)));
  }
  if (typeof saved.priorityActive === 'boolean') next.priorityActive = saved.priorityActive;
  if (saved.shown && typeof saved.shown === 'object') {
    for (const [id, entry] of Object.entries(saved.shown)) {
      if (!/^[\w.-]{1,64}$/.test(id) || !entry || typeof entry !== 'object') continue;
      const gamesSince = Number(entry.gamesSince);
      const message = Number(entry.message);
      next.shown[id] = {
        gamesSince: Number.isFinite(gamesSince) ? Math.max(0, Math.floor(gamesSince)) : 0,
        message: Number.isFinite(message) ? Math.max(0, Math.floor(message)) : 0,
      };
    }
  }
  return next;
}

function loadSettings() {
  const next = {
    tallerChat: true,
    showMidRow: true,
    nameStyle: 'summoner',
    showChatIcons: true,
    coloredBodies: true,
    strongDim: true,
    autoOpen: true,
    stickyChat: true,
    pauseScroll: true,
    skippedUpdate: '',
    notice: emptyNoticeState(),
    colors: { ...COLOR_DEFAULTS },
  };
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
    if (!saved || typeof saved !== 'object') return next;
    if (typeof saved.skippedUpdate === 'string') next.skippedUpdate = saved.skippedUpdate;
    if (saved.notice && typeof saved.notice === 'object') {
      next.notice = mergeNoticeState(saved.notice);
    }
    for (const key of TOGGLE_KEYS) {
      if (typeof saved[key] === 'boolean') next[key] = saved[key];
    }
    if (typeof saved.coloredBodies === 'boolean') next.coloredBodies = saved.coloredBodies;
    if (saved.nameStyle === 'summoner' || saved.nameStyle === 'champion' || saved.nameStyle === 'both') {
      next.nameStyle = saved.nameStyle;
    } else if (
      typeof saved.showSummonerNames === 'boolean' ||
      typeof saved.showChampionNames === 'boolean' ||
      typeof saved.championNames === 'boolean'
    ) {
      let showSummoner = false;
      let showChampion = true;
      if (typeof saved.showSummonerNames === 'boolean') showSummoner = saved.showSummonerNames;
      else if (typeof saved.championNames === 'boolean') showSummoner = !saved.championNames;
      if (typeof saved.showChampionNames === 'boolean') showChampion = saved.showChampionNames;
      else if (typeof saved.championNames === 'boolean') showChampion = saved.championNames;
      if (!showSummoner && !showChampion) showChampion = true;
      next.nameStyle = nameStyleFrom(showSummoner, showChampion);
    }
    if (saved.colors && typeof saved.colors === 'object') {
      for (const key of Object.keys(COLOR_DEFAULTS)) {
        const hex = normalizeHex(saved.colors[key], true);
        if (hex) next.colors[key] = hex;
      }
    }
  } catch {
    /* ignore broken storage */
  }
  return next;
}

export const settings = loadSettings();

export function showsSummoner() {
  return settings.nameStyle === 'summoner' || settings.nameStyle === 'both';
}

export function showsChampion() {
  return settings.nameStyle === 'champion' || settings.nameStyle === 'both';
}

export function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* ignore quota / private mode */
  }
}

let saveTimer = 0;
export function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = 0;
    saveSettings();
  }, 200);
}

export function applyHostSettings() {
  document.documentElement?.classList.toggle('blc-strong-dim', settings.strongDim);
}

export function applyFrameSettings(doc) {
  if (!doc?.documentElement) return;
  doc.documentElement.classList.toggle('blc-tint-bodies', settings.coloredBodies);
  doc.documentElement.classList.toggle('blc-chat-icons', settings.showChatIcons);
  for (const [key, varName] of Object.entries(COLOR_VARS)) {
    doc.documentElement.style.setProperty(varName, settings.colors[key]);
  }
}

applyHostSettings();
