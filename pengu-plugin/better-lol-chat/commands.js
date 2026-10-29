/**
 * Dev sample for the post-game messages iframe.
 * Console: window.__blcInjectSampleMessages()
 * Chat: /sample or /demo, then Enter. The line is not sent.
 * Chat: /clear removes the message rows. The line is not sent.
 * Chat: /dialog shows the update dialog with sample release notes.
 * Chat: /notice shows the remote notice that would be due (ignores the game gap).
 */

import { previewUpdateDialog } from './update.js';
import { previewNotice } from './notice.js';
import { followLatest } from './scroll.js';

const SAMPLE = 'blc-sample';
const CELEBRATION =
  'Everyone on your team honored a teammate! You got a little extra Honor progress this game.';

/** @type {Array<['mine' | 'my-team' | 'other-team', number, string]>} */
const LINES = [
  ['mine', 0, 'gg'],
  ['other-team', 0, 'gg'],
  ['my-team', 0, 'that baron fight was clean'],
  ['other-team', 1, 'we threw at elder'],
  ['my-team', 1, 'wards won that'],
  ['mine', 0, 'wp bot'],
  ['my-team', 2, 'ty for the ganks'],
  ['other-team', 2, 'jungle diff honestly'],
  ['my-team', 3, 'you were everywhere'],
  ['other-team', 3, 'top was unplayable'],
  ['mine', 0, 'close game though'],
  ['other-team', 4, 'supp gap too'],
  ['my-team', 1, 'roams were free'],
  ['other-team', 0, 'mid was even until 20'],
  ['my-team', 0, 'you scaled well'],
  ['mine', 0, 'nexus was spicy'],
  ['other-team', 1, 'one more auto and we win'],
  ['my-team', 2, 'flash was down'],
  ['other-team', 2, 'should have smited'],
  ['my-team', 3, 'next time we start drag earlier'],
  ['mine', 0, 'yeah that timing was late'],
  ['other-team', 3, 'gg go next'],
  ['my-team', 0, 'fun game'],
  ['other-team', 4, 'wp everyone'],
  ['my-team', 1, 'see you in queue'],
  ['mine', 0, 'gl next'],
  ['other-team', 0, 'you too'],
  ['my-team', 2, 'that fight at red was nuts'],
  ['other-team', 1, 'still thinking about the steal'],
  ['my-team', 3, 'gg wp'],
];

export function clearChatMessages() {
  const frame = document.querySelector(
    'lol-social-chat-room[type="postGame"] iframe#embedded-messages-frame, lol-social-chat-room[type="postGame"] iframe',
  );
  const live = frame?.contentDocument || frame?.contentWindow?.document;
  live?.querySelectorAll('.messages .message-box:not(.blc-injected)').forEach((el) => el.remove());
}

export function clearSampleMessages() {
  const frame = document.querySelector(
    'lol-social-chat-room[type="postGame"] iframe#embedded-messages-frame, lol-social-chat-room[type="postGame"] iframe',
  );
  const live = frame?.contentDocument || frame?.contentWindow?.document;
  live?.querySelectorAll(`.${SAMPLE}`).forEach((el) => el.remove());
  console.log('[BLC SAMPLE] cleared');
}

export async function injectSampleMessages() {
  const players = readScoreboard();
  const filled = players.mine.length + players['my-team'].length + players['other-team'].length;
  if (!filled) {
    console.warn('[BLC SAMPLE] no scoreboard rows — open the Scoreboard tab first');
    return;
  }

  await loadIcons(players);

  const room = document.querySelector('lol-social-chat-room[type="postGame"]');
  if (!room) {
    console.warn('[BLC SAMPLE] no postGame chat room — open the post-game screen first');
    return;
  }

  const iframe = room.querySelector('iframe#embedded-messages-frame, iframe');
  const doc = iframe?.contentDocument || iframe?.contentWindow?.document;
  if (!doc?.body) {
    console.warn('[BLC SAMPLE] cannot read the messages iframe — open chat first');
    return;
  }

  // Font, padding, and one-row-per-line live on .messages.
  // An expired session still has .messages.disconnected and the frame stylesheet.
  // body is a wrapping flex row, so appending there runs messages together.
  const parent = doc.querySelector('.messages') || ensureMessages(doc);

  doc.querySelectorAll(`.${SAMPLE}`).forEach((el) => el.remove());
  const seeded = seedRoster(players);

  const inserted = [];
  const sample = ['mine', 'my-team', 'other-team']
    .flatMap((team) => players[team].map((player) => ({ team, player })))
    .find((entry) => entry.player.summoner);
  if (sample) {
    const row = makeSystem(doc, sample.team, `${sample.player.summoner} joined the lobby`);
    parent.appendChild(row);
    inserted.push(row);
  }

  const skipped = { mine: 0, 'my-team': 0, 'other-team': 0 };
  for (const [team, speaker, body] of LINES) {
    const group = players[team].filter((player) => player.summoner);
    if (!group.length) {
      skipped[team] += 1;
      continue;
    }
    const row = makeChat(doc, team, group[speaker % group.length], body);
    parent.appendChild(row);
    inserted.push(row);
  }

  if (sample) {
    const row = makeSystem(doc, sample.team, `${sample.player.summoner} left the lobby`);
    parent.appendChild(row);
    inserted.push(row);
  }

  const celebration = makeSystem(doc, 'other-team', CELEBRATION, 'celebration');
  parent.appendChild(celebration);
  inserted.push(celebration);

  followLatest(doc);

  const counts = inserted.reduce((acc, row) => {
    const team = row.classList.contains('mine')
      ? 'mine'
      : row.classList.contains('other-team')
        ? 'other-team'
        : 'my-team';
    acc[team] = (acc[team] || 0) + 1;
    return acc;
  }, {});

  console.log(
    `%c[BLC SAMPLE] inserted ${inserted.length} messages`,
    'font-weight:bold;color:#c89b3c',
    counts,
    {
      you: players.mine.map(describe),
      allies: players['my-team'].map(describe),
      enemies: players['other-team'].map(describe),
      skipped,
      seeded,
    },
  );
  console.log('[BLC SAMPLE] clear with: window.__blcClearSampleMessages()');
  return inserted;
}

function readScoreboard() {
  const groups = { mine: [], 'my-team': [], 'other-team': [] };
  const seen = new Set();
  const rows = document.querySelectorAll(
    '.scoreboard-row-component, .strawberry-scoreboard-row-component, .jade-scoreboard-row-component',
  );
  for (const row of rows) {
    const summoner = clean(
      row.querySelector('.player-name__game-name')?.textContent ||
        row.querySelector(
          '.scoreboard-row-player-name, .strawberry-scoreboard-row-player-name, .jade-scoreboard-row-player-name',
        )?.textContent,
    );
    const champion = clean(
      row.querySelector(
        '.scoreboard-row-champ-name, .strawberry-scoreboard-row-champ-name, .jade-scoreboard-row-champ-name',
      )?.textContent,
    );
    if (!summoner && !champion) continue;
    const team = row.classList.contains('is-local-player')
      ? 'mine'
      : row.classList.contains('is-ally')
        ? 'my-team'
        : 'other-team';
    const key = `${team}\0${summoner}\0${champion}`;
    if (seen.has(key)) continue;
    seen.add(key);
    groups[team].push({ summoner, champion });
  }
  return groups;
}

function clean(value) {
  return String(value || '')
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function describe(player) {
  if (player.summoner && player.champion) return `${player.summoner} (${player.champion})`;
  return player.summoner || player.champion;
}

async function loadIcons(groups) {
  let champs = [];
  try {
    const res = await fetch('/lol-game-data/assets/v1/champion-summary.json');
    if (res.ok) champs = await res.json();
  } catch {
    /* an already-mapped game still has icons on the plugin roster */
  }
  const byName = new Map();
  for (const champ of champs || []) {
    if (!champ?.name) continue;
    const path =
      champ.squarePortraitPath ||
      (champ.id != null ? `/lol-game-data/assets/v1/champion-icons/${champ.id}.png` : '');
    if (path) byName.set(String(champ.name).toLowerCase(), path);
  }
  for (const group of Object.values(groups)) {
    for (const player of group) {
      player.iconPath = byName.get(String(player.champion || '').toLowerCase()) || '';
    }
  }
}

function seedRoster(groups) {
  const entries = [];
  for (const team of ['mine', 'my-team', 'other-team']) {
    for (const player of groups[team]) {
      if (!player.summoner) continue;
      entries.push({
        summoner: player.summoner,
        champion: player.champion,
        iconPath: player.iconPath || '',
        ally: team !== 'other-team',
      });
    }
  }
  if (typeof window.__blcSeedRoster !== 'function') {
    console.warn('[BLC SAMPLE] reload the plugin once so these players can be mapped');
    return 0;
  }
  return window.__blcSeedRoster(entries) || 0;
}

function ensureMessages(root) {
  const list = root.createElement('div');
  list.className = 'messages';
  list.setAttribute('lang', 'en-US');
  root.body.appendChild(list);
  return list;
}

function makeChat(root, teamClass, player, body) {
  const box = root.createElement('div');
  box.className = `message-box ${teamClass} ${SAMPLE}`;

  const chat = root.createElement('div');
  chat.className = 'chat-message';

  const name = root.createElement('div');
  name.className = 'message-name';
  name.textContent = player.summoner || player.champion;

  const colon = root.createElement('span');
  colon.className = 'message';
  colon.textContent = ':';

  const message = root.createElement('span');
  message.className = 'message';
  message.textContent = body;

  chat.append(name, root.createTextNode(' '), colon, root.createTextNode(' '), message);
  box.appendChild(chat);
  return box;
}

function makeSystem(root, teamClass, text, spanClass) {
  const box = root.createElement('div');
  box.className = `message-box ${teamClass} ${SAMPLE}`;
  const sys = root.createElement('div');
  sys.className = 'system-message';
  const span = root.createElement('span');
  if (spanClass) span.className = spanClass;
  span.textContent = text;
  sys.appendChild(span);
  box.appendChild(sys);
  return box;
}

const CHAT_COMMANDS = new Map([
  ['/sample', injectSampleMessages],
  ['/demo', injectSampleMessages],
  ['/clear', clearChatMessages],
  ['/dialog', previewUpdateDialog],
  ['/notice', previewNotice],
]);
let swallowSampleEnter = false;

window.__blcInjectSampleMessages = injectSampleMessages;
window.__blcClearSampleMessages = clearSampleMessages;

export function installSampleCommands({ collapsed, findRoom }) {
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Enter' || collapsed()) return;
      runSampleCommand(event, findRoom());
    },
    true,
  );
  document.addEventListener('keyup', onSampleCommandKeyUp, true);
}

function runSampleCommand(event, room) {
  if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
  const field = event.target?.closest?.('textarea.chat-input, textarea');
  if (!room || !field || !room.contains(field)) return;
  const command = CHAT_COMMANDS.get(field.value.trim().toLowerCase());
  if (!command) return;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  swallowSampleEnter = true;

  field.value = '';
  const sizer = field.parentElement?.querySelector('.input-sizer span');
  if (sizer) sizer.textContent = '';
  field.dispatchEvent(new Event('input', { bubbles: true }));

  command();
}

function onSampleCommandKeyUp(event) {
  if (!swallowSampleEnter || event.key !== 'Enter') return;
  swallowSampleEnter = false;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
}
