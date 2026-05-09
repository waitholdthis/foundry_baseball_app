/* ═══════════════════════════════════════════════════════
   Foundry — Main App JS
   State → Roster → Lineup → Game Engine → Audio → PDF
═══════════════════════════════════════════════════════ */
"use strict";

/* ─── PWA registration ─── */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

/* ─────────────────────────────────────────────
   STATE
───────────────────────────────────────────── */
const STORAGE_KEY = 'foundry_v1';

const DEFAULT_STATE = {
  team: null,          // {name, sport, field}
  players: [],         // [{id, name, number, pos, bats, throws, walkUpKey}]
  lineup: [],          // [playerId, ...] — current batting order
  game: null,          // see newGameState()
  completedGames: [],  // archived game summaries
  pitchTracking: { enabled: false, warnAt: 75, alarmAt: 100 },
  superVoice: {
    enabled: false,
    template: 'Now batting, number {number}, {name}',
    voiceURI: '',
    rate: 0.9,
    pitch: 0.9,
    beforeSong: true,
    paMode: false,
    paTemplate: 'Now batting. Number {number}. {name}!',
    elKey: '',
    elVoiceId: 'pNInz6obpgDQGcFmaJgB',
  },
  playlist: {
    tracks: [],    // [{key, name}] — keys are IndexedDB blob keys
    shuffle: false,
    autoPlay: true,
  },
};

let S = loadState();

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_STATE };
    const saved = JSON.parse(raw);
    return {
      ...DEFAULT_STATE,
      ...saved,
      superVoice: { ...DEFAULT_STATE.superVoice, ...(saved.superVoice || {}) },
      pitchTracking: { ...DEFAULT_STATE.pitchTracking, ...(saved.pitchTracking || {}) },
      playlist: {
        ...DEFAULT_STATE.playlist,
        ...(saved.playlist || {}),
        tracks: saved.playlist?.tracks || [],
      },
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(S)); } catch {}
}

function newGameState(opponent, date, field, homeAway, innings) {
  return {
    id: Date.now().toString(),
    opponent,
    date,
    field,
    homeAway,       // 'home' | 'away'
    totalInnings: innings,
    inning: 1,
    half: 'top',    // top = visitors bat, bottom = home team bats
    outs: 0,
    runners: [false, false, false], // [1B, 2B, 3B]
    score: { us: 0, them: 0 },
    lineupIndex: 0,
    balls: 0,
    strikes: 0,
    inningLog: [],  // [{us: n, them: n}] length = innings played
    atBats: [],     // [{id, playerId, inning, half, result, rbi, bases}]
    events: [],     // for undo
    substitutions: {}, // {lineupSlot: newPlayerId}
    pitches: [],    // [{id, inning, half, pitcherName, type, zone, outcome, pc}]
    pitcher: '',    // current opposing pitcher name
    pitchCount: 0,  // pitches thrown by current pitcher
  };
}

/* Determine if we are currently batting */
function weAreBatting() {
  const g = S.game;
  if (!g) return false;
  if (g.homeAway === 'home') return g.half === 'bottom';
  return g.half === 'top';
}

/* ─────────────────────────────────────────────
   LOCAL AUDIO STORAGE (IndexedDB)
   Walk-up audio blobs stored by key (playerId)
───────────────────────────────────────────── */
let audioDB = null;
const DB_NAME = 'foundry_audio', DB_STORE = 'files', DB_VER = 1;

function openAudioDB() {
  return new Promise((resolve, reject) => {
    if (audioDB) { resolve(audioDB); return; }
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = e => e.target.result.createObjectStore(DB_STORE);
    req.onsuccess = e => { audioDB = e.target.result; resolve(audioDB); };
    req.onerror = reject;
  });
}

async function saveAudioBlob(key, blob) {
  const db = await openAudioDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(blob, key);
    tx.oncomplete = res;
    tx.onerror = rej;
  });
}

async function loadAudioBlob(key) {
  const db = await openAudioDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const req = tx.objectStore(DB_STORE).get(key);
    req.onsuccess = () => res(req.result || null);
    req.onerror = rej;
  });
}

async function deleteAudioBlob(key) {
  const db = await openAudioDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).delete(key);
    tx.oncomplete = res;
    tx.onerror = rej;
  });
}

/* ─────────────────────────────────────────────
   NAVIGATION
───────────────────────────────────────────── */
const SCREENS = ['setup', 'roster', 'lineup', 'game', 'summary'];

function navigate(to) {
  SCREENS.forEach(id => {
    const el = document.getElementById(`screen-${id}`);
    if (!el) return;
    el.classList.toggle('active', id === to);
  });
}

/* ─────────────────────────────────────────────
   TOAST
───────────────────────────────────────────── */
const toastEl = document.getElementById('toast');
let toastTimer = null;

function showToast(msg, duration = 2800) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), duration);
}

/* ─────────────────────────────────────────────
   INSTALL PROMPT
───────────────────────────────────────────── */
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredInstall = e;
  document.getElementById('installBanner').classList.remove('hidden');
});
document.getElementById('installBtn').addEventListener('click', () => {
  if (!deferredInstall) return;
  deferredInstall.prompt();
  deferredInstall.userChoice.then(() => {
    deferredInstall = null;
    document.getElementById('installBanner').classList.add('hidden');
  });
});
document.getElementById('installDismiss').addEventListener('click', () => {
  document.getElementById('installBanner').classList.add('hidden');
});

/* ─────────────────────────────────────────────
   SCREEN 1 — SETUP
───────────────────────────────────────────── */
const setupForm   = document.getElementById('setupForm');
const teamNameEl  = document.getElementById('teamName');
const homeFieldEl = document.getElementById('homeField');
let selectedSport = 'baseball';

// Segmented sport selector
document.querySelectorAll('[data-sport]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-sport]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedSport = btn.dataset.sport;
  });
});

setupForm.addEventListener('submit', e => {
  e.preventDefault();
  const name = teamNameEl.value.trim();
  if (!name) { teamNameEl.focus(); return; }
  S.team = { name, sport: selectedSport, field: homeFieldEl.value.trim() };
  saveState();
  renderRosterScreen();
  navigate('roster');
});

/* ─────────────────────────────────────────────
   SCREEN 2 — ROSTER
───────────────────────────────────────────── */
function renderRosterScreen() {
  document.getElementById('rosterTeamName').textContent = S.team?.name || 'Roster';
  renderPlayerList();
}

function renderPlayerList() {
  const list = document.getElementById('rosterList');
  const empty = document.getElementById('rosterEmpty');
  const doneBtn = document.getElementById('rosterDone');

  list.innerHTML = '';
  const players = S.players;
  const isEmpty = players.length === 0;
  empty.classList.toggle('hidden', !isEmpty);
  doneBtn.disabled = players.length < 1;
  document.getElementById('rosterCount').textContent = `${players.length} player${players.length === 1 ? '' : 's'}`;

  players.forEach(p => {
    const card = document.createElement('div');
    card.className = 'player-card';
    card.setAttribute('role', 'listitem');
    card.setAttribute('tabindex', '0');
    card.innerHTML = `
      <span class="player-num">${p.number}</span>
      <div class="player-info">
        <div class="player-name">${esc(p.name)}</div>
        <div class="player-detail">${p.pos} · B:${p.bats} T:${p.throws}</div>
      </div>
      <span class="player-audio-badge${(p.walkUpKey || p.walkUpUrl) ? '' : ' hidden'}" aria-label="Has walk-up song">♪</span>
      <button class="player-delete" data-id="${p.id}" aria-label="Delete ${esc(p.name)}">✕</button>
    `;
    card.addEventListener('click', ev => {
      if (ev.target.closest('.player-delete')) return;
      openPlayerSheet(p);
    });
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter') openPlayerSheet(p);
    });
    const del = card.querySelector('.player-delete');
    del.addEventListener('click', ev => { ev.stopPropagation(); deletePlayer(p.id); });
    list.appendChild(card);
  });
}

function deletePlayer(id) {
  const p = S.players.find(x => x.id === id);
  if (!p) return;
  S.players = S.players.filter(x => x.id !== id);
  S.lineup  = S.lineup.filter(x => x !== id);
  if (p.walkUpKey) deleteAudioBlob(p.walkUpKey).catch(() => {});
  saveState();
  renderPlayerList();
}

/* Add/Edit Player Sheet */
const playerSheetOverlay = document.getElementById('playerSheetOverlay');
const playerForm  = document.getElementById('playerForm');
const playerIdEl  = document.getElementById('playerId');
const playerNumEl = document.getElementById('playerNumber');
const playerNameEl= document.getElementById('playerName');
const playerPosEl = document.getElementById('playerPos');
const playerBatsEl= document.getElementById('playerBats');
const playerThrowEl= document.getElementById('playerThrows');
const walkUpFileEl= document.getElementById('walkUpFile');
const walkUpNameEl= document.getElementById('walkUpFileName');
let pendingAudioBlob = null;
let pendingAudioName = '';

/* ── Walk-up song library (add entries here as you drop files in /walkupsongs/) ── */
const WALKUP_LIBRARY = [
  { name: 'Centerfield',  file: '/walkupsongs/Walk_Up_Centerfield.mp3' },
];

(function buildWalkUpLibrary() {
  const container = document.getElementById('walkUpLibrary');
  if (!WALKUP_LIBRARY.length) {
    document.getElementById('walkUpLibraryGroup').classList.add('hidden');
    return;
  }
  WALKUP_LIBRARY.forEach(song => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'walkup-lib-btn';
    btn.textContent = song.name;
    btn.addEventListener('click', () => {
      document.getElementById('walkUpUrl').value = song.file;
      container.querySelectorAll('.walkup-lib-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
    container.appendChild(btn);
  });
})();

document.getElementById('addPlayerBtn').addEventListener('click', () => openPlayerSheet(null));
document.getElementById('cancelPlayer').addEventListener('click', closePlayerSheet);
playerSheetOverlay.addEventListener('click', e => { if (e.target === playerSheetOverlay) closePlayerSheet(); });

document.getElementById('pickWalkUp').addEventListener('click', () => walkUpFileEl.click());
walkUpFileEl.addEventListener('change', () => {
  const file = walkUpFileEl.files[0];
  if (!file) return;
  pendingAudioBlob = file;
  pendingAudioName = file.name;
  walkUpNameEl.textContent = file.name.length > 32 ? file.name.slice(0, 29) + '…' : file.name;
});

function openPlayerSheet(player) {
  pendingAudioBlob = null;
  pendingAudioName = '';
  walkUpFileEl.value = '';

  if (player) {
    document.getElementById('playerSheetTitle').textContent = 'Edit Player';
    playerIdEl.value  = player.id;
    playerNumEl.value = player.number;
    playerNameEl.value= player.name;
    playerPosEl.value = player.pos;
    playerBatsEl.value= player.bats;
    playerThrowEl.value= player.throws;
    walkUpNameEl.textContent = player.walkUpKey ? 'File saved' : 'No file';
    document.getElementById('walkUpUrl').value = player.walkUpUrl || '';
  } else {
    document.getElementById('playerSheetTitle').textContent = 'Add Player';
    playerForm.reset();
    playerIdEl.value = '';
    walkUpNameEl.textContent = 'No file';
    document.getElementById('walkUpUrl').value = '';
  }
  const currentUrl = player?.walkUpUrl || '';
  document.querySelectorAll('.walkup-lib-btn').forEach(b => {
    b.classList.toggle('active', b.closest && WALKUP_LIBRARY.find(s => s.file === currentUrl && b.textContent === s.name) != null);
  });
  playerSheetOverlay.classList.remove('hidden');
  setTimeout(() => playerNameEl.focus(), 100);
}

function closePlayerSheet() {
  playerSheetOverlay.classList.add('hidden');
}

playerForm.addEventListener('submit', async e => {
  e.preventDefault();
  const name = playerNameEl.value.trim();
  const num  = playerNumEl.value.trim();
  if (!name || !num) return;

  const existingId = playerIdEl.value;
  let player = existingId ? S.players.find(p => p.id === existingId) : null;

  if (!player) {
    player = { id: `p_${Date.now()}`, walkUpKey: null };
    S.players.push(player);
  }

  player.name   = name;
  player.number = num;
  player.pos    = playerPosEl.value;
  player.bats   = playerBatsEl.value;
  player.throws = playerThrowEl.value;

  if (pendingAudioBlob) {
    const key = `audio_${player.id}`;
    await saveAudioBlob(key, pendingAudioBlob);
    player.walkUpKey  = key;
    player.walkUpName = pendingAudioName;
  }

  const urlInput = document.getElementById('walkUpUrl').value.trim();
  player.walkUpUrl = urlInput || null;

  saveState();
  closePlayerSheet();
  renderPlayerList();

  // Auto-add to lineup if not already in it
  if (!S.lineup.includes(player.id)) S.lineup.push(player.id);
  saveState();
});

// Roster "Done" button → Lineup
document.getElementById('rosterDone').addEventListener('click', () => {
  // Sync lineup: keep existing order, add new players at end, remove deleted ones
  const ids = S.players.map(p => p.id);
  S.lineup = [...S.lineup.filter(id => ids.includes(id))];
  ids.forEach(id => { if (!S.lineup.includes(id)) S.lineup.push(id); });
  saveState();
  renderLineupScreen();
  navigate('lineup');
});

/* ─────────────────────────────────────────────
   SCREEN 3 — LINEUP BUILDER
───────────────────────────────────────────── */
function renderLineupScreen() {
  const ol = document.getElementById('lineupList');
  ol.innerHTML = '';

  S.lineup.forEach((pid, idx) => {
    const p = S.players.find(x => x.id === pid);
    if (!p) return;

    const li = document.createElement('li');
    li.className = 'lineup-item';
    li.draggable = true;
    li.dataset.pid = pid;
    li.dataset.idx = idx;
    li.innerHTML = `
      <span class="lineup-slot">${idx + 1}</span>
      <div class="lineup-item-info">
        <div class="lineup-item-name">${esc(p.name)}</div>
        <div class="lineup-item-detail">#${p.number} · ${p.pos}</div>
      </div>
      <div class="lineup-move-btns">
        <button class="lineup-move-btn" data-dir="up" aria-label="Move ${esc(p.name)} up">▲</button>
        <button class="lineup-move-btn" data-dir="down" aria-label="Move ${esc(p.name)} down">▼</button>
      </div>
      <span class="lineup-drag-handle" aria-hidden="true">⠿</span>
    `;

    // Move buttons
    li.querySelectorAll('[data-dir]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const dir = btn.dataset.dir;
        const i = S.lineup.indexOf(pid);
        if (dir === 'up' && i > 0) {
          [S.lineup[i], S.lineup[i-1]] = [S.lineup[i-1], S.lineup[i]];
        } else if (dir === 'down' && i < S.lineup.length - 1) {
          [S.lineup[i], S.lineup[i+1]] = [S.lineup[i+1], S.lineup[i]];
        }
        saveState();
        renderLineupScreen();
      });
    });

    // Drag-and-drop (desktop + touch via pointer events)
    setupDragItem(li, ol);
    ol.appendChild(li);
  });
}

/* Simple drag-and-drop for lineup */
let dragSrc = null;

function setupDragItem(el, container) {
  el.addEventListener('dragstart', e => {
    dragSrc = el;
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => el.classList.add('dragging'), 0);
  });
  el.addEventListener('dragend', () => {
    el.classList.remove('dragging');
    container.querySelectorAll('.lineup-item').forEach(i => i.classList.remove('drag-over'));
    dragSrc = null;
    saveState();
    renderLineupScreen();
  });
  el.addEventListener('dragover', e => {
    e.preventDefault();
    if (!dragSrc || dragSrc === el) return;
    container.querySelectorAll('.lineup-item').forEach(i => i.classList.remove('drag-over'));
    el.classList.add('drag-over');
  });
  el.addEventListener('drop', e => {
    e.preventDefault();
    if (!dragSrc || dragSrc === el) return;
    const srcPid = dragSrc.dataset.pid;
    const dstPid = el.dataset.pid;
    const si = S.lineup.indexOf(srcPid);
    const di = S.lineup.indexOf(dstPid);
    S.lineup.splice(si, 1);
    S.lineup.splice(di, 0, srcPid);
    el.classList.remove('drag-over');
  });

  // Touch drag via pointer events
  let touchStartY = 0, touchEl = null;
  el.addEventListener('pointerdown', e => {
    if (e.target.closest('.lineup-move-btn')) return;
    touchStartY = e.clientY;
    touchEl = el;
  }, { passive: true });
}

document.getElementById('lineupBack').addEventListener('click', () => navigate('roster'));
document.getElementById('lineupBackBtn').addEventListener('click', () => navigate('roster'));
document.getElementById('lineupReset').addEventListener('click', () => {
  S.lineup = S.players.map(p => p.id);
  saveState();
  renderLineupScreen();
});

/* Game Setup sheet */
const gameSetupOverlay = document.getElementById('gameSetupOverlay');
let selectedHA = 'home';

document.getElementById('startGameBtn').addEventListener('click', () => {
  document.getElementById('gameDate').value = new Date().toISOString().slice(0, 10);
  document.getElementById('gameField').value = S.team?.field || '';
  gameSetupOverlay.classList.remove('hidden');
  setTimeout(() => document.getElementById('gameOpponent').focus(), 100);
});

document.querySelectorAll('[data-ha]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-ha]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedHA = btn.dataset.ha;
  });
});

document.getElementById('cancelGameSetup').addEventListener('click', () => {
  gameSetupOverlay.classList.add('hidden');
});

document.getElementById('gameSetupForm').addEventListener('submit', e => {
  e.preventDefault();
  const opp = document.getElementById('gameOpponent').value.trim();
  if (!opp) return;
  const date = document.getElementById('gameDate').value;
  const field = document.getElementById('gameField').value.trim();
  const innings = parseInt(document.getElementById('gameInnings').value, 10);
  S.game = newGameState(opp, date, field, selectedHA, innings);
  saveState();
  gameSetupOverlay.classList.add('hidden');
  renderGameScreen();
  navigate('game');
  activateTab(weAreBatting() ? 'scorebook' : 'lineup');
});

/* ─────────────────────────────────────────────
   SCREEN 4 — GAME DAY
───────────────────────────────────────────── */

function renderGameScreen() {
  const g = S.game;
  if (!g) return;

  // Score bar
  const usName  = S.team?.name?.toUpperCase() || 'US';
  const theirName = g.opponent.toUpperCase();

  if (g.homeAway === 'home') {
    document.getElementById('scoreOurName').textContent  = usName;
    document.getElementById('scoreTheirName').textContent = theirName;
  } else {
    document.getElementById('scoreOurName').textContent  = usName;
    document.getElementById('scoreTheirName').textContent = theirName;
  }

  updateScoreBar();
  renderLineupRail();
  updateAtBatCard();
  renderBoxScore('boxscoreTable', 'boxscoreHead', 'boxscoreBody');
  renderBattingStats('battingStatsBody');
  renderSeasonStats('seasonStatsBody');
  syncPitchUI();
  showHalfView();
}

function updateScoreBar() {
  const g = S.game;
  document.getElementById('scoreOurRuns').textContent   = g.score.us;
  document.getElementById('scoreTheirRuns').textContent = g.score.them;
  document.getElementById('scoreInning').textContent    = g.inning;
  document.getElementById('halfTopBtn').setAttribute('aria-pressed', g.half === 'top' ? 'true' : 'false');
  document.getElementById('halfBotBtn').setAttribute('aria-pressed', g.half === 'bottom' ? 'true' : 'false');

  // Outs
  [1, 2, 3].forEach(n => {
    document.getElementById(`out${n}`).classList.toggle('filled', n <= g.outs);
  });
}

/* Tab bar (phone) */
function activateTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    const isActive = btn.dataset.tab === tab;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
  document.querySelectorAll('.game-panel').forEach(panel => {
    const isActive = panel.id === `panel-${tab}`;
    panel.classList.toggle('tab-active', isActive);
    panel.setAttribute('aria-hidden', isActive ? 'false' : 'true');
  });
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => activateTab(btn.dataset.tab));
});

/* Lineup Rail */
function renderLineupRail() {
  const g = S.game;
  const ol = document.getElementById('gameLineupRail');
  ol.innerHTML = '';
  const batterIdx = g.lineupIndex % S.lineup.length;
  const onDeckIdx = (batterIdx + 1) % S.lineup.length;

  S.lineup.forEach((pid, i) => {
    const p = playerById(pid) || { name: '—', number: '?', pos: '?' };
    const li = document.createElement('li');
    li.className = 'rail-item';
    const isAtBat  = i === batterIdx && weAreBatting();
    const isOnDeck = i === onDeckIdx && weAreBatting();
    if (isAtBat)  li.classList.add('at-bat');
    if (isOnDeck) li.classList.add('on-deck');

    // Check if batted this half-inning
    const battedCount = g.atBats.filter(ab => ab.lineupSlot === i && ab.inning === g.inning && ab.half === g.half).length;
    if (battedCount > 0 && !isAtBat) li.classList.add('batted');

    li.innerHTML = `
      <span class="rail-slot">${i + 1}</span>
      <div class="rail-info">
        <div class="rail-name">${esc(p.name)}</div>
        <div class="rail-pos">#${p.number} · ${p.pos}</div>
      </div>
    `;
    li.addEventListener('click', () => {
      if (!isAtBat) openSubSheet(i);
    });
    ol.appendChild(li);
  });
}

/* At-Bat Card */
function updateAtBatCard() {
  const g = S.game;
  const batterSlot = g.lineupIndex % S.lineup.length;
  const pid = S.lineup[batterSlot];
  const p   = playerById(pid);

  document.getElementById('atBatSlot').textContent = `#${batterSlot + 1}`;
  document.getElementById('atBatName').textContent = p ? p.name : '—';
  document.getElementById('atBatMeta').textContent = p ? `#${p.number} · ${p.pos} · B:${p.bats}` : '—';

  // Count dots
  ['b1','b2','b3'].forEach((id, i) => {
    document.getElementById(id).classList.toggle('active', i < g.balls);
  });
  ['s1','s2'].forEach((id, i) => {
    document.getElementById(id).classList.toggle('active', i < g.strikes);
  });

  // Runners
  updateDiamond();

  // DJ on-deck
  const onDeckSlot = (batterSlot + 1) % S.lineup.length;
  const onDeckP = playerById(S.lineup[onDeckSlot]);
  document.getElementById('djOnDeckName').textContent = onDeckP ? onDeckP.name : '—';
  document.getElementById('djOnDeckSong').textContent = (onDeckP?.walkUpKey || onDeckP?.walkUpUrl) ? '♪ Walk-up loaded' : 'No walk-up';

  // SuperVoice + walk-up on batter change
  if (p) {
    setTimeout(() => handleBatterChange(p), 200);
  }
}

function updateDiamond() {
  const runners = S.game.runners; // [1B, 2B, 3B]
  const baseIds = { 1: 'base1', 2: 'base2', 3: 'base3' };
  [1, 2, 3].forEach(b => {
    const el = document.getElementById(baseIds[b]);
    if (el) el.classList.toggle('runner', runners[b - 1]);
  });
  // Base paths (path23 = center→right = 1B; path41 = center→left = 3B)
  const pathMap = { 1: 'path23', 2: 'path12', 3: 'path41' };
  [1, 2, 3].forEach(b => {
    const el = document.getElementById(pathMap[b]);
    if (el) el.classList.toggle('runner', runners[b - 1]);
  });
}

// Base toggle buttons
['1','2','3'].forEach(b => {
  const btn = document.getElementById(`baseBtn${b}`);
  if (!btn) return;
  btn.addEventListener('click', () => {
    if (!S.game) return;
    S.game.runners[parseInt(b) - 1] = !S.game.runners[parseInt(b) - 1];
    updateDiamond();
    saveState();
  });
});

document.getElementById('baseBtnHome').addEventListener('click', () => {
  if (!S.game) return;
  // Score a run manually (e.g., wild pitch / passed ball)
  S.game.score.us++;
  updateScoreBar();
  saveState();
  showToast('Run scored!');
});

/* ─── Outcome buttons ─── */
document.querySelectorAll('.outcome-btn').forEach(btn => {
  btn.addEventListener('click', () => recordPlay(btn.dataset.result));
});

function recordPlay(result) {
  const g = S.game;
  if (!g) return;
  if (!weAreBatting()) {
    // We're in the field — they bat (simplified: just record their out/score)
    recordOpponentPlay(result);
    return;
  }

  const slot = g.lineupIndex % S.lineup.length;
  const pid  = S.lineup[slot];

  // Save snapshot for undo
  g.events.push({
    lineupIndex: g.lineupIndex,
    inning: g.inning, half: g.half,
    outs: g.outs, runners: [...g.runners],
    score: { ...g.score }, balls: g.balls, strikes: g.strikes,
    atBatsLen: g.atBats.length,
  });

  // Reset count
  g.balls = 0; g.strikes = 0;

  // Determine result category
  const isOut  = ['K','Kl','GO','FO','DP','SAC'].includes(result);
  const isHit  = ['1B','2B','3B','HR'].includes(result);
  const isWalk = ['BB','HBP'].includes(result);
  const isError= result === 'E' || result === 'FC';

  let bases = 0; // bases runner reaches
  if (result === '1B' || isWalk || isError) bases = 1;
  if (result === '2B') bases = 2;
  if (result === '3B') bases = 3;
  if (result === 'HR') bases = 4;

  let rbi = 0;
  const prevRunners = [...g.runners];

  if (!isOut) {
    rbi = advanceRunners(bases, prevRunners);
  } else if (result === 'SAC') {
    // SAC fly — score runner from 3rd
    if (prevRunners[2]) { g.score.us++; rbi = 1; g.runners[2] = false; }
  }

  if (isOut || result === 'SAC') g.outs++;
  if (result === 'DP') g.outs++;

  // Record the at-bat
  const ab = { id: `ab_${Date.now()}`, playerId: pid, lineupSlot: slot, inning: g.inning, half: g.half, result, rbi, bases, isOut: isOut || result === 'SAC' };
  g.atBats.push(ab);

  // Advance batter
  g.lineupIndex++;

  // Check 3 outs
  if (g.outs >= 3) {
    endHalfInning();
    return;
  }

  saveState();
  updateScoreBar();
  renderLineupRail();
  updateAtBatCard();
  renderBoxScore('boxscoreTable', 'boxscoreHead', 'boxscoreBody');
  renderBattingStats('battingStatsBody');
  renderSeasonStats('seasonStatsBody');
  if (isHit) openSprayModal(ab.id);
}

function advanceRunners(bases, prev) {
  const g = S.game;
  let rbi = 0;

  // Move existing runners
  const newRunners = [false, false, false];
  for (let r = 2; r >= 0; r--) {
    if (!prev[r]) continue;
    const newBase = r + 1 + bases;
    if (newBase >= 4) { g.score.us++; rbi++; }
    else { newRunners[newBase - 1] = true; }
  }

  // Place batter
  if (bases > 0) {
    if (bases >= 4) { g.score.us++; rbi++; }
    else { newRunners[bases - 1] = true; }
  }

  g.runners = newRunners;
  return rbi;
}

function recordOpponentPlay(result) {
  const g = S.game;
  const isOut = ['K','Kl','GO','FO','DP','SAC'].includes(result);

  let bases = 0;
  if (result === '1B' || ['BB','HBP'].includes(result)) bases = 1;
  if (result === '2B') bases = 2;
  if (result === '3B') bases = 3;
  if (result === 'HR') bases = 4;

  if (!isOut) {
    const prev = [...g.runners];
    const newRunners = [false, false, false];
    for (let r = 2; r >= 0; r--) {
      if (!prev[r]) continue;
      const nb = r + 1 + bases;
      if (nb >= 4) g.score.them++;
      else newRunners[nb - 1] = true;
    }
    if (bases > 0) {
      if (bases >= 4) g.score.them++;
      else newRunners[bases - 1] = true;
    }
    g.runners = newRunners;
  } else { g.outs++; }
  if (result === 'DP') g.outs++;

  if (g.outs >= 3) { endHalfInning(); return; }

  saveState();
  updateScoreBar();
}

/* ─── Fielding view ─── */
function showHalfView() {
  const batting = weAreBatting();
  document.getElementById('battingView').classList.toggle('hidden', !batting);
  document.getElementById('fieldingView').classList.toggle('hidden', batting);
  if (!batting) updateFieldingView();
}

function updateFieldingView() {
  const g = S.game;
  if (!g) return;
  const halfName = g.half === 'top' ? 'TOP' : 'BOTTOM';
  document.getElementById('fieldingInningLabel').textContent = `${halfName} OF ${g.inning}`;
  for (let i = 0; i < 3; i++) {
    document.getElementById(`fDot${i}`).classList.toggle('filled', i < g.outs);
  }
  document.getElementById('fieldingPitchNum').textContent = g.pitchCount ?? 0;
  document.getElementById('fieldingTheirScore').textContent = g.score.them;
}

document.getElementById('fieldingAddPitch').addEventListener('click', () => {
  const g = S.game;
  if (!g) return;
  g.pitchCount = (g.pitchCount || 0) + 1;
  const pc = g.pitchCount;
  const pt = S.pitchTracking || {};
  if (pc === (pt.warnAt ?? 75)) showToast(`Warning: pitcher at ${pc} pitches`, 4000);
  if (pc === (pt.alarmAt ?? 100)) showToast(`Alert: pitcher at ${pc} pitches — consider change`, 5000);
  document.getElementById('fieldingPitchNum').textContent = pc;
  document.getElementById('pitchCountDisplay').textContent = pc;
  saveState();
});

document.getElementById('fieldingAddOut').addEventListener('click', () => {
  const g = S.game;
  if (!g || g.outs >= 3) return;
  g.outs++;
  updateScoreBar();
  updateFieldingView();
  saveState();
  if (g.outs >= 3) setTimeout(() => endHalfInning(), 500);
});

document.getElementById('fieldingAddRun').addEventListener('click', () => {
  const g = S.game;
  if (!g) return;
  g.score.them++;
  updateScoreBar();
  updateFieldingView();
  saveState();
  showToast('Opponent run scored');
});

function endHalfInning() {
  const g = S.game;
  // away team bats in top half; home team bats in bottom half
  const weBatTop = g.homeAway === 'away';

  if (g.half === 'top') {
    const prevTop = g.inningLog.reduce((s, e) => s + (weBatTop ? (e.us || 0) : (e.them || 0)), 0);
    const runsThisHalf = weBatTop ? g.score.us - prevTop : g.score.them - prevTop;
    g.inningLog.push(weBatTop
      ? { us: runsThisHalf, them: null }
      : { us: null, them: runsThisHalf }
    );
  } else {
    if (g.inningLog.length < g.inning) g.inningLog.push({ us: null, them: null });
    const entry = g.inningLog[g.inning - 1] || {};
    const prevBot = g.inningLog.slice(0, g.inning - 1).reduce(
      (s, e) => s + (weBatTop ? (e.them || 0) : (e.us || 0)), 0
    );
    const runsThisHalf = weBatTop ? g.score.them - prevBot : g.score.us - prevBot;
    if (weBatTop) entry.them = runsThisHalf;
    else          entry.us   = runsThisHalf;
    g.inningLog[g.inning - 1] = entry;
  }

  g.outs = 0;
  g.balls = 0; g.strikes = 0;
  g.runners = [false, false, false];

  if (g.half === 'top') {
    g.half = 'bottom';
  } else {
    g.inning++;
    g.half = 'top';
    // Check game over (home team winning after X innings)
    if (g.inning > g.totalInnings) {
      showToast('Game over!', 4000);
      saveState();
      setTimeout(() => showSummary(), 1500);
      return;
    }
  }

  saveState();
  updateScoreBar();
  renderLineupRail();
  updateAtBatCard();
  renderBoxScore('boxscoreTable', 'boxscoreHead', 'boxscoreBody');
  renderBattingStats('battingStatsBody');
  renderSeasonStats('seasonStatsBody');
  showToast(`${g.half === 'bottom' ? 'Bottom' : 'Top'} of inning ${g.inning}`);
  startInningPlaylist();
  showHalfView();
  activateTab(weAreBatting() ? 'scorebook' : 'lineup');
}

/* ─── Count buttons ─── */
document.querySelectorAll('.count-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const g = S.game;
    if (!g) return;
    const type = btn.dataset.count;
    if (type === 'reset') {
      g.balls = 0; g.strikes = 0;
      saveState(); updateAtBatCard(); return;
    }
    // Intercept for pitch tracking
    if (S.pitchTracking?.enabled && g.pitcher && type !== 'reset') {
      openPitchSheet(type); return;
    }
    if (type === 'ball') {
      g.balls++;
      if (g.balls >= 4) { g.balls = 0; recordPlay('BB'); return; }
    } else if (type === 'strike') {
      g.strikes++;
      if (g.strikes >= 3) { g.strikes = 0; recordPlay('K'); return; }
    } else if (type === 'foul') {
      if (g.strikes < 2) g.strikes++;
    }
    saveState();
    updateAtBatCard();
  });
});

/* ─── Undo ─── */
document.getElementById('undoBtn').addEventListener('click', undoLastPlay);

function undoLastPlay() {
  const g = S.game;
  if (!g || !g.events.length) { showToast('Nothing to undo'); return; }
  const snap = g.events.pop();
  g.lineupIndex = snap.lineupIndex;
  g.inning  = snap.inning;
  g.half    = snap.half;
  g.outs    = snap.outs;
  g.runners = snap.runners;
  g.score   = snap.score;
  g.balls   = snap.balls;
  g.strikes = snap.strikes;
  g.atBats  = g.atBats.slice(0, snap.atBatsLen);
  closeSprayModal();
  saveState();
  updateScoreBar();
  renderLineupRail();
  updateAtBatCard();
  renderBoxScore('boxscoreTable', 'boxscoreHead', 'boxscoreBody');
  renderBattingStats('battingStatsBody');
  renderSeasonStats('seasonStatsBody');
  showToast('Last play undone');
}

/* ─── Substitution ─── */
let subTargetSlot = -1;
const subSheetOverlay = document.getElementById('subSheetOverlay');

document.getElementById('subBtn').addEventListener('click', () => {
  const g = S.game;
  if (!g) return;
  openSubSheet(g.lineupIndex % S.lineup.length);
});

function openSubSheet(slot) {
  const g = S.game;
  const currentPid = S.lineup[slot];
  const currentP = playerById(currentPid);
  subTargetSlot = slot;
  document.getElementById('subOutName').textContent = currentP ? currentP.name : '—';

  // All players NOT in lineup (bench)
  const inLineup = new Set(S.lineup);
  const bench = S.players.filter(p => !inLineup.has(p.id));
  const list = document.getElementById('subList');
  list.innerHTML = '';

  if (bench.length === 0) {
    list.innerHTML = '<p style="color:var(--text-2);font-size:14px;padding:8px 0">No bench players available.</p>';
  } else {
    bench.forEach(p => {
      const item = document.createElement('div');
      item.className = 'sub-item';
      item.setAttribute('role', 'listitem');
      item.innerHTML = `
        <span class="sub-item-num">${p.number}</span>
        <div class="sub-item-info">
          <div class="sub-item-name">${esc(p.name)}</div>
          <div class="sub-item-detail">${p.pos} · B:${p.bats}</div>
        </div>
      `;
      item.addEventListener('click', () => makeSub(slot, p.id));
      list.appendChild(item);
    });
  }

  subSheetOverlay.classList.remove('hidden');
}

function makeSub(slot, newPid) {
  const oldPid = S.lineup[slot];
  S.lineup[slot] = newPid;
  S.game.substitutions[slot] = newPid;
  saveState();
  subSheetOverlay.classList.add('hidden');
  renderLineupRail();
  updateAtBatCard();
  showToast(`Substitution: ${playerById(newPid)?.name || '—'} in for ${playerById(oldPid)?.name || '—'}`);
}

document.getElementById('cancelSub').addEventListener('click', () => subSheetOverlay.classList.add('hidden'));
subSheetOverlay.addEventListener('click', e => { if (e.target === subSheetOverlay) subSheetOverlay.classList.add('hidden'); });

/* ─── Game Menu ─── */
const gameMenuOverlay = document.getElementById('gameMenuOverlay');
document.getElementById('gameMenuBtn').addEventListener('click', () => gameMenuOverlay.classList.remove('hidden'));
document.getElementById('closeGameMenu').addEventListener('click', () => gameMenuOverlay.classList.add('hidden'));
gameMenuOverlay.addEventListener('click', e => { if (e.target === gameMenuOverlay) gameMenuOverlay.classList.add('hidden'); });

document.getElementById('endGameBtn').addEventListener('click', () => {
  gameMenuOverlay.classList.add('hidden');
  showSummary();
});

document.getElementById('exportDuringBtn').addEventListener('click', () => {
  gameMenuOverlay.classList.add('hidden');
  exportPDF();
});

document.getElementById('abandonGameBtn').addEventListener('click', () => {
  if (!confirm('Abandon this game? All data will be lost.')) return;
  stopWalkUp();
  stopPlaylist();
  S.game = null;
  saveState();
  gameMenuOverlay.classList.add('hidden');
  navigate('roster');
});

/* ─────────────────────────────────────────────
   BOX SCORE & STATS
───────────────────────────────────────────── */
function renderBoxScore(tableId, headId, bodyId) {
  const g = S.game;
  if (!g) return;
  const head = document.getElementById(headId);
  const body = document.getElementById(bodyId);
  if (!head || !body) return;

  const innings = g.totalInnings;
  const usLabel   = S.team?.name || 'US';
  const themLabel = g.opponent;

  // Header: Team | 1 2 3 … | R
  let hRow = '<tr><th>Team</th>';
  for (let i = 1; i <= innings; i++) hRow += `<th>${i}</th>`;
  hRow += '<th>R</th><th>H</th></tr>';
  head.innerHTML = hRow;

  // Calc per-inning runs for us and them
  const usPerInning   = Array(innings).fill(0);
  const themPerInning = Array(innings).fill(0);

  g.atBats.forEach(ab => {
    if (ab.inning > innings) return;
    usPerInning[ab.inning - 1] += ab.rbi || 0;
  });
  if (g.inningLog) {
    g.inningLog.forEach((entry, idx) => {
      if (idx < innings) {
        usPerInning[idx]   = entry.us   || 0;
        themPerInning[idx] = entry.them || 0;
      }
    });
  }

  const usHits  = g.atBats.filter(ab => ['1B','2B','3B','HR'].includes(ab.result)).length;

  let usRow   = `<tr><td class="cell-us">${esc(usLabel)}</td>`;
  let themRow = `<tr><td>${esc(themLabel)}</td>`;
  for (let i = 0; i < innings; i++) {
    usRow   += `<td class="cell-us">${usPerInning[i]  > 0 ? usPerInning[i]  : '—'}</td>`;
    themRow += `<td>${themPerInning[i] > 0 ? themPerInning[i] : '—'}</td>`;
  }
  usRow   += `<td class="cell-us">${g.score.us}</td><td class="cell-hit">${usHits}</td></tr>`;
  themRow += `<td>${g.score.them}</td><td>—</td></tr>`;

  body.innerHTML = usRow + themRow;
}

function computePlayerStats(atBats) {
  const bb  = atBats.filter(ab => ['BB','HBP'].includes(ab.result)).length;
  const sac = atBats.filter(ab => ab.result === 'SAC').length;
  const pa  = atBats.length;
  const ab  = pa - bb - sac;
  const h   = atBats.filter(ab => ['1B','2B','3B','HR'].includes(ab.result)).length;
  const dbl = atBats.filter(ab => ab.result === '2B').length;
  const tpl = atBats.filter(ab => ab.result === '3B').length;
  const hr  = atBats.filter(ab => ab.result === 'HR').length;
  const k   = atBats.filter(ab => ['K','Kl'].includes(ab.result)).length;
  const rbi = atBats.reduce((s, ab) => s + (ab.rbi || 0), 0);
  const avg = ab > 0 ? h / ab : 0;
  const obp = pa > 0 ? (h + bb) / pa : 0;
  const slg = ab > 0 ? (h + dbl + 2 * tpl + 3 * hr) / ab : 0;
  const ops = obp + slg;
  return { pa, ab, h, dbl, tpl, hr, bb, k, rbi, avg, obp, slg, ops };
}

function renderBattingStats(bodyId) {
  const g = S.game;
  if (!g) return;
  const body = document.getElementById(bodyId);
  if (!body) return;
  const fmt = n => n.toFixed(3).replace(/^0/, '');
  const rows = S.lineup.map(pid => {
    const p  = playerById(pid);
    const st = computePlayerStats(g.atBats.filter(ab => ab.playerId === pid));
    return `<tr>
      <td class="stats-name">${esc(p?.name || '—')}</td>
      <td>${st.ab}</td>
      <td class="${st.h > 0 ? 'cell-hit' : ''}">${st.h}</td>
      <td>${st.dbl}</td>
      <td>${st.tpl}</td>
      <td>${st.hr}</td>
      <td>${st.rbi}</td>
      <td>${st.bb}</td>
      <td class="${st.k > 0 ? 'cell-out' : ''}">${st.k}</td>
      <td>${st.ab > 0 ? fmt(st.avg) : '.000'}</td>
      <td>${st.pa > 0 ? fmt(st.obp) : '.000'}</td>
      <td>${st.ab > 0 ? fmt(st.slg) : '.000'}</td>
    </tr>`;
  });
  body.innerHTML = rows.join('');
}

let seasonSortCol = 'avg';
let seasonSortDir = -1;

function renderSeasonStats(bodyId) {
  const body = document.getElementById(bodyId);
  if (!body) return;
  const games = S.completedGames || [];
  const rows = S.players.map(p => {
    const allAbs = games.flatMap(g => g.atBats.filter(ab => ab.playerId === p.id));
    const gp = games.filter(g => g.atBats.some(ab => ab.playerId === p.id)).length;
    return { p, gp, ...computePlayerStats(allAbs) };
  }).filter(r => r.gp > 0 || r.pa > 0);

  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="15" class="stats-empty">No completed games yet</td></tr>`;
    return;
  }

  rows.sort((a, b) => {
    const av = a[seasonSortCol] ?? 0;
    const bv = b[seasonSortCol] ?? 0;
    return seasonSortDir * (bv - av);
  });

  const fmt = n => n.toFixed(3).replace(/^0/, '');
  body.innerHTML = rows.map(s => `<tr>
    <td class="stats-name">${esc(s.p.name)}</td>
    <td>${s.gp}</td>
    <td>${s.pa}</td>
    <td>${s.ab}</td>
    <td class="${s.h > 0 ? 'cell-hit' : ''}">${s.h}</td>
    <td>${s.dbl}</td>
    <td>${s.tpl}</td>
    <td>${s.hr}</td>
    <td>${s.rbi}</td>
    <td>${s.bb}</td>
    <td class="${s.k > 0 ? 'cell-out' : ''}">${s.k}</td>
    <td>${s.ab > 0 ? fmt(s.avg) : '.000'}</td>
    <td>${s.pa > 0 ? fmt(s.obp) : '.000'}</td>
    <td>${s.ab > 0 ? fmt(s.slg) : '.000'}</td>
    <td>${s.pa > 0 ? fmt(s.ops) : '.000'}</td>
  </tr>`).join('');
}

function bindSeasonSort(headId, bodyId) {
  const head = document.getElementById(headId);
  if (!head) return;
  head.addEventListener('click', e => {
    const th = e.target.closest('[data-sort]');
    if (!th) return;
    const col = th.dataset.sort;
    if (seasonSortCol === col) {
      seasonSortDir *= -1;
    } else {
      seasonSortCol = col;
      seasonSortDir = -1;
    }
    head.querySelectorAll('[data-sort]').forEach(t => {
      t.classList.toggle('sort-active', t.dataset.sort === col);
      t.classList.toggle('sort-asc', t.dataset.sort === col && seasonSortDir === 1);
    });
    renderSeasonStats(bodyId);
  });
}

/* ─────────────────────────────────────────────
   SPRAY CHARTS
───────────────────────────────────────────── */
const SPRAY_COLORS = { '1B': '#22C55E', '2B': '#3B82F6', '3B': '#F59E0B', 'HR': '#EF4444' };
const SPRAY_W = 200, SPRAY_H = 190;

const FIELD_PATHS = `
  <rect width="200" height="190" fill="#0d1a0d"/>
  <polygon points="100,174 7,7 193,7" fill="#1a3d1a"/>
  <path d="M 7,7 Q 100,2 193,7" fill="none" stroke="#5a3e1e" stroke-width="12" stroke-linecap="butt"/>
  <path d="M 13,9 Q 100,5 187,9" fill="none" stroke="#1a3d1a" stroke-width="6" stroke-linecap="butt"/>
  <path d="M 7,7 Q 100,2 193,7" fill="none" stroke="#2a5c2a" stroke-width="2" stroke-linecap="round"/>
  <circle cx="100" cy="126" r="48" fill="#6b4826"/>
  <polygon points="100,158 138,120 100,82 62,120" fill="#1a3d1a"/>
  <circle cx="100" cy="137" r="5.5" fill="#7d5830"/>
  <line x1="100" y1="168" x2="7" y2="7" stroke="white" stroke-width="1" opacity="0.3"/>
  <line x1="100" y1="168" x2="193" y2="7" stroke="white" stroke-width="1" opacity="0.3"/>
  <line x1="100" y1="158" x2="138" y2="120" stroke="#c8a040" stroke-width="1.5"/>
  <line x1="138" y1="120" x2="100" y2="82" stroke="#c8a040" stroke-width="1.5"/>
  <line x1="100" y1="82" x2="62" y2="120" stroke="#c8a040" stroke-width="1.5"/>
  <line x1="62" y1="120" x2="100" y2="158" stroke="#c8a040" stroke-width="1.5"/>
  <rect x="96" y="79" width="8" height="8" fill="white" rx="1"/>
  <rect x="134" y="117" width="8" height="8" fill="white" rx="1"/>
  <rect x="58" y="117" width="8" height="8" fill="white" rx="1"/>
  <polygon points="100,156 96,161 96,166 104,166 104,161" fill="white"/>
`;

let pendingSprayAbId = null;

function openSprayModal(abId) {
  const ab = S.game?.atBats.find(a => a.id === abId);
  if (!ab) return;
  pendingSprayAbId = abId;
  const badge = document.getElementById('sprayResultBadge');
  badge.textContent = ab.result;
  badge.style.background = SPRAY_COLORS[ab.result] || '#fff';
  document.getElementById('sprayPreviewDot')?.remove();
  document.getElementById('sprayModal').hidden = false;
}

function closeSprayModal() {
  document.getElementById('sprayModal').hidden = true;
  pendingSprayAbId = null;
}

document.getElementById('spraySkip').addEventListener('click', closeSprayModal);

document.getElementById('sprayFieldSvg').addEventListener('click', e => {
  if (!pendingSprayAbId) return;
  const svg = document.getElementById('sprayFieldSvg');
  const pt = svg.createSVGPoint();
  pt.x = e.clientX;
  pt.y = e.clientY;
  const svgP = pt.matrixTransform(svg.getScreenCTM().inverse());
  const x = Math.max(0, Math.min(1, svgP.x / SPRAY_W));
  const y = Math.max(0, Math.min(1, svgP.y / SPRAY_H));

  const ab = S.game?.atBats.find(a => a.id === pendingSprayAbId);
  if (ab) {
    ab.spray = { x: parseFloat(x.toFixed(4)), y: parseFloat(y.toFixed(4)) };
    saveState();
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('id', 'sprayPreviewDot');
    dot.setAttribute('cx', svgP.x.toFixed(1));
    dot.setAttribute('cy', svgP.y.toFixed(1));
    dot.setAttribute('r', '7');
    dot.setAttribute('fill', SPRAY_COLORS[ab.result] || '#fff');
    dot.setAttribute('stroke', 'white');
    dot.setAttribute('stroke-width', '2');
    svg.appendChild(dot);
  }
  setTimeout(closeSprayModal, 500);
});

function renderSprayCharts(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const g = S.game;
  if (!g) { container.innerHTML = ''; return; }

  const cards = S.lineup.map(pid => {
    const p = playerById(pid);
    const hits = g.atBats.filter(ab => ab.playerId === pid && ab.spray && SPRAY_COLORS[ab.result]);
    if (!hits.length) return null;

    const dots = hits.map(ab => {
      const cx = (ab.spray.x * SPRAY_W).toFixed(1);
      const cy = (ab.spray.y * SPRAY_H).toFixed(1);
      const col = SPRAY_COLORS[ab.result];
      const star = ab.result === 'HR'
        ? `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle" font-size="6" fill="white" font-weight="900">★</text>`
        : '';
      return `<circle cx="${cx}" cy="${cy}" r="7" fill="${col}" stroke="white" stroke-width="1.5" opacity="0.92"/>${star}`;
    }).join('');

    const legend = Object.entries(SPRAY_COLORS).map(([r, col]) => {
      const n = hits.filter(ab => ab.result === r).length;
      return n ? `<span class="spray-legend-item"><span class="spray-legend-dot" style="background:${col}"></span>${r} ×${n}</span>` : '';
    }).join('');

    return `<div class="spray-card">
      <div class="spray-card-name">${esc(p?.name || '—')}</div>
      <svg viewBox="0 0 ${SPRAY_W} ${SPRAY_H}" class="spray-mini-field" aria-hidden="true">${FIELD_PATHS}${dots}</svg>
      <div class="spray-card-legend">${legend}</div>
    </div>`;
  }).filter(Boolean);

  container.innerHTML = cards.length
    ? cards.join('')
    : '<p class="spray-empty">No spray data recorded — tap a hit location next time.</p>';
}

/* ─────────────────────────────────────────────
   AUDIO — WALK-UP & SOUNDBOARD
───────────────────────────────────────────── */
let walkUpAudio  = null;
let playlistAudio = null;
let plCurrentIdx  = -1;
let soundCtx     = null;
let masterGain   = null;
let currentWalkUpPid = null;

function getAudioCtx() {
  if (!soundCtx) {
    soundCtx  = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = soundCtx.createGain();
    masterGain.connect(soundCtx.destination);
  }
  return soundCtx;
}

function setVolume(v) {
  if (masterGain) masterGain.gain.setTargetAtTime(v, soundCtx.currentTime, 0.05);
  if (walkUpAudio) walkUpAudio.volume = v;
  if (playlistAudio) playlistAudio.volume = v;
}

document.getElementById('masterVolume').addEventListener('input', e => {
  setVolume(parseFloat(e.target.value));
});

/* Central batter-change handler — fires TTS and/or walk-up once per batter */
async function handleBatterChange(player) {
  if (currentWalkUpPid === player.id) return;
  currentWalkUpPid = player.id;
  stopPlaylist(); // batter is up — stop between-innings music

  const sv = S.superVoice || {};
  const hasSong = !!(player.walkUpKey || player.walkUpUrl);

  if (sv.enabled) {
    if (sv.beforeSong) {
      await announcePlayer(player);
    } else {
      announcePlayer(player); // simultaneous — don't await
    }
  }

  if (hasSong && currentWalkUpPid === player.id) {
    if (player.walkUpKey) {
      const blob = await loadAudioBlob(player.walkUpKey).catch(() => null);
      if (blob && currentWalkUpPid === player.id) playWalkUpSrc(URL.createObjectURL(blob), player);
    } else {
      playWalkUpSrc(player.walkUpUrl, player);
    }
  }
}


/* ElevenLabs — session cache so the same line isn't re-generated mid-game */
const elCache = new Map();

async function generateElevenLabsAudio(text, apiKey, voiceId) {
  const cacheKey = `${voiceId}:${text}`;
  if (elCache.has(cacheKey)) return elCache.get(cacheKey);

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_turbo_v2_5',
      voice_settings: { stability: 0.45, similarity_boost: 0.80, style: 0.35, use_speaker_boost: true },
    }),
  });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}`);
  const blob = await res.blob();
  const url  = URL.createObjectURL(blob);
  elCache.set(cacheKey, url);
  return url;
}

function playAudioAndWait(src) {
  return new Promise(resolve => {
    const audio = new Audio(src);
    audio.volume = parseFloat(document.getElementById('masterVolume').value);
    audio.onended = resolve;
    audio.onerror = resolve;
    audio.play().catch(resolve);
  });
}

async function announcePlayer(player) {
  const sv = S.superVoice || {};

  const template = sv.paMode
    ? (sv.paTemplate || 'Now batting. Number {number}. {name}!')
    : (sv.template   || 'Now batting, number {number}, {name}');
  const text = template
    .replace('{name}', player.name)
    .replace('{number}', player.number);

  // ElevenLabs path
  if (sv.paMode && sv.elKey) {
    try {
      const src = await generateElevenLabsAudio(text, sv.elKey, sv.elVoiceId || 'pNInz6obpgDQGcFmaJgB');
      await playAudioAndWait(src);
      return;
    } catch (err) {
      showToast(`ElevenLabs error — falling back to TTS`);
    }
  }

  // Web Speech fallback
  if (!('speechSynthesis' in window)) return;
  return new Promise(resolve => {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate  = sv.rate  ?? 0.9;
    utter.pitch = sv.pitch ?? 0.9;
    if (sv.voiceURI) {
      const v = window.speechSynthesis.getVoices().find(v => v.voiceURI === sv.voiceURI);
      if (v) utter.voice = v;
    }
    utter.onend  = () => resolve();
    utter.onerror = () => resolve();
    window.speechSynthesis.speak(utter);
  });
}

function playWalkUpSrc(src, player) {
  stopWalkUp();
  walkUpAudio = new Audio(src);
  walkUpAudio.volume = parseFloat(document.getElementById('masterVolume').value);
  walkUpAudio.play().catch(() => {});

  document.getElementById('djSongTitle').textContent  = player.walkUpName || 'Walk-Up Song';
  document.getElementById('djPlayerName').textContent = player.name;

  const fill = document.getElementById('djProgressFill');
  const cur  = document.getElementById('djTimeCurrent');
  const dur  = document.getElementById('djTimeDuration');
  const pause = document.getElementById('djPlayPause');
  pause.querySelector('.icon-play').classList.add('hidden');
  pause.querySelector('.icon-pause').classList.remove('hidden');

  walkUpAudio.addEventListener('timeupdate', () => {
    if (!walkUpAudio.duration) return;
    const pct = (walkUpAudio.currentTime / walkUpAudio.duration) * 100;
    fill.style.width = `${pct}%`;
    cur.textContent  = fmtTime(walkUpAudio.currentTime);
    dur.textContent  = fmtTime(walkUpAudio.duration);
  });

  walkUpAudio.addEventListener('ended', () => {
    pause.querySelector('.icon-play').classList.remove('hidden');
    pause.querySelector('.icon-pause').classList.add('hidden');
    fill.style.width = '0%';
  });
}

function stopWalkUp() {
  if (!walkUpAudio) return;
  walkUpAudio.pause();
  walkUpAudio.currentTime = 0;
  walkUpAudio = null;
  currentWalkUpPid = null;
}

function fmtTime(s) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

document.getElementById('djPlayPause').addEventListener('click', () => {
  if (!walkUpAudio) {
    // Try to load current batter's song
    const g = S.game;
    if (!g) return;
    const pid = S.lineup[g.lineupIndex % S.lineup.length];
    const p   = playerById(pid);
    if (p) handleBatterChange(p);
    return;
  }
  if (walkUpAudio.paused) {
    walkUpAudio.play();
    document.getElementById('djPlayPause').querySelector('.icon-play').classList.add('hidden');
    document.getElementById('djPlayPause').querySelector('.icon-pause').classList.remove('hidden');
  } else {
    walkUpAudio.pause();
    document.getElementById('djPlayPause').querySelector('.icon-play').classList.remove('hidden');
    document.getElementById('djPlayPause').querySelector('.icon-pause').classList.add('hidden');
  }
});

document.getElementById('djReplay').addEventListener('click', () => {
  if (!walkUpAudio) return;
  walkUpAudio.currentTime = 0;
  walkUpAudio.play();
});

document.getElementById('djFade').addEventListener('click', () => {
  if (!walkUpAudio) return;
  let vol = walkUpAudio.volume;
  const fade = setInterval(() => {
    vol = Math.max(0, vol - 0.05);
    walkUpAudio.volume = vol;
    if (vol <= 0) { clearInterval(fade); stopWalkUp(); }
  }, 100);
});

/* ─── SuperVoice UI wiring ─── */

function populateVoiceSelector() {
  const sel = document.getElementById('svVoice');
  if (!sel) return;
  const voices = window.speechSynthesis.getVoices();
  sel.innerHTML = '<option value="">Default voice</option>' +
    voices.map(v => `<option value="${v.voiceURI}"${v.voiceURI === (S.superVoice?.voiceURI || '') ? ' selected' : ''}>${v.name} (${v.lang})</option>`).join('');
}

if ('speechSynthesis' in window) {
  window.speechSynthesis.onvoiceschanged = populateVoiceSelector;
  populateVoiceSelector();
}

function syncSVUI() {
  const sv = S.superVoice || {};
  const toggle = document.getElementById('svToggle');
  const panel  = document.getElementById('svPanel');
  if (toggle) toggle.checked = !!sv.enabled;
  if (panel)  panel.hidden   = !sv.enabled;
  const tmpl = document.getElementById('svTemplate');
  if (tmpl) tmpl.value = sv.template || 'Now batting, number {number}, {name}';
  const rate = document.getElementById('svRate');
  if (rate) { rate.value = sv.rate ?? 0.9; document.getElementById('svRateVal').textContent = rate.value; }
  const pitch = document.getElementById('svPitch');
  if (pitch) { pitch.value = sv.pitch ?? 0.9; document.getElementById('svPitchVal').textContent = pitch.value; }
  const before = document.getElementById('svBeforeSong');
  if (before) before.checked = sv.beforeSong !== false;
  // PA mode
  const paToggle = document.getElementById('svPaToggle');
  const paPanel  = document.getElementById('svPaPanel');
  if (paToggle) paToggle.checked = !!sv.paMode;
  if (paPanel)  paPanel.hidden   = !sv.paMode;
  const paTmpl = document.getElementById('svPaTemplate');
  if (paTmpl) paTmpl.value = sv.paTemplate || 'Now batting. Number {number}. {name}!';
  const elKey = document.getElementById('svElKey');
  if (elKey) elKey.value = sv.elKey || '';
  const elVoice = document.getElementById('svElVoice');
  if (elVoice) elVoice.value = sv.elVoiceId || 'pNInz6obpgDQGcFmaJgB';
}

document.getElementById('svToggle')?.addEventListener('change', e => {
  S.superVoice = { ...S.superVoice, enabled: e.target.checked };
  document.getElementById('svPanel').hidden = !e.target.checked;
  saveState();
});

document.getElementById('svTemplate')?.addEventListener('input', e => {
  S.superVoice = { ...S.superVoice, template: e.target.value };
  saveState();
});

document.getElementById('svVoice')?.addEventListener('change', e => {
  S.superVoice = { ...S.superVoice, voiceURI: e.target.value };
  saveState();
});

document.getElementById('svRate')?.addEventListener('input', e => {
  document.getElementById('svRateVal').textContent = e.target.value;
  S.superVoice = { ...S.superVoice, rate: parseFloat(e.target.value) };
  saveState();
});

document.getElementById('svPitch')?.addEventListener('input', e => {
  document.getElementById('svPitchVal').textContent = e.target.value;
  S.superVoice = { ...S.superVoice, pitch: parseFloat(e.target.value) };
  saveState();
});

document.getElementById('svBeforeSong')?.addEventListener('change', e => {
  S.superVoice = { ...S.superVoice, beforeSong: e.target.checked };
  saveState();
});

/* ElevenLabs key + voice wiring */
document.getElementById('svElKey')?.addEventListener('input', e => {
  S.superVoice = { ...S.superVoice, elKey: e.target.value.trim() };
  elCache.clear();
  saveState();
});

document.getElementById('svElVoice')?.addEventListener('change', e => {
  S.superVoice = { ...S.superVoice, elVoiceId: e.target.value };
  elCache.clear();
  saveState();
});

document.getElementById('svElTest')?.addEventListener('click', async () => {
  const sv = S.superVoice || {};
  if (!sv.elKey) { showToast('Enter your ElevenLabs API key first'); return; }
  showToast('Testing ElevenLabs…');
  try {
    const src = await generateElevenLabsAudio('Testing. One. Two. Three.', sv.elKey, sv.elVoiceId || 'pNInz6obpgDQGcFmaJgB');
    await playAudioAndWait(src);
    showToast('ElevenLabs connected!');
  } catch {
    showToast('ElevenLabs test failed — check your API key');
  }
});

/* PA Announcer mode wiring */
document.getElementById('svPaToggle')?.addEventListener('change', e => {
  S.superVoice = { ...S.superVoice, paMode: e.target.checked };
  document.getElementById('svPaPanel').hidden = !e.target.checked;
  saveState();
});

document.getElementById('svPaTemplate')?.addEventListener('input', e => {
  S.superVoice = { ...S.superVoice, paTemplate: e.target.value };
  saveState();
});

document.getElementById('svPaPreset')?.addEventListener('click', () => {
  S.superVoice = { ...S.superVoice, rate: 0.75, pitch: 0.65 };
  const rate  = document.getElementById('svRate');
  const pitch = document.getElementById('svPitch');
  if (rate)  { rate.value  = 0.75; document.getElementById('svRateVal').textContent  = '0.75'; }
  if (pitch) { pitch.value = 0.65; document.getElementById('svPitchVal').textContent = '0.65'; }
  saveState();
  showToast('Rate 0.75 · Pitch 0.65 applied');
});


/* Manual announce button */
document.getElementById('announceBtn').addEventListener('click', () => {
  if (!('speechSynthesis' in window)) { showToast('TTS not supported on this device'); return; }
  const g = S.game;
  if (!g) return;
  const pid = S.lineup[g.lineupIndex % S.lineup.length];
  const p   = playerById(pid);
  if (!p) return;
  announcePlayer(p);
});

syncSVUI();

/* ─────────────────────────────────────────────
   BETWEEN-INNINGS PLAYLIST
───────────────────────────────────────────── */
function stopPlaylist() {
  if (!playlistAudio) return;
  playlistAudio.pause();
  playlistAudio.src = '';
  playlistAudio = null;
  const el = document.getElementById('plNowPlaying');
  if (el) el.hidden = true;
}

async function playPlaylistTrack(track, idx) {
  const blob = await loadAudioBlob(track.key).catch(() => null);
  if (!blob) return;
  stopPlaylist();
  const url = URL.createObjectURL(blob);
  playlistAudio = new Audio(url);
  playlistAudio.volume = parseFloat(document.getElementById('masterVolume').value);
  plCurrentIdx = idx;
  const nowPlaying = document.getElementById('plNowPlaying');
  const nameEl = document.getElementById('plPlayingName');
  if (nameEl) nameEl.textContent = track.name;
  if (nowPlaying) nowPlaying.hidden = false;
  playlistAudio.play().catch(() => {});
  const thisAudio = playlistAudio;
  playlistAudio.addEventListener('ended', () => {
    if (playlistAudio !== thisAudio) return; // superseded
    playlistAudio = null;
    if (nowPlaying) nowPlaying.hidden = true;
    playNextPlaylistTrack();
  });
}

async function playNextPlaylistTrack() {
  const pl = S.playlist;
  if (!pl?.tracks.length) return;
  let nextIdx;
  if (pl.shuffle) {
    nextIdx = Math.floor(Math.random() * pl.tracks.length);
  } else {
    nextIdx = (plCurrentIdx + 1) % pl.tracks.length;
  }
  await playPlaylistTrack(pl.tracks[nextIdx], nextIdx);
}

async function startInningPlaylist() {
  const pl = S.playlist;
  if (!pl?.autoPlay || !pl.tracks.length) return;
  let idx;
  if (pl.shuffle) {
    idx = Math.floor(Math.random() * pl.tracks.length);
  } else {
    plCurrentIdx = (plCurrentIdx + 1) % pl.tracks.length;
    idx = plCurrentIdx;
  }
  await playPlaylistTrack(pl.tracks[idx], idx);
}

function renderPlaylistUI() {
  const list = document.getElementById('plTrackList');
  if (!list) return;
  const tracks = S.playlist?.tracks || [];
  if (!tracks.length) {
    list.innerHTML = '<p class="pl-empty">No tracks yet — add MP3s to play between innings.</p>';
    return;
  }
  list.innerHTML = tracks.map((t, i) => `
    <div class="pl-track-item">
      <span class="pl-track-icon">♫</span>
      <span class="pl-track-name">${esc(t.name)}</span>
      <button class="pl-track-remove" data-idx="${i}" aria-label="Remove ${esc(t.name)}">✕</button>
    </div>
  `).join('');
  list.querySelectorAll('.pl-track-remove').forEach(btn => {
    btn.addEventListener('click', async () => {
      const idx = parseInt(btn.dataset.idx, 10);
      const track = S.playlist.tracks[idx];
      await deleteAudioBlob(track.key).catch(() => {});
      S.playlist.tracks.splice(idx, 1);
      saveState();
      renderPlaylistUI();
    });
  });
}

function syncPlaylistUI() {
  const pl = S.playlist || { tracks: [], shuffle: false, autoPlay: true };
  const auto = document.getElementById('plAutoPlay');
  const shuf = document.getElementById('plShuffle');
  if (auto) auto.checked = !!pl.autoPlay;
  if (shuf) shuf.checked = !!pl.shuffle;
  renderPlaylistUI();
}

document.getElementById('plAutoPlay')?.addEventListener('change', e => {
  S.playlist = { ...S.playlist, autoPlay: e.target.checked };
  saveState();
});

document.getElementById('plShuffle')?.addEventListener('change', e => {
  S.playlist = { ...S.playlist, shuffle: e.target.checked };
  saveState();
});

document.getElementById('plStop')?.addEventListener('click', stopPlaylist);

document.getElementById('plAddBtn')?.addEventListener('click', () => {
  document.getElementById('plFileInput').click();
});

document.getElementById('plFileInput')?.addEventListener('change', async e => {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;
  for (const file of files) {
    const key = `pl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    await saveAudioBlob(key, file);
    const rawName = file.name.replace(/\.[^.]+$/, '');
    const name = rawName.length > 40 ? rawName.slice(0, 37) + '…' : rawName;
    S.playlist.tracks.push({ key, name });
  }
  saveState();
  renderPlaylistUI();
  showToast(`${files.length} track${files.length > 1 ? 's' : ''} added to playlist`);
  e.target.value = '';
});

syncPlaylistUI();

/* ─────────────────────────────────────────────
   PITCH TRACKING
───────────────────────────────────────────── */
let pendingPitchOutcome = null;

function buildZoneGrid() {
  const grid = document.getElementById('pitchZoneGrid');
  if (!grid || grid.children.length > 0) return;
  const IN_ZONE = new Set([7, 8, 9, 12, 13, 14, 17, 18, 19]);
  for (let i = 1; i <= 25; i++) {
    const btn = document.createElement('button');
    btn.className = `zone-cell ${IN_ZONE.has(i) ? 'zone-in' : 'zone-out'}`;
    btn.dataset.zone = i;
    btn.setAttribute('aria-label', `Zone ${i}`);
    btn.setAttribute('type', 'button');
    btn.addEventListener('click', () => {
      grid.querySelectorAll('.zone-cell').forEach(c => c.classList.remove('zone-selected'));
      btn.classList.add('zone-selected');
    });
    grid.appendChild(btn);
  }
}

function openPitchSheet(outcome) {
  buildZoneGrid();
  const g = S.game;
  pendingPitchOutcome = outcome;
  const badge = document.getElementById('pitchOutcomeBadge');
  badge.textContent = outcome === 'ball' ? 'Ball' : outcome === 'strike' ? 'Strike' : 'Foul';
  badge.className = `pitch-outcome-badge pitch-${outcome}`;
  document.getElementById('pitchPitcherLabel').textContent = g?.pitcher || '—';
  document.getElementById('pitchPcLabel').textContent = `PC: ${g?.pitchCount ?? 0}`;
  document.querySelectorAll('.pitch-type-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('.pitch-type-btn[data-type=""]')?.classList.add('active');
  document.querySelectorAll('.zone-cell').forEach(c => c.classList.remove('zone-selected'));
  document.getElementById('pitchSheetOverlay').classList.remove('hidden');
}

function closePitchSheet() {
  document.getElementById('pitchSheetOverlay').classList.add('hidden');
  pendingPitchOutcome = null;
}

function logPitch() {
  const g = S.game;
  const outcome = pendingPitchOutcome;
  if (!g || !outcome) return;

  const type = document.querySelector('.pitch-type-btn.active')?.dataset.type || '';
  const zone = parseInt(document.querySelector('.zone-cell.zone-selected')?.dataset.zone || '0', 10);

  g.pitchCount = (g.pitchCount || 0) + 1;
  const pc = g.pitchCount;

  g.pitches = g.pitches || [];
  g.pitches.push({ id: `pt_${Date.now()}`, inning: g.inning, half: g.half, pitcherName: g.pitcher, type, zone, outcome, pc });

  const pt = S.pitchTracking || {};
  if (pc === (pt.warnAt ?? 75)) showToast(`Warning: ${g.pitcher || 'Pitcher'} at ${pc} pitches`, 4000);
  if (pc === (pt.alarmAt ?? 100)) showToast(`Alert: ${g.pitcher || 'Pitcher'} at ${pc} pitches — consider change`, 5000);

  closePitchSheet();

  if (outcome === 'ball') {
    g.balls++;
    if (g.balls >= 4) { g.balls = 0; saveState(); renderPitchWorkload(); recordPlay('BB'); return; }
  } else if (outcome === 'strike') {
    g.strikes++;
    if (g.strikes >= 3) { g.strikes = 0; saveState(); renderPitchWorkload(); recordPlay('K'); return; }
  } else if (outcome === 'foul') {
    if (g.strikes < 2) g.strikes++;
  }
  saveState();
  updateAtBatCard();
  renderPitchWorkload();
}

function renderPitchWorkload() {
  const g = S.game;
  const body = document.getElementById('pitchWorkloadBody');
  if (!body) return;
  const pitches = g?.pitches || [];
  if (!pitches.length) {
    body.innerHTML = `<tr><td colspan="4" class="stats-empty">No pitches tracked yet</td></tr>`;
    return;
  }
  const order = [];
  const byName = {};
  for (const p of pitches) {
    if (!byName[p.pitcherName]) {
      byName[p.pitcherName] = { name: p.pitcherName, pc: 0, strikes: 0, balls: 0 };
      order.push(p.pitcherName);
    }
    byName[p.pitcherName].pc++;
    if (p.outcome === 'strike' || p.outcome === 'foul') byName[p.pitcherName].strikes++;
    else if (p.outcome === 'ball') byName[p.pitcherName].balls++;
  }
  body.innerHTML = order.map(name => {
    const pw = byName[name];
    const isCur = name === g.pitcher;
    return `<tr${isCur ? ' class="pitch-current-row"' : ''}>
      <td class="stats-name">${esc(name)}${isCur ? ' <span class="pitch-cur-dot">●</span>' : ''}</td>
      <td>${pw.pc}</td><td>${pw.strikes}</td><td>${pw.balls}</td>
    </tr>`;
  }).join('');
}

function syncPitchUI() {
  const enabled = !!S.pitchTracking?.enabled;
  const toggle = document.getElementById('pitchTrackToggle');
  if (toggle) toggle.checked = enabled;
  const sec = document.getElementById('pitcherSection');
  if (sec) sec.hidden = !enabled;
  const wrap = document.getElementById('pitchWorkloadWrap');
  if (wrap) wrap.hidden = !enabled;
  if (enabled && S.game) {
    const nameEl = document.getElementById('pitcherNameInput');
    if (nameEl && document.activeElement !== nameEl) nameEl.value = S.game.pitcher || '';
    const pcEl = document.getElementById('pitchCountDisplay');
    if (pcEl) pcEl.textContent = S.game.pitchCount ?? 0;
    renderPitchWorkload();
  }
}

document.getElementById('pitchTrackToggle')?.addEventListener('change', e => {
  S.pitchTracking = { ...S.pitchTracking, enabled: e.target.checked };
  saveState();
  syncPitchUI();
});
document.getElementById('pitcherNameInput')?.addEventListener('input', e => {
  if (!S.game) return;
  S.game.pitcher = e.target.value;
  saveState();
  document.getElementById('pitchCountDisplay').textContent = S.game.pitchCount ?? 0;
});
document.getElementById('pitcherChangBtn')?.addEventListener('click', () => {
  if (!S.game) return;
  S.game.pitchCount = 0;
  const nameEl = document.getElementById('pitcherNameInput');
  if (nameEl) { nameEl.value = ''; nameEl.focus(); }
  document.getElementById('pitchCountDisplay').textContent = 0;
  saveState();
  renderPitchWorkload();
  showToast('Pitcher changed — count reset');
});

document.querySelectorAll('.pitch-type-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.pitch-type-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});
document.getElementById('pitchLog')?.addEventListener('click', logPitch);
document.getElementById('pitchSkip')?.addEventListener('click', () => {
  const outcome = pendingPitchOutcome;
  closePitchSheet();
  if (!S.game || !outcome) return;
  const g = S.game;
  if (outcome === 'ball') {
    g.balls++;
    if (g.balls >= 4) { g.balls = 0; recordPlay('BB'); return; }
  } else if (outcome === 'strike') {
    g.strikes++;
    if (g.strikes >= 3) { g.strikes = 0; recordPlay('K'); return; }
  } else if (outcome === 'foul') {
    if (g.strikes < 2) g.strikes++;
  }
  saveState(); updateAtBatCard();
});
document.getElementById('pitchSheetOverlay')?.addEventListener('click', e => {
  if (e.target === document.getElementById('pitchSheetOverlay')) closePitchSheet();
});

/* Soundboard — Web Audio API generated sounds */
document.querySelectorAll('.sound-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const type = btn.dataset.sound;
    btn.classList.add('playing');
    setTimeout(() => btn.classList.remove('playing'), 1000);
    playSound(type);
  });
});

function playMp3(src) {
  const audio = new Audio(src);
  audio.volume = parseFloat(document.getElementById('masterVolume').value);
  audio.play().catch(() => {});
}

function playSound(type) {
  try {
    switch (type) {
      case 'roar':      playMp3('/sounds/roar.mp3');      return;
      case 'horn':      playMp3('/sounds/horn.mp3');      return;
      case 'organ':     playMp3('/sounds/charge.mp3');    return;
      case 'catch':     playMp3('/sounds/catch.mp3');     return;
      case 'foul':      playMp3('/sounds/foul-ball.mp3'); return;
      case 'homerun':   playMp3('/sounds/homerun.mp3');   return;
      case 'nocrying':  playMp3('/sounds/no_crying.mp3'); return;
    }
    // synthesized fallbacks for sounds without MP3s
    const ctx  = getAudioCtx();
    if (ctx.state === 'suspended') ctx.resume();
    const vol  = parseFloat(document.getElementById('masterVolume').value);
    const gain = ctx.createGain();
    gain.connect(masterGain || ctx.destination);
    gain.gain.value = vol;

    switch (type) {
      case 'rally':     playRallyDrum(ctx, gain);     break;
      case 'walkoff':   playWalkOff(ctx, gain);       break;
      case 'strikeout': playKRiff(ctx, gain);         break;
    }
  } catch {}
}

function playCrowdRoar(ctx, dest) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.3;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 800;
  filter.Q.value = 0.5;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, ctx.currentTime);
  env.gain.linearRampToValueAtTime(1, ctx.currentTime + 0.3);
  env.gain.linearRampToValueAtTime(0, ctx.currentTime + 2);
  src.connect(filter); filter.connect(env); env.connect(dest);
  src.start();
}

function playAirHorn(ctx, dest) {
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(220, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(110, ctx.currentTime + 0.8);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.5, ctx.currentTime);
  env.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.9);
  osc.connect(env); env.connect(dest);
  osc.start(); osc.stop(ctx.currentTime + 0.9);
}

function playOrganCharge(ctx, dest) {
  // C4 D4 E4 G4 A4 — charge fanfare
  const notes = [262, 294, 330, 392, 440];
  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = freq;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, ctx.currentTime + i * 0.1);
    env.gain.linearRampToValueAtTime(0.3, ctx.currentTime + i * 0.1 + 0.02);
    env.gain.linearRampToValueAtTime(0, ctx.currentTime + i * 0.1 + 0.18);
    osc.connect(env); env.connect(dest);
    osc.start(ctx.currentTime + i * 0.1);
    osc.stop(ctx.currentTime + i * 0.1 + 0.2);
  });
}

function playRallyDrum(ctx, dest) {
  for (let i = 0; i < 8; i++) {
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.1, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let j = 0; j < data.length; j++) {
      data[j] = (Math.random() * 2 - 1) * Math.exp(-j / (ctx.sampleRate * 0.03));
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(dest);
    src.start(ctx.currentTime + i * 0.12);
  }
}

function playWalkOff(ctx, dest) {
  const chord = [261, 329, 392, 523];
  chord.forEach(freq => {
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.15, ctx.currentTime);
    env.gain.linearRampToValueAtTime(0, ctx.currentTime + 2.5);
    osc.connect(env); env.connect(dest);
    osc.start(); osc.stop(ctx.currentTime + 2.5);
  });
}

function playKRiff(ctx, dest) {
  const notes = [440, 415, 392, 349];
  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = freq;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, ctx.currentTime + i * 0.08);
    env.gain.linearRampToValueAtTime(0.25, ctx.currentTime + i * 0.08 + 0.01);
    env.gain.linearRampToValueAtTime(0, ctx.currentTime + i * 0.08 + 0.14);
    osc.connect(env); env.connect(dest);
    osc.start(ctx.currentTime + i * 0.08);
    osc.stop(ctx.currentTime + i * 0.08 + 0.15);
  });
}

/* ─────────────────────────────────────────────
   SCREEN 5 — SUMMARY
───────────────────────────────────────────── */
function showSummary() {
  stopWalkUp();
  stopPlaylist();
  const g = S.game;
  if (!g) return;

  const usName    = S.team?.name || 'Us';
  const theirName = g.opponent;

  document.getElementById('summaryMatchup').textContent = `vs ${theirName} · ${g.date}`;
  document.getElementById('summaryOurName').textContent   = usName;
  document.getElementById('summaryTheirName').textContent = theirName;
  document.getElementById('summaryOurScore').textContent  = g.score.us;
  document.getElementById('summaryTheirScore').textContent= g.score.them;

  renderBoxScore('summaryBoxscore', 'summaryBoxHead', 'summaryBoxBody');
  renderBattingStats('summaryBattingBody');
  renderSprayCharts('summarySprayContainer');

  // Save this game to season history (deduplicated by game id)
  S.completedGames = S.completedGames || [];
  if (!S.completedGames.find(cg => cg.id === g.id)) {
    S.completedGames.push({
      id: g.id,
      date: g.date,
      opponent: g.opponent,
      score: { ...g.score },
      atBats: g.atBats.map(ab => ({ ...ab })),
    });
    saveState();
  }
  renderSeasonStats('summarySeasonBody');

  navigate('summary');
}

document.getElementById('summaryExportBtn').addEventListener('click', exportPDF);
document.getElementById('newGameBtn').addEventListener('click', () => {
  stopWalkUp();
  stopPlaylist();
  S.game = null;
  saveState();
  navigate('lineup');
  renderLineupScreen();
  document.getElementById('startGameBtn').click();
});
document.getElementById('backToRosterBtn').addEventListener('click', () => {
  S.game = null;
  saveState();
  renderRosterScreen();
  navigate('roster');
});
document.getElementById('summaryBack').addEventListener('click', () => navigate('game'));

/* ─────────────────────────────────────────────
   PDF EXPORT (delegates to scorebook-export.js)
───────────────────────────────────────────── */
function exportPDF() {
  if (typeof generateScorebookPDF === 'function') {
    generateScorebookPDF(buildExportData());
  } else {
    showToast('PDF library not loaded yet — try again in a moment');
  }
}

function buildExportData() {
  const g = S.game;
  const usName    = S.team?.name || 'Us';
  const theirName = g.opponent;
  const date      = g.date;
  const field     = g.field || S.team?.field || '';

  const lineup = S.lineup.map((pid, i) => {
    const p   = playerById(pid);
    const abs = g.atBats.filter(ab => ab.playerId === pid);
    const h   = abs.filter(ab => ['1B','2B','3B','HR'].includes(ab.result)).length;
    const abCount = abs.filter(ab => !['BB','HBP','SAC'].includes(ab.result)).length;
    const bb  = abs.filter(ab => ['BB','HBP'].includes(ab.result)).length;
    const k   = abs.filter(ab => ['K','Kl'].includes(ab.result)).length;
    const r   = abs.reduce((s, ab) => s + (ab.rbi > 0 ? 1 : 0), 0);
    const rbi = abs.reduce((s, ab) => s + (ab.rbi || 0), 0);
    const avg = abCount > 0 ? (h / abCount).toFixed(3).replace(/^0/, '') : '.000';
    return { num: i + 1, name: p?.name || '—', pos: p?.pos || '?', ab: abCount, h, r, rbi, bb, k, avg };
  });

  const atBats = S.lineup.map(pid =>
    Array.from({ length: g.totalInnings }, (_, inning) => {
      const ab = g.atBats.find(a => a.playerId === pid && a.inning === inning + 1 && weAreAtBat(g, inning + 1));
      if (!ab) return null;
      const bases = ['1B','2B','3B','HR'].indexOf(ab.result) + 1;
      return { r: ab.result, b: bases > 0 ? bases : (ab.isOut ? 0 : 1) };
    })
  );

  const weAreHome = g.homeAway === 'home';
  const innings = Array.from({ length: g.totalInnings }, (_, i) => {
    const log = g.inningLog[i];
    // home team runs per inning
    return log ? ((weAreHome ? log.us : log.them) || 0) : 0;
  });
  const awayInnings = Array.from({ length: g.totalInnings }, (_, i) => {
    const log = g.inningLog[i];
    // away team runs per inning
    return log ? ((weAreHome ? log.them : log.us) || 0) : 0;
  });

  return {
    home: g.homeAway === 'home' ? usName : theirName,
    away: g.homeAway === 'away' ? usName : theirName,
    date, field, innings, awayInnings,
    lineup, atBats,
    pitching: [],
  };
}

function weAreAtBat(g, inning) {
  // g.atBats only contains our plate appearances (opponent plays via recordOpponentPlay)
  return true;
}

/* ─────────────────────────────────────────────
   HELPERS
───────────────────────────────────────────── */
function playerById(id) {
  return S.players.find(p => p.id === id) || null;
}

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ─────────────────────────────────────────────
   INIT — Restore state on load
───────────────────────────────────────────── */
bindSeasonSort('seasonStatsHead', 'seasonStatsBody');
bindSeasonSort('summarySeasonHead', 'summarySeasonBody');

(function init() {
  if (S.team) {
    if (S.game) {
      renderGameScreen();
      navigate('game');
      activateTab(weAreBatting() ? 'scorebook' : 'lineup');
    } else {
      renderRosterScreen();
      navigate('roster');
    }
  } else {
    navigate('setup');
  }

  // Handle ?start=game shortcut
  if (new URLSearchParams(location.search).get('start') === 'game' && S.team) {
    renderRosterScreen();
    navigate('roster');
  }
})();
