const LOG = '[better-lol-chat]';

const byPuuid = new Map();
const bySummonerId = new Map();
let nameIndex = [];
let roster = [];
let seedEntries = [];
let conversationId = null;

export function players() {
  return roster;
}

export function aliases() {
  return nameIndex;
}

export function clearRoster() {
  byPuuid.clear();
  bySummonerId.clear();
  nameIndex = [];
  roster = [];
  seedEntries = [];
  conversationId = null;
}

// Dev hook for util/inject-sample-messages.js. Scoreboard players stay mapped
// across a later identity refresh so injected rows keep restyling.
export function seedRoster(entries) {
  if (!Array.isArray(entries)) return 0;
  for (const entry of entries) {
    const summoner = String(entry?.summoner || '').trim();
    if (!summoner) continue;
    const key = summoner.toLowerCase();
    if (seedEntries.some((saved) => saved.summoner.toLowerCase() === key)) continue;
    seedEntries.push({
      summoner,
      championName: String(entry?.champion || '').trim(),
      iconPath: String(entry?.iconPath || ''),
      ally: entry?.ally === true,
    });
  }
  return applySeeds();
}

function applySeeds() {
  let added = 0;
  for (const entry of seedEntries) {
    const existing = playerForAlias(entry.summoner);
    if (existing) {
      if (!existing.iconPath && entry.iconPath) existing.iconPath = entry.iconPath;
      if ((!existing.championName || existing.championName === 'Unknown') && entry.championName) {
        existing.championName = entry.championName;
      }
      continue;
    }
    const player = {
      puuid: null,
      summonerId: null,
      teamId: null,
      championName: entry.championName || 'Unknown',
      iconPath: entry.iconPath,
      ally: entry.ally,
      aliases: [entry.summoner],
    };
    roster.push(player);
    nameIndex.push({ name: entry.summoner, player });
    added += 1;
  }
  if (added) nameIndex.sort((a, b) => b.name.length - a.name.length);
  return added;
}

function playerForAlias(summoner) {
  const lower = summoner.toLowerCase();
  const hash = lower.indexOf('#');
  const name = (hash === -1 ? lower : lower.slice(0, hash)).trim();
  for (const entry of nameIndex) {
    const alias = entry.name.toLowerCase();
    if (alias === lower) return entry.player;
    const aliasHash = alias.indexOf('#');
    const aliasName = (aliasHash === -1 ? alias : alias.slice(0, aliasHash)).trim();
    if (!name || aliasName !== name) continue;
    if (hash === -1 || aliasHash === -1) return entry.player;
    const tag = lower.slice(hash + 1).trim();
    const aliasTag = alias.slice(aliasHash + 1).trim();
    if (!tag || !aliasTag || tag === aliasTag) return entry.player;
  }
  return null;
}

async function lcu(path) {
  const res = await fetch(path);
  if (!res.ok) return null;
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function refreshIdentities() {
  const [me, eog, champs, conversations] = await Promise.all([
    lcu('/lol-summoner/v1/current-summoner'),
    lcu('/lol-end-of-game/v1/eog-stats-block'),
    lcu('/lol-game-data/assets/v1/champion-summary.json'),
    lcu('/lol-chat/v1/conversations'),
  ]);

  const champNames = new Map();
  const champIcons = new Map();
  for (const c of champs || []) {
    if (!c || c.id == null) continue;
    const id = Number(c.id);
    champNames.set(id, c.name || c.alias);
    if (c.squarePortraitPath) champIcons.set(id, c.squarePortraitPath);
  }

  const list = collectPlayers(eog, me, champNames, champIcons);
  roster = list;
  byPuuid.clear();
  bySummonerId.clear();
  const nextAliases = [];

  for (const player of list) {
    if (player.puuid) byPuuid.set(String(player.puuid), player);
    if (player.summonerId != null && player.summonerId !== '' && Number(player.summonerId) !== 0) {
      bySummonerId.set(String(player.summonerId), player);
    }
    for (const alias of player.aliases) {
      if (alias) nextAliases.push({ name: alias, player });
    }
  }

  const postGame = (conversations || []).find((c) => c?.type === 'postGame');
  conversationId = postGame?.id || postGame?.pid || null;

  if (conversationId) {
    const messages = await lcu(
      `/lol-chat/v1/conversations/${encodeURIComponent(conversationId)}/messages`,
    );
    applyJoinRoomMapping(messages || []);
  }

  nextAliases.sort((a, b) => b.name.length - a.name.length);
  nameIndex = nextAliases;
  applySeeds();
}

function collectPlayers(eog, me, champNames, champIcons) {
  if (!eog) return [];
  const myPuuid = me?.puuid;
  const mySummonerId = me?.summonerId;
  const list = [];

  const push = (raw, allyHint, teamId) => {
    if (!raw) return;
    const championId = Number(raw.championId);
    const championName =
      champNames.get(championId) ||
      raw.championName ||
      (raw.skinName ? String(raw.skinName) : null) ||
      'Unknown';
    const iconPath =
      champIcons.get(championId) ||
      (championId ? `/lol-game-data/assets/v1/champion-icons/${championId}.png` : '');
    const playerAliases = unique([
      raw.riotIdGameName && raw.riotIdTagLine
        ? `${raw.riotIdGameName}#${raw.riotIdTagLine}`
        : null,
      raw.gameName && raw.tagLine ? `${raw.gameName}#${raw.tagLine}` : null,
      raw.riotIdGameName,
      raw.gameName,
      raw.summonerName,
      raw.displayName,
      raw.riotId,
    ]);
    list.push({
      puuid: raw.puuid || raw.playerPuuid || null,
      summonerId: raw.summonerId ?? raw.userId ?? null,
      teamId: teamId ?? raw.teamId ?? null,
      championName,
      iconPath,
      ally: allyHint,
      aliases: playerAliases,
    });
  };

  if (Array.isArray(eog.teams) && eog.teams.length) {
    for (const team of eog.teams) {
      const ally = team.isPlayerTeam === true;
      for (const p of team.players || []) push(p, ally, p.teamId ?? team.teamId);
    }
  }

  if (!list.length) {
    for (const p of eog.teamPlayerParticipantStats || []) push(p, true, p.teamId);
    for (const p of eog.otherTeamPlayerParticipantStats || []) push(p, false, p.teamId);
  }

  const mine = list.find(
    (p) =>
      (myPuuid && p.puuid === myPuuid) ||
      (mySummonerId != null && String(p.summonerId) === String(mySummonerId)),
  );
  if (mine) {
    const myTeam = mine.teamId;
    const anyAllyHint = list.some((p) => p.ally === true);
    if (!anyAllyHint && myTeam != null) {
      for (const p of list) p.ally = String(p.teamId) === String(myTeam);
    } else {
      mine.ally = true;
    }
  }

  return list;
}

// Join/leave messages fill a puuid or summoner id the eog block omitted.
// Name rendering does not read these ids.
function applyJoinRoomMapping(messages) {
  for (const msg of messages || []) {
    if (msg?.type !== 'system') continue;
    if (String(msg.body) !== 'joined_room' && String(msg.body) !== 'left_room') continue;
    const puuid = msg.fromPuuid && String(msg.fromPuuid);
    const sid = msg.fromSummonerId;
    if (!puuid || sid == null || Number(sid) === 0) continue;
    const player = byPuuid.get(puuid) || bySummonerId.get(String(sid));
    if (!player) continue;
    player.puuid = player.puuid || puuid;
    player.summonerId = player.summonerId || sid;
    byPuuid.set(puuid, player);
    bySummonerId.set(String(sid), player);
  }
}

function unique(values) {
  const out = [];
  const seen = new Set();
  for (const v of values) {
    const s = String(v || '').trim();
    if (!s || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase());
    out.push(s);
  }
  return out;
}
