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
};

let S = loadState();

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULT_STATE, ...JSON.parse(raw) } : { ...DEFAULT_STATE };
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
      <span class="player-audio-badge${p.walkUpKey ? '' : ' hidden'}" aria-label="Has walk-up song">♪</span>
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
  } else {
    document.getElementById('playerSheetTitle').textContent = 'Add Player';
    playerForm.reset();
    playerIdEl.value = '';
    walkUpNameEl.textContent = 'No file';
  }
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
    player.walkUpKey = key;
    player.walkUpName = pendingAudioName;
  }

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
  // Start game: show scorebook panel first
  activateTab('scorebook');
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
  document.getElementById('djOnDeckSong').textContent = onDeckP?.walkUpKey ? '♪ Walk-up loaded' : 'No walk-up';

  // Auto-play walk-up when batter changes
  if (p?.walkUpKey) {
    setTimeout(() => autoPlayWalkUp(p), 200);
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
  showToast(`${g.half === 'bottom' ? 'Bottom' : 'Top'} of inning ${g.inning}`);
}

/* ─── Count buttons ─── */
document.querySelectorAll('.count-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const g = S.game;
    if (!g) return;
    const type = btn.dataset.count;
    if (type === 'ball') {
      g.balls++;
      if (g.balls >= 4) { g.balls = 0; recordPlay('BB'); return; }
    } else if (type === 'strike') {
      g.strikes++;
      if (g.strikes >= 3) { g.strikes = 0; recordPlay('K'); return; }
    } else if (type === 'foul') {
      if (g.strikes < 2) g.strikes++;
    } else {
      g.balls = 0; g.strikes = 0;
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
  saveState();
  updateScoreBar();
  renderLineupRail();
  updateAtBatCard();
  renderBoxScore('boxscoreTable', 'boxscoreHead', 'boxscoreBody');
  renderBattingStats('battingStatsBody');
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

function renderBattingStats(bodyId) {
  const g = S.game;
  if (!g) return;
  const body = document.getElementById(bodyId);
  if (!body) return;

  const rows = S.lineup.map(pid => {
    const p   = playerById(pid);
    const abs = g.atBats.filter(ab => ab.playerId === pid && !['BB','HBP','SAC'].includes(ab.result));
    const bb  = g.atBats.filter(ab => ab.playerId === pid && ['BB','HBP'].includes(ab.result)).length;
    const h   = g.atBats.filter(ab => ab.playerId === pid && ['1B','2B','3B','HR'].includes(ab.result)).length;
    const k   = g.atBats.filter(ab => ab.playerId === pid && ['K','Kl'].includes(ab.result)).length;
    const r   = g.atBats.filter(ab => ab.playerId === pid && ab.rbi > 0).length;
    const rbi = g.atBats.filter(ab => ab.playerId === pid).reduce((s, ab) => s + (ab.rbi || 0), 0);
    const ab  = abs.length;
    const avg = ab > 0 ? (h / ab).toFixed(3).replace(/^0/, '') : '.000';
    return `<tr>
      <td style="text-align:left">${esc(p?.name || '—')}</td>
      <td>${ab}</td>
      <td>${r}</td>
      <td class="${h > 0 ? 'cell-hit' : ''}">${h}</td>
      <td>${rbi}</td>
      <td>${bb}</td>
      <td class="${k > 0 ? 'cell-out' : ''}">${k}</td>
      <td>${avg}</td>
    </tr>`;
  });
  body.innerHTML = rows.join('');
}

/* ─────────────────────────────────────────────
   AUDIO — WALK-UP & SOUNDBOARD
───────────────────────────────────────────── */
let walkUpAudio  = null;
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
}

document.getElementById('masterVolume').addEventListener('input', e => {
  setVolume(parseFloat(e.target.value));
});

async function autoPlayWalkUp(player) {
  if (currentWalkUpPid === player.id) return;
  if (!player.walkUpKey) return;
  currentWalkUpPid = player.id;
  const blob = await loadAudioBlob(player.walkUpKey).catch(() => null);
  if (!blob) return;
  playWalkUpBlob(blob, player);
}

function playWalkUpBlob(blob, player) {
  stopWalkUp();
  const url = URL.createObjectURL(blob);
  walkUpAudio = new Audio(url);
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
    if (p?.walkUpKey) autoPlayWalkUp(p);
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

/* TTS Announcement */
document.getElementById('announceBtn').addEventListener('click', () => {
  if (!('speechSynthesis' in window)) { showToast('TTS not supported on this device'); return; }
  const g = S.game;
  if (!g) return;
  const pid = S.lineup[g.lineupIndex % S.lineup.length];
  const p   = playerById(pid);
  if (!p) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(`Now batting, number ${p.number}, ${p.name}`);
  utter.rate  = 0.9;
  utter.pitch = 0.9;
  window.speechSynthesis.speak(utter);
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

function playSound(type) {
  try {
    const ctx  = getAudioCtx();
    if (ctx.state === 'suspended') ctx.resume();
    const vol  = parseFloat(document.getElementById('masterVolume').value);
    const gain = ctx.createGain();
    gain.connect(masterGain || ctx.destination);
    gain.gain.value = vol;

    switch (type) {
      case 'roar':      playCrowdRoar(ctx, gain);    break;
      case 'horn':      playAirHorn(ctx, gain);       break;
      case 'organ':     playOrganCharge(ctx, gain);   break;
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

  navigate('summary');
}

document.getElementById('summaryExportBtn').addEventListener('click', exportPDF);
document.getElementById('newGameBtn').addEventListener('click', () => {
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

  const innings = Array.from({ length: g.totalInnings }, (_, i) => {
    const log = g.inningLog[i];
    return log ? (log.bottom || 0) : 0;
  });
  const awayInnings = Array.from({ length: g.totalInnings }, (_, i) => {
    const log = g.inningLog[i];
    return log ? (log.top || 0) : 0;
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
  return g.homeAway === 'home';
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
(function init() {
  if (S.team) {
    if (S.game) {
      renderGameScreen();
      navigate('game');
      activateTab('scorebook');
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
