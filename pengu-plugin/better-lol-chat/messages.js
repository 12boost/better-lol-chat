import { settings, showsSummoner, showsChampion } from './settings.js';
import { aliases, players } from './roster.js';

function normalizeLobbyText(text) {
  return stripBidi(text).replace(/\s+/g, ' ').trim();
}

export function stripBidi(s) {
  return String(s || '').replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '');
}

function riotIdParts(value) {
  const trimmed = stripBidi(value).trim();
  const hash = trimmed.indexOf('#');
  if (hash === -1) return { name: trimmed.toLowerCase(), tag: '' };
  return {
    name: trimmed.slice(0, hash).trim().toLowerCase(),
    tag: trimmed.slice(hash + 1).trim().toLowerCase(),
  };
}

export function matchAlias(text) {
  const trimmed = stripBidi(text).trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  for (const entry of aliases()) {
    if (entry.name.toLowerCase() === lower) return entry;
  }
  const query = riotIdParts(trimmed);
  if (!query.name) return null;
  for (const entry of aliases()) {
    const alias = riotIdParts(entry.name);
    if (!alias.name || alias.name !== query.name) continue;
    if (query.tag && alias.tag && query.tag !== alias.tag) continue;
    return entry;
  }
  return null;
}

function gameNameKey(alias) {
  const hash = alias.indexOf('#');
  return (hash === -1 ? alias : alias.slice(0, hash)).trim().toLowerCase();
}

function aliasForms(alias) {
  const trimmed = String(alias || '').trim();
  if (!trimmed) return [];
  const forms = [trimmed];
  const hash = trimmed.indexOf('#');
  if (hash <= 0) return forms;
  const name = trimmed.slice(0, hash).trim();
  const tag = trimmed.slice(hash + 1).trim();
  if (!name || !tag) return forms;
  const spaced = `${name} #${tag}`;
  if (spaced.toLowerCase() !== trimmed.toLowerCase()) forms.push(spaced);
  return forms;
}

function sharedGameNames() {
  const counts = new Map();
  for (const player of players()) {
    const seen = new Set();
    for (const alias of player.aliases || []) {
      const key = gameNameKey(alias);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  const shared = new Set();
  for (const [key, count] of counts) {
    if (count > 1) shared.add(key);
  }
  return shared;
}

function isNameChar(ch) {
  return !!ch && /[\p{L}\p{N}]/u.test(ch);
}

function foldedIndex(hay, needle) {
  const h = hay.toLowerCase();
  const n = needle.toLowerCase();
  if (!n || h.length !== hay.length || n.length !== needle.length) return -1;
  let from = 0;
  while (from <= h.length - n.length) {
    const at = h.indexOf(n, from);
    if (at < 0) return -1;
    const before = at > 0 ? h[at - 1] : '';
    const after = at + n.length < h.length ? h[at + n.length] : '';
    if (!isNameChar(before) && !isNameChar(after)) return at;
    from = at + 1;
  }
  return -1;
}

// Longest Riot ID inside a system sentence. The rendered form has a space
// before #. A bare game name is skipped when two players share it.
function findPlayerMention(text) {
  const normalized = normalizeLobbyText(text);
  if (!normalized) return null;
  const shared = sharedGameNames();
  let best = null;
  for (const player of players()) {
    for (const alias of player.aliases || []) {
      for (const form of aliasForms(alias)) {
        if (!form.includes('#') && shared.has(gameNameKey(form))) continue;
        const start = foldedIndex(normalized, form);
        if (start < 0) continue;
        if (best && form.length <= best.form.length) continue;
        best = {
          player,
          start,
          end: start + form.length,
          form: normalized.slice(start, start + form.length),
          normalized,
        };
      }
    }
  }
  return best;
}

function summonerLabel(originalText) {
  return stripBidi(originalText).replace(/\s+/g, ' ').trim();
}

function iconPart(player) {
  return settings.showChatIcons && player?.iconPath ? { icon: player.iconPath } : null;
}

function partsMatch(el, parts) {
  const nodes = [...el.childNodes];
  if (nodes.length !== parts.length) return false;
  for (let i = 0; i < parts.length; i++) {
    const node = nodes[i];
    const part = parts[i];
    if (part.icon) {
      if (node.nodeType !== 1 || !node.classList.contains('blc-champ-icon')) return false;
      if (node.dataset.blcSrc !== part.icon) return false;
      continue;
    }
    if (part.parts) {
      if (node.nodeType !== 1 || !node.classList.contains(part.className)) return false;
      if (!partsMatch(node, part.parts)) return false;
      continue;
    }
    if (part.className) {
      if (node.nodeType !== 1 || !node.classList.contains(part.className)) return false;
      if (node.textContent !== part.text) return false;
      continue;
    }
    if (node.nodeType !== 3 || node.textContent !== part.text) return false;
  }
  return true;
}

function renderParts(doc, parts) {
  return parts.map((part) => {
    if (part.icon) {
      const img = doc.createElement('img');
      img.className = 'blc-champ-icon';
      img.alt = '';
      img.draggable = false;
      img.dataset.blcSrc = part.icon;
      img.src = part.icon;
      return img;
    }
    if (part.parts) {
      const span = doc.createElement('span');
      span.className = part.className;
      span.replaceChildren(...renderParts(doc, part.parts));
      return span;
    }
    if (part.className) {
      const span = doc.createElement('span');
      span.className = part.className;
      span.textContent = part.text;
      return span;
    }
    return doc.createTextNode(part.text);
  });
}

function paintParts(el, parts) {
  if (partsMatch(el, parts)) return;
  el.replaceChildren(...renderParts(el.ownerDocument, parts));
}

function textPart(text, className) {
  return className ? { className, text } : { text };
}

function nameParts(text, player, nameClass) {
  if (!showsChampion() || !player?.championName) return [textPart(text)];
  if (!showsSummoner()) return [textPart(player.championName, nameClass)];
  return [
    textPart(summonerLabel(text), nameClass),
    textPart(`(${player.championName})`, 'blc-secondary-name'),
  ];
}

function withIcon(icon, parts, wrapClass) {
  if (!icon) return parts;
  if (!wrapClass) return [icon, ...parts];
  return [{ className: wrapClass, parts: [icon, ...parts] }];
}

function paintChatName(el, original, player) {
  paintParts(el, withIcon(iconPart(player), nameParts(original, player)));
}

function rewriteNames(root) {
  const nameNodes = root.querySelectorAll?.('.message-box .message-name') || [];
  for (const el of nameNodes) {
    if (el.closest?.('.blc-injected')) continue;
    if (el.closest?.('.system-message')) continue;
    let original = el.dataset.blcOriginal;
    let player = null;
    if (original != null) {
      player = resolvePlayer(stripBidi(original).trim());
    } else if (aliases().length) {
      const match = matchAlias(stripBidi(el.textContent || '').trim());
      if (!match) continue;
      original = el.textContent;
      el.dataset.blcOriginal = original;
      player = match.player;
    } else {
      continue;
    }
    paintChatName(el, original, player);
  }
}

function fixTeamClasses(root) {
  if (!players().length && !aliases().length) return;

  const boxes = root.querySelectorAll?.('.message-box') || [];
  for (const box of boxes) {
    if (box.classList.contains('mine')) continue;
    if (box.classList.contains('blc-injected')) continue;
    if (box.querySelector?.('.celebration')) continue;

    const player = speakerForBox(box);
    if (!player) continue;

    const want = player.ally ? 'my-team' : 'other-team';
    const drop = player.ally ? 'other-team' : 'my-team';
    if (box.classList.contains(want) && !box.classList.contains(drop)) continue;
    box.classList.remove(drop);
    box.classList.add(want);
  }
}

function speakerForBox(box) {
  const nameEl = box.querySelector?.('.chat-message .message-name');
  if (nameEl) {
    const source = nameEl.dataset.blcOriginal ?? nameEl.textContent;
    return resolvePlayer(stripBidi(source || '').trim());
  }

  const span = box.querySelector?.('.system-message span');
  if (!span || span.classList.contains('celebration')) return null;

  const source = span.dataset?.blcOriginal ?? span.textContent ?? '';
  const mention = findPlayerMention(source);
  if (mention?.player) return mention.player;

  const champEl = span.querySelector?.('.blc-system-name');
  if (champEl) {
    const fromChamp = resolvePlayer(stripBidi(champEl.textContent || '').trim());
    if (fromChamp) return fromChamp;
  }
  return null;
}

function resolvePlayer(text) {
  const trimmed = stripBidi(text).trim();
  if (!trimmed) return null;

  const byAlias = matchAlias(trimmed);
  if (byAlias) return byAlias.player;

  const lower = trimmed.toLowerCase();
  let hit = null;
  for (const player of players()) {
    if (!player.championName || player.championName.toLowerCase() !== lower) continue;
    if (hit && hit !== player) return null;
    hit = player;
  }
  return hit;
}

function paintLeaveLine(span, player, mention) {
  const split = Boolean(showsChampion() && player?.championName && mention && mention.end > mention.start);
  if (!split) {
    const whole = mention?.normalized || normalizeLobbyText(span.dataset.blcOriginal || span.textContent || '');
    paintParts(span, withIcon(iconPart(player), nameParts(whole, player)));
    return;
  }
  const name = mention.normalized.slice(mention.start, mention.end);
  const before = mention.normalized.slice(0, mention.start);
  const after = mention.normalized.slice(mention.end);
  const parts = [];
  if (before) parts.push(textPart(before));
  parts.push(
    ...withIcon(iconPart(player), nameParts(name, player, 'blc-system-name'), 'blc-leave-label'),
  );
  if (after) parts.push(textPart(after));
  paintParts(span, parts);
}

// A player joins once, then may leave. The first system line with their Riot ID
// is the join. The next is the leave. Sample rows are counted apart from live
// rows so a demo pair does not take the live leave slot.
function rewriteLobbyMessages(root) {
  const spans = root.querySelectorAll?.('.system-message span') || [];
  const liveCount = new Map();
  const sampleCount = new Map();
  for (const span of spans) {
    if (
      span.classList.contains('blc-system-name') ||
      span.classList.contains('blc-secondary-name') ||
      span.classList.contains('blc-leave-label') ||
      span.classList.contains('celebration')
    ) {
      continue;
    }
    if (span.closest?.('.blc-injected') || span.closest?.('.celebration')) continue;

    const box = span.closest('.message-box');
    const source = span.dataset.blcOriginal ?? span.textContent ?? '';
    const mention = findPlayerMention(source);
    if (!mention?.player) continue;

    const counts = box?.classList.contains('blc-sample') ? sampleCount : liveCount;
    const n = counts.get(mention.player) || 0;
    counts.set(mention.player, n + 1);
    if (n === 0) {
      box?.classList.add('blc-hide-join');
      continue;
    }
    if (n !== 1) continue;

    if (span.dataset.blcOriginal == null) span.dataset.blcOriginal = span.textContent ?? '';
    box?.classList.remove('blc-hide-join');
    paintLeaveLine(span, mention.player, mention);
  }
}

export function rewriteMessages(root) {
  rewriteNames(root);
  rewriteLobbyMessages(root);
  // Stored Riot IDs (data-blc-original) still match after the visible text
  // becomes a champion name. groupchat rows often ship with fromSummonerId 0,
  // so the client marks allies as other-team.
  fixTeamClasses(root);
}
