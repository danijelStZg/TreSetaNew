// ===================== CONFIG =====================
const AKUZI = [
  { key:'napola',   name:'Napola',                          pts:3, hint:'3 ase/dvojke/trojke iste boje' },
  { key:'tresete',  name:'Tri trojke, dvojke ili asa',      pts:3, hint:'3 iste karte različitih boja' },
  { key:'quattro',  name:'Četiri trojke, dvojke ili asa',   pts:4, hint:'Sve 4 karte istog ranga' },
];
const DEFAULT_TARGET = 41;
const SAVE_KEY   = 'treseta_saves_v2';
const AUTO_KEY   = 'treseta_auto_v2';
const NAMES_KEY  = 'treseta_names_v1';
const APP_VERSION = '1.43';

// ===================== STATE =====================
let G = null; // game state
let draft = null;
let akuzTeam = 0;

// Target bodova za pobjedu jedne partije (koristi se svugdje umjesto starog TARGET)
function targetScore() {
  return (G && G.targetScore) || DEFAULT_TARGET;
}
function winsNeeded() {
  return (G && G.winsNeeded) || 1;
}

function blankDraft(teamCount, playerCount) {
  return {
    punti: Array(teamCount).fill(''),
    akuzi: Array(playerCount).fill(null).map(() => ({})),
  };
}

// Jedinstveni ID koji prati JEDNU partiju/meč kroz cijeli životni vijek
// (koristi se da pauziranje/spremanje uvijek ažurira ISTI zapis, bez dupliciranja)
function genSaveId() {
  return 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ===================== SPREMLJENA IMENA =====================
function getSavedNames() {
  try { return JSON.parse(localStorage.getItem(NAMES_KEY) || '[]'); } catch { return []; }
}
// Abecedno sortiranje (hrvatska lokalizacija, uzlazno po prvom slovu)
function sortNamesAlpha(list) {
  return [...list].sort((a,b)=> a.localeCompare(b, 'hr', {sensitivity:'base'}));
}
function getSavedNamesAlpha() {
  return sortNamesAlpha(getSavedNames());
}
function rememberNames(names) {
  try {
    let list = getSavedNames();
    names.forEach(n => {
      n = (n||'').trim();
      if (!n) return;
      list = list.filter(x => x.toLowerCase() !== n.toLowerCase());
      list.unshift(n);
    });
    if (list.length > 24) list.length = 24;
    localStorage.setItem(NAMES_KEY, JSON.stringify(list));
  } catch(e) {}
}

function setSavedNamesList(list) {
  try { localStorage.setItem(NAMES_KEY, JSON.stringify(list)); } catch(e) {}
}

// ---- CRUD popisa igrača (meni "Igrači") ----
function addPlayerToRoster(name) {
  name = (name||'').trim();
  if (!name) { showToast('Upiši ime igrača'); return false; }
  const list = getSavedNames();
  if (list.some(n => n.toLowerCase() === name.toLowerCase())) {
    showToast('Igrač s tim imenom već postoji');
    return false;
  }
  list.unshift(name);
  setSavedNamesList(list);
  return true;
}

function renamePlayerInRoster(oldName, newName) {
  newName = (newName||'').trim();
  if (!newName) { showToast('Ime ne može biti prazno'); return false; }
  const list = getSavedNames();
  if (list.some(n => n.toLowerCase() === newName.toLowerCase() && n.toLowerCase() !== oldName.toLowerCase())) {
    showToast('Igrač s tim imenom već postoji');
    return false;
  }
  setSavedNamesList(list.map(n => n === oldName ? newName : n));
  return true;
}

function deletePlayerFromRoster(name) {
  setSavedNamesList(getSavedNames().filter(n => n !== name));
}

function newGame(mode, names, opts) {
  opts = opts || {};
  const teamCount = names.length;
  G = {
    saveId: genSaveId(),
    mode,
    teams: names.map((n,i) => ({ id:i, name:n, score:0 })),
    rounds: [],
    targetScore: opts.targetScore || DEFAULT_TARGET,
    winsNeeded: opts.winsNeeded || 1,
    lowWins: !!opts.lowWins,
    matchWins: Array(teamCount).fill(0),
    matchHistory: [], // niz odigranih partija unutar meča: {teams:[{name,score}], winnerIdx}
  };
  draft = blankDraft(tc(), pc());
  akuzTeam = 0;
  for (const k in _prevScores) delete _prevScores[k];
  render();
  autoSave();
}

// Popuni nedostajuća polja za starije spremljene partije (prije uvođenja meč-moda)
function normalizeGame(g) {
  if (!g) return g;
  if (!g.saveId) g.saveId = genSaveId();
  if (!g.targetScore) g.targetScore = DEFAULT_TARGET;
  if (!g.winsNeeded) g.winsNeeded = 1;
  if (typeof g.lowWins !== 'boolean') g.lowWins = false;
  if (!Array.isArray(g.matchWins)) g.matchWins = g.teams.map(()=>0);
  if (!Array.isArray(g.matchHistory)) g.matchHistory = [];
  return g;
}

// Priprema sljedeće partije unutar istog meča (isti igrači, resetiraju se bodovi runde)
function nextGameInMatch() {
  G.teams.forEach(t => t.score = 0);
  G.rounds = [];
  draft = blankDraft(tc(), pc());
  akuzTeam = 0;
  for (const k in _prevScores) delete _prevScores[k];
  render();
  autoSave();
}

// Number of teams (= scoreboard cards and punti inputs)
function tc() {
  // If we have actual teams array, use its length (most reliable, handles legacy saves)
  if (G && G.teams && G.teams.length) return G.teams.length;
  // Fallback to mode interpretation
  if (G.mode === 'pairs') return 2;
  if (G.mode === '4') return 4;
  if (G.mode === 4) return 2; // legacy: numeric 4 meant pairs (2 teams)
  if (G.mode === '3' || G.mode === 3) return 3;
  return 2;
}

// Number of akuzi entries (= akuzi tabs)
// Always equal to team count — even in pairs, akuze are tracked per team.
function pc() {
  return tc();
}

// Returns true if pairs mode (4 players, 2 teams)
function isPairs() {
  return G && (G.mode === 'pairs' || G.mode === 4);
}

// Map akuzi-entry index → team index (1:1 in current model)
function playerToTeam(playerIdx) {
  return playerIdx;
}

// Get display name for akuzi tab — just the team/player name
function playerName(playerIdx) {
  return G.teams[playerIdx].name;
}

// ===================== AKUŽI LIMIT LOGIKA =====================
// Fizički limit: postoje 3 ranga (As, 2, 3), svaki sa 4 karte u špilu.
// Svaki rang može generirati najviše JEDNU akužu po rundi (napola ILI 3× ILI 4×).
// Stoga je ukupan broj svih akuža (zbroj kroz sve igrače) ograničen na 3.
// Funkcija vraća true ako je trenutno povećanje akuze dozvoljeno.
function akuziTotalCount() {
  let total = 0;
  draft.akuzi.forEach(pAk => {
    AKUZI.forEach(ak => { total += (pAk[ak.key] || 0); });
  });
  return total;
}

function canAddAkuza() {
  return true;
}
// ===============================================================

function autoSave() {
  if (!G) return;
  try { localStorage.setItem(AUTO_KEY, JSON.stringify(G)); } catch(e) {}
}
function clearAuto() { try { localStorage.removeItem(AUTO_KEY); } catch(e) {} }
function loadAuto() { try { return JSON.parse(localStorage.getItem(AUTO_KEY)||'null'); } catch { return null; } }
function getSaves() { try { return JSON.parse(localStorage.getItem(SAVE_KEY)||'[]'); } catch { return []; } }
function setSaves(a) { try { localStorage.setItem(SAVE_KEY, JSON.stringify(a)); } catch(e) {} }

// Automatsko spremanje završene partije (jedinstven naziv s datumom)
function autoSaveFinished() {
  if (!G.saveId) G.saveId = genSaveId();
  const d = new Date();
  const p = n => String(n).padStart(2,'0');
  const dateStr = `${p(d.getDate())}.${p(d.getMonth()+1)}.${d.getFullYear()}`;
  const baseName = `${G.teams.map(t=>t.name).join(' vs ')} — ${dateStr}`.slice(0, 90);
  // Ukloni eventualni raniji (pauzirani) zapis ISTE partije/meča da se ne duplicira
  const saves = getSaves().filter(s => !(s.state && s.state.saveId === G.saveId));
  let name = baseName;
  let n = 2;
  while (saves.some(s => s.name === name)) {
    name = `${baseName} (${n})`;
    n++;
  }
  const entry = {
    name,
    ts: Date.now(),
    state: JSON.parse(JSON.stringify({ ...G, finished: true })),
  };
  saves.unshift(entry);
  if (saves.length > 30) saves.length = 30;
  setSaves(saves);
}

// Pauziraj trenutnu (nedovršenu) partiju - sprema je u popis za kasniji nastavak
// i oslobađa aktivnu partiju tako da odmah može započeti (i završiti) nova.
// Ako je ista partija/meč (isti saveId) već ranije pauzirana, AŽURIRA taj isti zapis
// umjesto da stvara novi (spriječava dupliciranje pri ponovnom pauziranju).
function pauseCurrentGame() {
  if (!G) return;
  if (!G.saveId) G.saveId = genSaveId();
  const saves = getSaves();
  const existingIdx = saves.findIndex(s => s.state && s.state.saveId === G.saveId);
  let name;
  if (existingIdx >= 0) {
    name = saves[existingIdx].name;
  } else {
    const d = new Date();
    const p = n => String(n).padStart(2,'0');
    const dateStr = `${p(d.getDate())}.${p(d.getMonth()+1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
    const baseName = `${G.teams.map(t=>t.name).join(' vs ')} — pauzirano ${dateStr}`.slice(0, 90);
    let candidate = baseName;
    let n = 2;
    while (saves.some(s => s.name === candidate)) {
      candidate = `${baseName} (${n})`;
      n++;
    }
    name = candidate;
  }
  const entry = {
    name,
    ts: Date.now(),
    state: JSON.parse(JSON.stringify({ ...G, finished: false })),
  };
  if (existingIdx >= 0) saves[existingIdx] = entry; else saves.unshift(entry);
  if (saves.length > 30) saves.length = 30;
  setSaves(saves);
  clearAuto();
  G = null;
}

// ===================== RENDER =====================
function render() {
  renderScoreboard();
  renderPunti();
  renderSumHint();
  document.getElementById('hdrRound').textContent = `R${G.rounds.length + 1}`;
  document.getElementById('hdrLowWins').style.display = G.lowWins ? '' : 'none';
  const hb = document.getElementById('historyBtn');
  hb.title = G.rounds.length ? `Povijest (${G.rounds.length})` : 'Povijest';
  hb.dataset.count = G.rounds.length || '';
}

// ===================== FAZA 1: ANIMACIJA BROJKI =====================
const _prevScores = {}; // team.id -> zadnji PRIKAZANI broj (za count-up animaciju)
function animateScoreNumber(el, from, to, duration) {
  if (from === to) { el.textContent = to; return; }
  const start = performance.now();
  duration = duration || 500;
  function tick(now) {
    const p = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(from + (to - from) * eased);
    if (p < 1) requestAnimationFrame(tick);
    else el.textContent = to;
  }
  requestAnimationFrame(tick);
}

function renderScoreboard() {
  const sb = document.getElementById('scoreboard');
  const n = tc();
  sb.className = 'scoreboard ' + (n === 4 ? 't4' : n === 3 ? 't3' : 't2');
  const max = Math.max(...G.teams.map(t => t.score));
  const min = Math.min(...G.teams.map(t => t.score));
  sb.innerHTML = '';
  G.teams.forEach(t => {
    const T = targetScore();
    let cls;
    if (G.lowWins) {
      const isDanger = t.score >= T;
      const isLead = !isDanger && t.score === min && G.teams.filter(x=>x.score===min).length===1;
      cls = isDanger ? 'danger' : isLead ? 'leading' : '';
    } else {
      const isWin = t.score >= T && t.score === Math.max(...G.teams.filter(x=>x.score>=T).map(x=>x.score));
      const isLead = !isWin && t.score === max && max > 0 && G.teams.filter(x=>x.score===max).length===1;
      cls = isWin ? 'winning' : isLead ? 'leading' : '';
    }
    const pct = Math.min(100, t.score / T * 100);
    const card = document.createElement('div');
    card.className = `score-card ${cls}`;
    const mw = (G.matchWins && G.matchWins[t.id]) || 0;
    const wn = winsNeeded();
    let progressRow = '';
    if (wn > 1) {
      let dots = '';
      for (let d = 0; d < wn; d++) {
        dots += `<span class="sc-dot${d < mw ? ' filled' : ''}"></span>`;
      }
      progressRow = `<div class="sc-progress-row">${dots}<span class="sc-progress-ratio">${mw}/${wn}</span></div>`;
    }
    const prevVal = Object.prototype.hasOwnProperty.call(_prevScores, t.id) ? _prevScores[t.id] : t.score;
    card.innerHTML = `
      ${progressRow}
      <div class="sc-name">${esc(t.name)}</div>
      <div class="sc-score" id="scNum-${t.id}">${prevVal}</div>
      <div class="sc-of">/ ${T}</div>
      <div class="progress"><div class="progress-fill" style="width:${pct}%"></div></div>
    `;
    sb.appendChild(card);
    const numEl = card.querySelector('.sc-score');
    if (prevVal !== t.score) {
      animateScoreNumber(numEl, prevVal, t.score);
      numEl.classList.add('bump');
      setTimeout(() => numEl.classList.remove('bump'), 400);
    }
    _prevScores[t.id] = t.score;
  });
}

function renderPunti() {
  const row = document.getElementById('puntiRow');
  const n = tc();
  row.className = 'punti-row ' + (n === 4 ? 't4' : n === 3 ? 't3' : 't2');
  row.innerHTML = '';
  G.teams.forEach((t, i) => {
    const total = akuzeTotalForTeam(i);
    const sign = G.lowWins ? '−' : '+';
    const isEmpty = draft.punti[i] === '';
    const f = document.createElement('div');
    f.className = 'punti-field';
    f.innerHTML = `
      <div class="pf-label">${esc(t.name)}</div>
      <button type="button" class="pf-akuza-badge${total?' has':''}" id="pf-akuza-${i}">${total ? sign+total : '+'}</button>
      <button type="button" class="pf-input${isEmpty?' empty':''}" id="pi-${i}">${isEmpty ? '0' : draft.punti[i]}</button>
    `;
    row.appendChild(f);
  });
  G.teams.forEach((_, i) => {
    document.getElementById(`pi-${i}`).addEventListener('click', () => openPuntiKeypad(i));
    document.getElementById(`pf-akuza-${i}`).addEventListener('click', () => openAkuzaModal(i));
  });
}

// ===================== TIPKOVNICA ZA PUNTE (0-11) =====================
let puntiKeypadTeam = 0;
function openPuntiKeypad(i) {
  puntiKeypadTeam = i;
  document.getElementById('puntiKeypadTitle').textContent = `Punte — ${G.teams[i].name}`;
  renderPuntiKeypad();
  openM('puntiKeypadModal');
}

// Jesu li SVA polja za punte ove runde već popunjena (potpun set)?
function isPuntiSetComplete() {
  const n = tc();
  for (let k = 0; k < n; k++) {
    if (draft.punti[k] === '' || draft.punti[k] == null) return false;
  }
  return true;
}

function renderPuntiKeypad() {
  const grid = document.getElementById('puntiKeypadGrid');
  grid.innerHTML = '';
  const n = tc();
  const i = puntiKeypadTeam;
  const setComplete = isPuntiSetComplete();
  let maxAllowed = 11;
  // Ograniči izbor SAMO dok se set prvi put popunjava (n>2, još ima praznih polja).
  // Kod 2 igrača, ili kad se ispravlja VEĆ potpuno popunjen set, uvijek nudi puni raspon
  // (jer izmjena povlači ponovni izračun/reset ostalih polja).
  if (n > 2 && !setComplete) {
    let sumOthers = 0;
    for (let k = 0; k < n; k++) {
      if (k === i) continue;
      const v = parseInt(draft.punti[k]);
      if (!isNaN(v)) sumOthers += v;
    }
    maxAllowed = Math.max(0, 11 - sumOthers);
  }
  for (let v = 0; v <= 11; v++) {
    const btn = document.createElement('button');
    btn.type = 'button';
    const disabled = v > maxAllowed;
    btn.className = 'keypad-btn' + (v === 11 ? ' kapot' : '') + (disabled ? ' disabled' : '');
    btn.textContent = v === 11 ? '11 ★' : String(v);
    btn.disabled = disabled;
    btn.onclick = () => {
      if (disabled) return;
      selectPuntiValue(i, v);
    };
    grid.appendChild(btn);
  }
}

// Primijeni odabranu vrijednost. Ako je set (3+ igrača) već bio potpuno popunjen
// i korisnik bira DRUGI broj (ispravlja pogrešku), briše bodove SVIH OSTALIH polja
// da ih korisnik ponovno unese (uz ograničenu/zasivljenu tipkovnicu kao inače),
// a zadnje preostalo polje se opet automatski izračuna.
function selectPuntiValue(i, v) {
  const n = tc();
  const wasComplete = isPuntiSetComplete();
  const oldVal = draft.punti[i];
  const newVal = String(v);

  if (n > 2 && wasComplete && oldVal !== newVal) {
    for (let k = 0; k < n; k++) {
      if (k !== i) draft.punti[k] = '';
    }
    draft.punti[i] = newVal;
  } else {
    draft.punti[i] = newVal;
    autoFillLast(i);
  }

  closeM('puntiKeypadModal');
  renderPunti();
  renderSumHint();
}
document.getElementById('puntiKeypadModal').addEventListener('click', e => {
  if (e.target.id === 'puntiKeypadModal') closeM('puntiKeypadModal');
});

// ===================== TIPKOVNICA ZA CILJ BODOVA / BROJ PARTIJA =====================
function openNumKeypad(btnId, title, options) {
  const btn = document.getElementById(btnId);
  const current = parseInt(btn.dataset.value) || 0;
  document.getElementById('numKeypadTitle').textContent = title;
  const grid = document.getElementById('numKeypadGrid');
  grid.innerHTML = '';
  options.forEach(v => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'keypad-btn' + (v === current ? ' kapot' : '');
    b.textContent = String(v);
    b.onclick = () => {
      btn.dataset.value = String(v);
      btn.textContent = String(v);
      closeM('numKeypadModal');
    };
    grid.appendChild(b);
  });
  openM('numKeypadModal');
}
document.getElementById('targetInput').addEventListener('click', () => {
  openNumKeypad('targetInput', 'Cilj bodova', [11, 21, 31, 41, 51, 61]);
});
document.getElementById('winsInput').addEventListener('click', () => {
  openNumKeypad('winsInput', 'Broj partija', [1,2,3,4,5,6,7,8,9,10,11,12]);
});
document.getElementById('numKeypadModal').addEventListener('click', e => {
  if (e.target.id === 'numKeypadModal') closeM('numKeypadModal');
});

function updatePuntiAkuzaBadge(i) {
  const badge = document.getElementById(`pf-akuza-${i}`);
  if (!badge) return;
  const total = akuzeTotalForTeam(i);
  const sign = G.lowWins ? '−' : '+';
  badge.textContent = total ? `${sign}${total}` : '+';
  badge.classList.toggle('has', total > 0);
}

// Automatski izračunaj PREOSTALO polje kao 11 - zbroj svih ostalih, čim je točno JEDNO polje prazno
// (radi za bilo koju kombinaciju popunjenih polja, ne samo redom 1,2,3...).
// Kod 2 igrača ostaje simetrično: unos u bilo koje polje uvijek prepisuje ono drugo.
function autoFillLast(changedIdx) {
  const n = tc();
  if (n < 2) return;

  if (n === 2) {
    const v = parseInt(draft.punti[changedIdx]);
    if (isNaN(v) || v < 0 || v > 11) return;
    const other = 1 - changedIdx;
    draft.punti[other] = String(11 - v);
    return;
  }

  const emptyIdxs = [];
  let sum = 0;
  for (let k = 0; k < n; k++) {
    const v = parseInt(draft.punti[k]);
    if (isNaN(v)) { emptyIdxs.push(k); continue; }
    sum += v;
  }
  if (emptyIdxs.length === 1) {
    const remaining = 11 - sum;
    if (remaining >= 0 && remaining <= 11) {
      draft.punti[emptyIdxs[0]] = String(remaining);
    }
  }
}

function renderSumHint() {
  const hint = document.getElementById('sumHint');
  const sum = draft.punti.reduce((a,v)=>a+(parseInt(v)||0),0);
  const allEmpty = draft.punti.every(v=>v===''||v==null);
  if (allEmpty) { hint.textContent = 'UKUPNO MORA BITI 11 PUNATA'; hint.className='sum-hint'; return; }
  if (sum===11) { hint.textContent = '✓  ZBROJ: 11'; hint.className='sum-hint ok'; }
  else if (sum<11) { hint.textContent = `ZBROJ: ${sum}  —  FALI ${11-sum}`; hint.className='sum-hint under'; }
  else { hint.textContent = `ZBROJ: ${sum}  —  VIŠAK ${sum-11}!`; hint.className='sum-hint over'; }
  if (G.lowWins && draft.punti.some(v=>parseInt(v)===11)) {
    hint.textContent += '  ·  🔻 KAPOT: ide na −11';
  }
}

// ===================== AKUŽE (popup preko oznake iznad punata) =====================
function akuzeTotalForTeam(i) {
  const teamAk = draft.akuzi[i] || {};
  return AKUZI.reduce((s, ak) => s + (teamAk[ak.key]||0)*ak.pts, 0);
}

function openAkuzaModal(i) {
  akuzTeam = i;
  document.getElementById('akuzaModalTitle').innerHTML = `AKU<span class="accent">ŽE</span> — ${esc(playerName(i))}`;
  renderAkuzaModalItems();
  openM('akuzaModal');
}

function renderAkuzaModalItems() {
  const wrap = document.getElementById('akuzaModalItems');
  wrap.innerHTML = '';
  const teamAk = draft.akuzi[akuzTeam] || {};

  AKUZI.forEach(ak => {
    const cnt = teamAk[ak.key] || 0;
    const div = document.createElement('div');
    div.className = 'akuz-item';
    div.innerHTML = `
      <div class="ai-info">
        <div class="ai-name">${ak.name}</div>
        <div class="ai-hint">${ak.hint}</div>
        <span class="ai-pts">+${ak.pts} bod${ak.pts>1?'a':''}</span>
      </div>
      <div class="ai-counter">
        <button class="ai-btn" data-d="-1" ${cnt === 0 ? 'disabled' : ''}>−</button>
        <div class="ai-num">${cnt}</div>
        <button class="ai-btn" data-d="1">+</button>
      </div>
    `;
    div.querySelectorAll('.ai-btn').forEach(btn => {
      btn.onclick = () => {
        if (btn.disabled) return;
        const d = parseInt(btn.dataset.d);
        teamAk[ak.key] = Math.max(0, (teamAk[ak.key]||0) + d);
        if (!teamAk[ak.key]) delete teamAk[ak.key];
        draft.akuzi[akuzTeam] = teamAk;
        renderAkuzaModalItems();
        updatePuntiAkuzaBadge(akuzTeam);
      };
    });
    wrap.appendChild(div);
  });
}

document.getElementById('akuzaModalClose').onclick = () => closeM('akuzaModal');
document.getElementById('undoSnackbarBtn').onclick = undoLastRound;

// ===================== HISTORY SHEET =====================
// Generira HTML redaka povijesti (dijeli ga i uživo prikaz i read-only prikaz gotovih partija)
function buildHistoryRowsHTML(teams, rounds, lowWins, readOnly) {
  let out = '';
  rounds.forEach((r, idx) => {
    let lines = '';
    teams.forEach((t, i) => {
      const p = r.punti[i]||0;
      const a = r.akuzPts[i]||0;
      const delta = Array.isArray(r.scoreDelta) ? r.scoreDelta[i] : p+a;
      const akNote = descAk(r.akuzi[i]||{});
      let detail = '';
      if (lowWins) {
        const scoredP = (p === 11) ? -11 : p;
        if (a || scoredP !== p) {
          detail = ` <small style="color:var(--gold);font-weight:600;">(${scoredP}${a?` − ${a}`:''})</small>`;
        }
      } else if (a) {
        detail = ` <small style="color:var(--gold);font-weight:600;">(${p}+${a})</small>`;
      }
      lines += `<div class="hist-line">
        <span class="hist-name">${esc(t.name)}</span>
        <span class="hist-pts"${delta<0?' style="color:var(--red);"':''}>${delta}${detail}</span>
      </div>`;
      if (akNote) lines += `<div class="hist-akuzi">${esc(t.name)}: ${akNote}${lowWins?' (u minus)':''}</div>`;
    });
    out += `<div class="hist-row" data-idx="${idx}">
      <div class="hist-num">${idx+1}</div>
      <div class="hist-content">${lines}</div>
      ${readOnly ? '<div></div>' : '<button class="hist-del" title="Obriši">✕</button>'}
    </div>`;
  });
  return out;
}

function openHistory() {
  renderHistory();
  openSheet('histSheet','histOverlay');
}

function renderHistory() {
  const body = document.getElementById('histBody');
  body.innerHTML = '';
  if (!G.rounds.length) {
    body.innerHTML = '<div class="empty-hist">Nema odigranih rundi</div>';
    return;
  }
  body.innerHTML = buildHistoryRowsHTML(G.teams, G.rounds, G.lowWins, false);
  body.querySelectorAll('.hist-row[data-idx] .hist-del').forEach(btn => {
    const idx = parseInt(btn.closest('.hist-row').dataset.idx);
    btn.onclick = () => deleteRound(idx);
  });
  // Total row
  const tot = document.createElement('div');
  tot.className = 'hist-row hist-total';
  let tLines = '';
  G.teams.forEach(t => {
    tLines += `<div class="hist-line">
      <span class="hist-name">${esc(t.name)}</span>
      <span class="hist-pts" style="color:var(--red);">${t.score}</span>
    </div>`;
  });
  tot.innerHTML = `<div class="hist-num">Σ</div><div class="hist-content">${tLines}</div><div></div>`;
  body.appendChild(tot);
}

function descAk(obj) {
  return AKUZI.filter(ak=>obj[ak.key]).map(ak=>`${obj[ak.key]>1?obj[ak.key]+'× ':''}${ak.name}`).join(', ');
}

function deleteRound(idx) {
  closeSheet('histSheet','histOverlay');
  openConfirm({
    title:'Obriši rundu?',
    msg:`Obrisati rundu ${idx+1}? Bodovi će se preračunati.`,
    onOk:()=>{
      const r = G.rounds[idx];
      G.teams.forEach((t,i)=>{
        const delta = Array.isArray(r.scoreDelta) ? r.scoreDelta[i] : (r.punti[i]||0)+(r.akuzPts[i]||0);
        t.score -= (delta||0);
      });
      G.rounds.splice(idx,1);
      render(); autoSave(); showToast('Runda obrisana');
    }
  });
}

// ===================== ADD ROUND =====================
// Aggregate per-player akuzi → per-team akuzi (for points calculation)
function aggregateAkuziToTeams() {
  const teamCount = tc();
  const result = []; // per team: { napola: n, tresete: n, quattro: n }
  for (let t = 0; t < teamCount; t++) {
    const agg = {};
    AKUZI.forEach(ak => { agg[ak.key] = 0; });
    draft.akuzi.forEach((pAk, pIdx) => {
      if (playerToTeam(pIdx) !== t) return;
      AKUZI.forEach(ak => { agg[ak.key] += (pAk[ak.key] || 0); });
    });
    result.push(agg);
  }
  return result;
}

function calcRoundTotals() {
  const teamAkuzi = aggregateAkuziToTeams();
  return G.teams.map((_,i)=>{
    const p = parseInt(draft.punti[i])||0;
    let a = 0;
    AKUZI.forEach(ak=>{ a+=(teamAkuzi[i][ak.key]||0)*ak.pts; });
    let scoreDelta;
    if (G.lowWins) {
      // "Tko manje": akuže idu u minus, a kapot (svih 11 punata) se bilježi kao -11
      const scoredP = (p === 11) ? -11 : p;
      scoreDelta = scoredP - a;
    } else {
      scoreDelta = p + a;
    }
    return {punti:p, akuzPts:a, total:scoreDelta, akuziDetail: teamAkuzi[i]};
  });
}

function addRound() {
  const totals = calcRoundTotals();
  const sum = totals.reduce((a,t)=>a+t.punti,0);
  const anyVal = totals.some(t=>t.punti>0 || t.akuzPts>0);
  if (!anyVal) { showToast('Unesi punte ili akuže'); return; }
  if (sum > 11) { showToast(`Zbroj je ${sum} — ne može biti više od 11`); return; }
  if (sum < 11 && sum > 0) {
    openConfirm({
      title:'Zbroj nije 11',
      msg:`Ukupno je ${sum} punata — trebalo bi biti 11. Svejedno spremi?`,
      onOk:()=>commitRound(totals)
    });
    return;
  }
  commitRound(totals);
}

function commitRound(totals) {
  G.rounds.push({
    punti: totals.map(t=>t.punti),
    akuzPts: totals.map(t=>t.akuzPts),
    scoreDelta: totals.map(t=>t.total),
    akuzi: totals.map(t=>({...t.akuziDetail})), // per-team aggregated
  });
  G.teams.forEach((t,i)=>{ t.score+=totals[i].total; });
  draft = blankDraft(tc(), pc());
  akuzTeam = 0;
  render();
  autoSave();
  if (totals.some(t => t.punti === 11)) playKapotSound();
  const winners = G.teams.filter(t=>t.score>=targetScore());
  if (winners.length) {
    setTimeout(handleGameEnd, 500);
  } else {
    showUndoSnackbar(G.rounds.length);
  }
}

// ===================== FAZA 2: DIJELI REZULTAT =====================
function buildShareData() {
  const wn = winsNeeded();
  let rows;
  if (wn > 1) {
    const sorted = [...G.teams].sort((a,b) => (G.matchWins[b.id]||0) - (G.matchWins[a.id]||0));
    rows = sorted.map(t => ({ name: t.name, score: (G.matchWins[t.id]||0), suffix: (G.matchWins[t.id]||0) === 1 ? 'partija' : 'partije' }));
  } else {
    rows = [...G.teams].sort((a,b) => G.lowWins ? a.score - b.score : b.score - a.score).map(t => ({ name: t.name, score: t.score, suffix: '' }));
  }
  const winnerName = (document.getElementById('winnerName') || {}).textContent || (rows[0] && rows[0].name) || '';
  return { rows, winnerName, roundsCount: G.rounds.length };
}

function buildShareText(data) {
  const lines = [`🏆 TREŠETA — pobjednik: ${data.winnerName}`, ''];
  data.rows.forEach((r, i) => lines.push(`${i+1}. ${r.name} — ${r.score}${r.suffix ? ' ' + r.suffix : ''}`));
  lines.push('', `${data.roundsCount} rundi odigrano`);
  return lines.join('\n');
}

function drawResultCanvas(data) {
  const w = 640, h = 120 + data.rows.length * 64 + 90;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');

  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, '#2a3150');
  grad.addColorStop(1, '#1e2435');
  ctx.fillStyle = grad;
  roundRectPath(ctx, 0, 0, w, h, 22);
  ctx.fill();

  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 34px Arial, sans-serif';
  ctx.fillText('TREŠETA — rezultat', w/2, 56);

  let y = 100;
  data.rows.forEach((r, i) => {
    const isWinner = i === 0;
    ctx.textAlign = 'left';
    ctx.fillStyle = isWinner ? '#ffffff' : '#b0bacf';
    ctx.font = (isWinner ? '700 ' : '600 ') + '22px Arial, sans-serif';
    ctx.fillText((isWinner ? '🏆 ' : '') + r.name, 32, y + 30);
    ctx.textAlign = 'right';
    ctx.fillStyle = isWinner ? '#ffc54d' : '#e6e9f0';
    ctx.font = '700 30px Arial, sans-serif';
    ctx.fillText(String(r.score), w - 32, y + 32);
    if (i < data.rows.length - 1) {
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.beginPath(); ctx.moveTo(32, y + 52); ctx.lineTo(w - 32, y + 52); ctx.stroke();
    }
    y += 64;
  });

  ctx.textAlign = 'center';
  ctx.fillStyle = '#7a85a0';
  ctx.font = '500 16px Arial, sans-serif';
  ctx.fillText(`${data.roundsCount} rundi odigrano`, w/2, h - 26);

  return canvas;
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.arcTo(x+w, y, x+w, y+h, r);
  ctx.arcTo(x+w, y+h, x, y+h, r);
  ctx.arcTo(x, y+h, x, y, r);
  ctx.arcTo(x, y, x+w, y, r);
  ctx.closePath();
}

async function shareMatchResult() {
  if (!G) return;
  const data = buildShareData();
  const text = buildShareText(data);
  let blob = null;
  try {
    const canvas = drawResultCanvas(data);
    blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
  } catch (e) { blob = null; }

  try {
    if (blob && navigator.canShare) {
      const file = new File([blob], 'treseta-rezultat.png', { type: 'image/png' });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Trešeta — rezultat', text });
        return;
      }
    }
    if (navigator.share) {
      await navigator.share({ title: 'Trešeta — rezultat', text });
      return;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return; // korisnik odustao — ne radi ništa dalje
  }

  // Fallback bez Web Share API-ja: preuzmi sliku (ako je uspjela) i kopiraj tekst
  try {
    if (blob) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'treseta-rezultat.png';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      showToast(blob ? 'Slika preuzeta, tekst kopiran ✓' : 'Rezultat kopiran u međuspremnik');
    } else {
      showToast(blob ? 'Slika preuzeta ✓' : 'Dijeljenje nije podržano na ovom uređaju');
    }
  } catch (e) {
    showToast('Dijeljenje nije uspjelo');
  }
}

// ===================== FAZA 2: BRZI UNDO =====================
let _undoHideTimer = null;
function showUndoSnackbar(roundNum) {
  const bar = document.getElementById('undoSnackbar');
  if (!bar) { showToast('Runda zapisana ✓'); return; }
  clearTimeout(_undoHideTimer);
  document.getElementById('undoSnackbarText').innerHTML = `Runda <b>${roundNum}</b> spremljena`;
  const timerEl = document.getElementById('undoSnackbarTimer');
  bar.classList.remove('show');
  void bar.offsetWidth; // restart animacije
  bar.classList.add('show');
  timerEl.style.transition = 'none';
  timerEl.style.width = '100%';
  requestAnimationFrame(() => {
    timerEl.style.transition = 'width 4.2s linear';
    timerEl.style.width = '0%';
  });
  _undoHideTimer = setTimeout(hideUndoSnackbar, 4200);
}
function hideUndoSnackbar() {
  clearTimeout(_undoHideTimer);
  const bar = document.getElementById('undoSnackbar');
  if (bar) bar.classList.remove('show');
}
function undoLastRound() {
  hideUndoSnackbar();
  if (!G || !G.rounds.length) return;
  const idx = G.rounds.length - 1;
  const r = G.rounds[idx];
  G.teams.forEach((t,i)=>{
    const delta = Array.isArray(r.scoreDelta) ? r.scoreDelta[i] : (r.punti[i]||0)+(r.akuzPts[i]||0);
    t.score -= (delta||0);
  });
  G.rounds.splice(idx,1);
  render();
  autoSave();
  showToast('Runda poništena');
}

function resetDraft() {
  draft = blankDraft(tc(), pc());
  akuzTeam = 0;
  render();
}

// ===================== FAZA 1: KONFETI =====================
function fireConfetti(count) {
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  count = count || 40;
  const colors = ['var(--red)', 'var(--gold)', '#ffffff'];
  for (let i = 0; i < count; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.left = (5 + Math.random() * 90) + 'vw';
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.transform = `rotate(${Math.random() * 360}deg)`;
    document.body.appendChild(piece);
    const dur = 1100 + Math.random() * 900;
    const drift = (Math.random() - 0.5) * 140;
    const endY = window.innerHeight + 40;
    const anim = piece.animate([
      { transform: `translate(0,0) rotate(0deg)`, opacity: 1 },
      { transform: `translate(${drift}px, ${endY}px) rotate(${360 + Math.random() * 360}deg)`, opacity: 0.9 }
    ], { duration: dur, easing: 'cubic-bezier(0.25,0.46,0.45,0.94)', fill: 'forwards' });
    anim.onfinish = () => piece.remove();
    setTimeout(() => piece.remove(), dur + 150);
  }
}

// ===================== KRAJ PARTIJE / MEČA =====================
function handleGameEnd() {
  const sorted = [...G.teams].sort((a,b)=> G.lowWins ? a.score-b.score : b.score-a.score);
  const w = sorted[0];
  G.matchWins[w.id] = (G.matchWins[w.id]||0) + 1;
  G.matchHistory.push({
    teams: G.teams.map(t=>({name:t.name, score:t.score})),
    winnerIdx: w.id,
    rounds: JSON.parse(JSON.stringify(G.rounds)), // puna povijest rundi ove partije (za kasniji uvid)
  });
  if (G.matchWins[w.id] >= winsNeeded()) {
    showWinner();
  } else {
    showGameWinner(w);
  }
}

// Prikaz pobjednika jedne partije unutar meča (nastavlja se dalje)
function showGameWinner(w) {
  document.getElementById('gwName').textContent = w.name;
  document.getElementById('gwScore').textContent = w.score;
  const board = document.getElementById('gwBoard');
  board.innerHTML = G.teams.map(t=>`
    <div class="saved-row">
      <div class="saved-info"><div class="saved-name">${esc(t.name)}</div></div>
      <div style="font-family:'Bebas Neue',sans-serif;font-size:22px;color:var(--gold);">${G.matchWins[t.id]||0} <small style="font-size:11px;color:var(--dim);">partij${(G.matchWins[t.id]||0)===1?'a':'e'}</small></div>
    </div>`).join('');
  autoSave();
  openM('gameWinnerModal');
  fireConfetti(24);
  playWinSound();
}

// Prikaz pobjednika cijelog meča (kraj)
function showWinner() {
  // Pobjednik meča = ekipa s najviše osvojenih partija (NE po zadnjem rezultatu bodova!)
  const w = G.teams.reduce((best, t) => (G.matchWins[t.id]||0) > (G.matchWins[best.id]||0) ? t : best, G.teams[0]);
  document.getElementById('winnerName').textContent = w.name;
  const board = document.getElementById('winnerBoard');
  if (winsNeeded() > 1) {
    const sorted = [...G.teams].sort((a,b)=>(G.matchWins[b.id]||0)-(G.matchWins[a.id]||0));
    const runnerUpWins = sorted.length > 1 ? (G.matchWins[sorted[1].id]||0) : 0;
    document.getElementById('winnerScore').textContent = `${G.matchWins[w.id]||0} : ${runnerUpWins}`;
    document.getElementById('winnerScoreCaption').textContent = 'omjer partija u meču';
    board.innerHTML = sorted.map((t,i)=>`
      <div class="saved-row">
        <div class="saved-info"><div class="saved-name">${i+1}. ${esc(t.name)}</div></div>
        <div style="font-family:'Bebas Neue',sans-serif;font-size:26px;color:var(--red);">${G.matchWins[t.id]||0} partij${(G.matchWins[t.id]||0)===1?'a':'e'}</div>
      </div>`).join('');
  } else {
    document.getElementById('winnerScore').textContent = w.score;
    document.getElementById('winnerScoreCaption').textContent = G.lowWins ? 'najmanje bodova' : '';
    board.innerHTML = [...G.teams].sort((a,b)=> G.lowWins ? a.score-b.score : b.score-a.score).map((t,i)=>`
      <div class="saved-row">
        <div class="saved-info"><div class="saved-name">${i+1}. ${esc(t.name)}</div></div>
        <div style="font-family:'Bebas Neue',sans-serif;font-size:26px;color:var(--red);">${t.score}</div>
      </div>`).join('');
  }
  openM('winnerModal');
  fireConfetti(60);
  playWinSound();
  autoSaveFinished();
  clearAuto();
  G.finished = true; // označi live objekt kao završen (spriječava lažno upozorenje kod "Nova partija")
  lastFinishedSetup = {
    mode: G.mode,
    names: G.teams.map(t=>t.name),
    targetScore: G.targetScore,
    winsNeeded: G.winsNeeded,
    lowWins: G.lowWins,
  };
}

// ===================== SHEET HELPERS =====================
function openSheet(id, ovId) {
  hideUndoSnackbar();
  document.getElementById(id).classList.add('open');
  document.getElementById(ovId).classList.add('open');
}
function closeSheet(id, ovId) {
  document.getElementById(id).classList.remove('open');
  document.getElementById(ovId).classList.remove('open');
}

// ===================== MODAL HELPERS =====================
function openM(id) {
  hideUndoSnackbar();
  if (id === 'menuModal') updateMenuState();
  document.getElementById(id).classList.add('open');
}
function closeM(id) { document.getElementById(id).classList.remove('open'); }

// Prikaži/sakrij "Pauziraj partiju" ovisno o tome postoji li aktivna partija
function updateMenuState() {
  const pauseBtn = document.getElementById('pauseBtn');
  const loadBtn = document.getElementById('loadBtn');
  const matchHistBtn = document.getElementById('matchHistBtn');
  if (pauseBtn) pauseBtn.style.display = G ? '' : 'none';
  if (loadBtn) {
    const hasPaused = getSaves().some(s=>!s.state.finished);
    loadBtn.style.display = hasPaused ? '' : 'none';
  }
  if (matchHistBtn) {
    const hasFinished = getSaves().some(s=>s.state.finished);
    matchHistBtn.style.display = hasFinished ? '' : 'none';
  }
}

// ===================== THEME =====================
const THEME_KEY = 'treseta_theme';
const THEME_COLORS = { light: '#f0eee8', dark: '#1e2435' };

function getTheme() {
  try { return localStorage.getItem(THEME_KEY) || 'dark'; } catch { return 'dark'; }
}

function setTheme(theme) {
  if (theme !== 'light' && theme !== 'dark') theme = 'dark';
  if (theme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  const meta = document.getElementById('themeColorMeta');
  if (meta) meta.setAttribute('content', THEME_COLORS[theme]);
  try { localStorage.setItem(THEME_KEY, theme); } catch {}
  // Update active state on toggle buttons
  document.querySelectorAll('#themeSegs .seg-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.theme === theme);
  });
}

function initTheme() {
  setTheme(getTheme());
  document.getElementById('themeSegs').addEventListener('click', e => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    setTheme(btn.dataset.theme);
  });
}

// ===================== FAZA 2: ZVUČNI EFEKTI =====================
const SOUND_KEY = 'treseta_sound';
let _audioCtx = null;
function isSoundOn() {
  try { return localStorage.getItem(SOUND_KEY) === '1'; } catch { return false; }
}
function setSoundOn(on) {
  try { localStorage.setItem(SOUND_KEY, on ? '1' : '0'); } catch {}
  const sw = document.getElementById('soundSwitch');
  if (sw) sw.classList.toggle('on', !!on);
}
function initSound() {
  setSoundOn(isSoundOn());
  const sw = document.getElementById('soundSwitch');
  if (!sw) return;
  sw.addEventListener('click', () => {
    const next = !sw.classList.contains('on');
    setSoundOn(next);
    if (next) playChime([523.25, 659.25]); // kratka potvrda da je zvuk uključen
  });
}
function getAudioCtx() {
  if (!_audioCtx) {
    try { _audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; }
  }
  if (_audioCtx.state === 'suspended') _audioCtx.resume();
  return _audioCtx;
}
function playChime(freqs, dur) {
  if (!isSoundOn()) return;
  const ctx = getAudioCtx();
  if (!ctx) return;
  dur = dur || 0.16;
  freqs.forEach((f, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = f;
    const t0 = ctx.currentTime + i * dur * 0.8;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(0.14, t0 + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
  });
}
function playKapotSound() { playChime([392, 523.25, 659.25], 0.14); }
function playWinSound() { playChime([523.25, 659.25, 783.99, 1046.5], 0.17); }

let _confirmOk = null;
let _confirmExtra = null;
function openConfirm({title,msg,withInput,inputDef,onOk,okLabel,noLabel,extraLabel,onExtra}) {
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmMsg').textContent = msg;
  const iw = document.getElementById('confirmInputWrap');
  const inp = document.getElementById('confirmInput');
  if (withInput) { iw.style.display='block'; inp.value=inputDef||''; setTimeout(()=>inp.focus(),100); }
  else { iw.style.display='none'; }
  document.getElementById('confirmYes').textContent = okLabel || 'Potvrdi';
  document.getElementById('confirmNo').textContent = noLabel || 'Odustani';
  const extraBtn = document.getElementById('confirmExtra');
  const btnsWrap = document.getElementById('confirmBtns');
  if (extraLabel && onExtra) {
    extraBtn.textContent = extraLabel;
    extraBtn.style.display = '';
    btnsWrap.classList.add('three');
    _confirmExtra = onExtra;
  } else {
    extraBtn.style.display = 'none';
    btnsWrap.classList.remove('three');
    _confirmExtra = null;
  }
  _confirmOk = () => onOk(inp.value.trim());
  openM('confirmModal');
}

// ===================== TOAST =====================
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), 2000);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function fmt(ts) {
  const d=new Date(ts);
  const p=n=>String(n).padStart(2,'0');
  return `${p(d.getDate())}.${p(d.getMonth()+1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ===================== SETUP =====================
let setupMode = null; // null = progresivni prikaz (korisnik još nije odabrao broj igrača)
// Postavke zadnje ODIGRANE (završene) partije u ovoj sesiji - koriste se za predispunjavanje "Nova partija"
let lastFinishedSetup = null;

// Otvori postavku nove partije: ako postoje uvjeti zadnje odigrane partije, predispuni ih
// (i dalje se sve može promijeniti); inače progresivno prikaži samo odabir broja igrača.
function openSetup() {
  setupMode = lastFinishedSetup ? lastFinishedSetup.mode : null;
  buildSetupNames(true);
  openM('setupModal');
}

// Padajući izbornik sa spremljenim imenima (bez oblačića) - input ostaje slobodan za upis
// Padajući izbornik ISKLJUČIVO sa spremljenim igračima (bez slobodnog upisa) - sprječava duple igrače
function attachNameDropdown(inp, dropdown) {
  function otherValues() {
    return [...document.querySelectorAll('#setupNames input')]
      .filter(x => x !== inp)
      .map(x => x.value.trim().toLowerCase())
      .filter(Boolean);
  }
  function renderList() {
    const used = otherValues();
    const roster = getSavedNamesAlpha();
    if (!roster.length) {
      dropdown.innerHTML = '<div class="name-opt name-opt-empty">Nema spremljenih igrača — dodaj ih preko "👤 Igrači" u meniju</div>';
      dropdown.classList.add('open');
      return;
    }
    const opts = roster.filter(n => !used.includes(n.toLowerCase()));
    if (!opts.length) {
      dropdown.innerHTML = '<div class="name-opt name-opt-empty">Svi spremljeni igrači su već odabrani</div>';
      dropdown.classList.add('open');
      return;
    }
    dropdown.innerHTML = opts.map(n=>`<div class="name-opt${n===inp.value?' sel':''}">${esc(n)}</div>`).join('');
    dropdown.classList.add('open');
  }
  inp.addEventListener('focus', renderList);
  inp.addEventListener('click', renderList);
  inp.addEventListener('blur', ()=> setTimeout(()=>dropdown.classList.remove('open'), 180));
  dropdown.addEventListener('mousedown', e => {
    const opt = e.target.closest('.name-opt');
    if (!opt || opt.classList.contains('name-opt-empty')) return;
    e.preventDefault();
    inp.value = opt.textContent;
    dropdown.classList.remove('open');
  });
}

function buildNameField(placeholder) {
  const wrap = document.createElement('div');
  wrap.className = 'name-field';
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.placeholder = placeholder + ' — dodirni za odabir';
  inp.readOnly = true;
  inp.autocomplete = 'off';
  const caret = document.createElement('span');
  caret.className = 'name-caret';
  caret.textContent = '▾';
  const dropdown = document.createElement('div');
  dropdown.className = 'name-dropdown';
  wrap.appendChild(inp);
  wrap.appendChild(caret);
  wrap.appendChild(dropdown);
  attachNameDropdown(inp, dropdown);
  return { wrap, inp };
}

function buildSetupNames(initial) {
  const wrap = document.getElementById('setupNames');
  const label = document.getElementById('namesLabel');
  const warn = document.getElementById('setupNamesWarning');
  const rest = document.getElementById('setupRest');
  const startBtn = document.getElementById('startBtn');
  const btnsWrap = startBtn.closest('.modal-btns');

  // Ažuriraj aktivni gumb za broj igrača (ili nijedan ako mod još nije odabran)
  document.querySelectorAll('#modeSegs .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.m === setupMode));

  if (!setupMode) {
    // Progresivni prikaz: dok korisnik ne odabere broj igrača, ostatak forme je skriven
    rest.style.display = 'none';
    startBtn.style.display = 'none';
    btnsWrap.classList.add('single');
    return;
  }
  rest.style.display = '';
  startBtn.style.display = '';
  btnsWrap.classList.remove('single');

  wrap.innerHTML = '';

  const roster = getSavedNames();
  const required = setupMode === 'pairs' ? 4 : parseInt(setupMode);
  if (roster.length < required) {
    warn.style.display = '';
    warn.textContent = `Treba ${required} spremljena igrača, a u popisu ih je ${roster.length}. Dodaj ih preko "👤 Igrači" u glavnom meniju.`;
  } else {
    warn.style.display = 'none';
  }

  // Predispuni imenima iz zadnje ODIGRANE partije (samo pri prvom otvaranju, i samo ako se mod poklapa)
  const prefill = (initial && lastFinishedSetup && lastFinishedSetup.mode === setupMode) ? lastFinishedSetup.names : null;
  const rosterHas = n => roster.some(r => r.toLowerCase() === (n||'').toLowerCase());

  if (setupMode === 'pairs') {
    label.textContent = 'Igrači po ekipama';
    for (let team = 0; team < 2; team++) {
      const group = document.createElement('div');
      group.className = 'pair-group';
      const title = document.createElement('div');
      title.className = 'pair-group-title';
      title.textContent = team === 0 ? 'Ekipa A' : 'Ekipa B';
      group.appendChild(title);
      const fieldsRow = document.createElement('div');
      fieldsRow.className = 'pair-fields-row';
      // Prošli spremljeni naziv ekipe je oblika "Ime1 i Ime2" - razdvoji natrag na dva igrača
      const pairParts = prefill ? (prefill[team]||'').split(' i ').map(s=>s.trim()) : [];
      for (let slot = 0; slot < 2; slot++) {
        const { wrap: fieldWrap, inp } = buildNameField(`Igrač ${team*2 + slot + 1}`);
        inp.dataset.team = String(team);
        inp.dataset.slot = String(slot);
        if (pairParts[slot] && rosterHas(pairParts[slot])) inp.value = pairParts[slot];
        fieldsRow.appendChild(fieldWrap);
      }
      group.appendChild(fieldsRow);
      wrap.appendChild(group);
    }
  } else {
    const count = parseInt(setupMode);
    label.textContent = 'Igrači';
    for (let i = 0; i < count; i++) {
      const { wrap: fieldWrap, inp } = buildNameField(`Igrač ${i+1}`);
      inp.dataset.slot = String(i);
      if (prefill && prefill[i] && rosterHas(prefill[i])) inp.value = prefill[i];
      wrap.appendChild(fieldWrap);
    }
  }

  if (initial && lastFinishedSetup) {
    const tVal = lastFinishedSetup.targetScore || DEFAULT_TARGET;
    const wVal = lastFinishedSetup.winsNeeded || 1;
    const tBtn = document.getElementById('targetInput');
    const wBtn = document.getElementById('winsInput');
    tBtn.dataset.value = String(tVal); tBtn.textContent = String(tVal);
    wBtn.dataset.value = String(wVal); wBtn.textContent = String(wVal);
    document.querySelectorAll('#lowWinsSeg .seg-btn').forEach(b =>
      b.classList.toggle('active', (b.dataset.v === '1') === !!lastFinishedSetup.lowWins));
  } else if (initial) {
    // Svježa (neprethodno-popunjena) postavka - vrati na default vrijednosti
    const tBtn = document.getElementById('targetInput');
    const wBtn = document.getElementById('winsInput');
    tBtn.dataset.value = String(DEFAULT_TARGET); tBtn.textContent = String(DEFAULT_TARGET);
    wBtn.dataset.value = '1'; wBtn.textContent = '1';
  }
}

document.getElementById('modeSegs').addEventListener('click', e=>{
  const btn = e.target.closest('.seg-btn');
  if (!btn) return;
  setupMode = btn.dataset.m;
  buildSetupNames(false);
});

document.getElementById('lowWinsSeg').addEventListener('click', e=>{
  const btn = e.target.closest('.seg-btn');
  if (!btn) return;
  document.querySelectorAll('#lowWinsSeg .seg-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
});

document.getElementById('startBtn').onclick = ()=>{
  const allInputs = [...document.querySelectorAll('#setupNames input')];
  if (allInputs.some(inp => !inp.value.trim())) {
    showToast('Odaberi sve igrače prije početka');
    return;
  }
  let names, toRemember;
  if (setupMode === 'pairs') {
    toRemember = [];
    names = [0,1].map(team=>{
      const inp1 = document.querySelector(`#setupNames input[data-team="${team}"][data-slot="0"]`);
      const inp2 = document.querySelector(`#setupNames input[data-team="${team}"][data-slot="1"]`);
      const n1 = inp1.value.trim();
      const n2 = inp2.value.trim();
      toRemember.push(n1, n2);
      const pair = sortNamesAlpha([n1, n2]);
      return `${pair[0]} i ${pair[1]}`;
    });
  } else {
    names = allInputs.map(inp=> inp.value.trim());
    toRemember = names.slice();
  }
  // Sigurnosna provjera duplikata (dropdown ih inače već sprječava)
  const seen = new Set();
  for (const n of toRemember) {
    const key = n.toLowerCase();
    if (seen.has(key)) { showToast(`"${n}" je odabran više puta`); return; }
    seen.add(key);
  }
  const activeWinBtn = document.getElementById('winsInput');
  const lowWinsBtn = document.querySelector('#lowWinsSeg .seg-btn.active');
  const opts = {
    targetScore: parseInt(document.getElementById('targetInput').dataset.value) || DEFAULT_TARGET,
    winsNeeded: Math.max(1, parseInt(activeWinBtn.dataset.value) || 1),
    lowWins: lowWinsBtn ? lowWinsBtn.dataset.v === '1' : false,
  };
  newGame(setupMode, names, opts);
  rememberNames(toRemember);
  closeM('setupModal');
};

// ===================== BUTTONS =====================
document.getElementById('addBtn').onclick = addRound;
document.getElementById('resetBtn').onclick = ()=>{
  if (draft.punti.some(v=>v!='') || draft.akuzi.some(a=>Object.keys(a).length))
    openConfirm({title:'Poništi unos?',msg:'Obrisati sve unesene punte i akuže za ovu rundu?',onOk:resetDraft});
  else resetDraft();
};

document.getElementById('historyBtn').onclick = openHistory;
document.getElementById('histClose').onclick = ()=>closeSheet('histSheet','histOverlay');
document.getElementById('histOverlay').onclick = ()=>closeSheet('histSheet','histOverlay');

let initialMenu = false;
document.getElementById('menuBtn').onclick = ()=>{ initialMenu = false; openM('menuModal'); };
document.getElementById('menuCloseBtn').onclick = ()=>{
  closeM('menuModal');
  initialMenu = false;

  // Je li app pokrenut kao PWA (dodan na početni zaslon / standalone)?
  const isPWA = window.matchMedia('(display-mode: standalone)').matches
             || window.matchMedia('(display-mode: fullscreen)').matches
             || window.navigator.standalone === true;

  if (isPWA) {
    // U PWA načinu window.close() obično uspije i zatvori aplikaciju.
    try { window.close(); } catch(e) {}
    // Fallback ako preglednik ipak ne zatvori: vrati na naslovnicu.
    setTimeout(()=>{
      const splash = document.getElementById('splash');
      if (splash) { splash.style.display = 'flex'; splash.classList.remove('hide'); }
    }, 300);
  } else {
    // Obična kartica u pregledniku -> preusmjeri na Google.
    window.location.href = 'https://www.google.com';
  }
};

document.getElementById('newGameBtn').onclick = ()=>{
  closeM('menuModal');
  if (G && G.rounds.length>0 && !G.finished) {
    openConfirm({
      title:'Nova partija?',
      msg:'Trenutna partija još nije gotova. Možeš je pauzirati i nastaviti kasnije, ili je trajno odbaciti.',
      okLabel:'Odbaci', extraLabel:'⏸ Pauziraj',
      onExtra:()=>{ pauseCurrentGame(); showToast('Partija pauzirana ✓'); openSetup(); },
      onOk:()=>{ clearAuto(); G=null; openSetup(); }
    });
  } else { G=null; openSetup(); }
};

document.getElementById('pauseBtn').onclick = ()=>{
  if (!G) { showToast('Nema aktivne partije'); return; }
  pauseCurrentGame();
  updateMenuState();
  initialMenu = true;
  showToast('Partija pauzirana — nastavi je kasnije preko "Nastavi pauziranu partiju"');
};

document.getElementById('setupCancelBtn').onclick = ()=>{ closeM('setupModal'); openM('menuModal'); };

document.getElementById('loadBtn').onclick = ()=>{
  if (!getSaves().filter(s=>!s.state.finished).length) { showToast('Nema pauziranih partija'); return; }
  closeM('menuModal'); renderSavedList(); openM('loadModal');
};
document.getElementById('loadClose').onclick = ()=>{ closeM('loadModal'); openM('menuModal'); };

document.getElementById('matchHistBtn').onclick = ()=>{
  const saves = getSaves().filter(s=>s.state.finished);
  if (!saves.length) { showToast('Nema odigranih partija'); return; }
  closeM('menuModal'); renderMatchHistoryList(); openM('matchHistModal');
};
document.getElementById('matchHistClose').onclick = ()=>{ closeM('matchHistModal'); openM('menuModal'); };

document.getElementById('playersBtn').onclick = ()=>{
  closeM('menuModal'); renderPlayersList(); openM('playersModal');
};
document.getElementById('playersClose').onclick = ()=>{ closeM('playersModal'); openM('menuModal'); };
document.getElementById('playerAddBtn').onclick = ()=>{
  const inp = document.getElementById('playerAddInput');
  if (addPlayerToRoster(inp.value)) {
    inp.value = '';
    renderPlayersList();
    showToast('Igrač dodan ✓');
  }
};
document.getElementById('playerAddInput').addEventListener('keydown', e=>{
  if (e.key === 'Enter') document.getElementById('playerAddBtn').click();
});

function renderPlayersList() {
  const wrap = document.getElementById('playersList');
  const roster = getSavedNamesAlpha();
  if (!roster.length) {
    wrap.innerHTML = '<div class="empty-hist">Nema spremljenih igrača — dodaj prvog iznad</div>';
    return;
  }
  wrap.innerHTML = '';
  roster.forEach(name => {
    const row = document.createElement('div');
    row.className = 'saved-row player-row';
    row.innerHTML = `<div class="saved-info"><div class="saved-name">${esc(name)}</div></div>`;
    const eb = document.createElement('button');
    eb.className = 'sl-btn r small'; eb.textContent = '✏️'; eb.title = 'Izmijeni ime';
    eb.onclick = () => openConfirm({
      title: 'Izmijeni igrača',
      msg: 'Novo ime:',
      withInput: true,
      inputDef: name,
      onOk: (val) => { if (renamePlayerInRoster(name, val)) { renderPlayersList(); showToast('Ime ažurirano ✓'); } },
    });
    const db = document.createElement('button');
    db.className = 'sl-btn d small'; db.textContent = '✕'; db.title = 'Obriši igrača';
    db.onclick = () => openConfirm({
      title: 'Obrisati igrača?',
      msg: `Obrisati "${name}" iz popisa? Ovo ne utječe na već odigrane/pauzirane partije.`,
      onOk: () => { deletePlayerFromRoster(name); renderPlayersList(); },
    });
    const actions = document.createElement('div');
    actions.className = 'player-actions';
    actions.appendChild(eb); actions.appendChild(db);
    row.appendChild(actions);
    wrap.appendChild(row);
  });
}

document.getElementById('rulesBtn').onclick = ()=>{ closeM('menuModal'); openM('rulesModal'); };
document.getElementById('rulesClose').onclick = ()=>{ closeM('rulesModal'); openM('menuModal'); };

document.getElementById('newAfterWin').onclick = ()=>{ closeM('winnerModal'); G=null; openSetup(); };
document.getElementById('menuAfterWin').onclick = ()=>{ closeM('winnerModal'); G=null; openM('menuModal'); };
document.getElementById('nextGameBtn').onclick = ()=>{ closeM('gameWinnerModal'); nextGameInMatch(); };
document.getElementById('shareResultBtn').onclick = shareMatchResult;

document.getElementById('confirmYes').onclick = ()=>{ closeM('confirmModal'); if(_confirmOk){_confirmOk(); _confirmOk=null;} };
document.getElementById('confirmNo').onclick  = ()=>{ closeM('confirmModal'); _confirmOk=null; _confirmExtra=null; };
document.getElementById('confirmExtra').onclick = ()=>{ closeM('confirmModal'); if(_confirmExtra){_confirmExtra(); _confirmExtra=null;} _confirmOk=null; };

// ===================== SAVED LIST =====================
function renderSavedList() {
  const wrap = document.getElementById('savedList');
  const saves = getSaves().filter(s=>!s.state.finished);
  if (!saves.length) {
    wrap.innerHTML = '<div class="empty-hist">Nema pauziranih partija</div>';
    return;
  }
  wrap.innerHTML = '';
  saves.forEach(s=>{
    const row = document.createElement('div');
    row.className = 'saved-row';
    const teams = s.state.teams;
    const mh = s.state.matchHistory || [];
    const lowTag = s.state.lowWins ? '🔻 ' : '';
    const participantsLine = lowTag + teams.map(t=>esc(t.name)).join(' / ');

    let linesHtml = '';
    let divider = '';
    if (mh.length) {
      linesHtml = mh.map((g, gi) => {
        const values = teams.map(t => (g.teams[t.id]||{}).score||0);
        return `<div class="hist-match-line">Partija ${gi+1} — ${values.join(' : ')}</div>`;
      }).join('');
      divider = '<div class="hist-divider"></div>';
    }
    const totalStr = teams.map(t=>t.score).join(' : ');

    row.innerHTML = `
      <div class="saved-info">
        <div class="hist-participants">${participantsLine}</div>
        <div class="hist-date">${fmt(s.ts)}</div>
        ${divider}
        ${linesHtml}
        ${divider}
        <div class="hist-match-line hist-total-line">Ukupno — ${totalStr}</div>
      </div>
    `;
    const lb = document.createElement('button');
    lb.className='sl-btn r small'; lb.textContent='▶'; lb.title='Nastavi';
    lb.onclick=()=>{ G=normalizeGame(JSON.parse(JSON.stringify(s.state))); draft=blankDraft(tc(), pc()); akuzTeam=0; for(const k in _prevScores) delete _prevScores[k]; closeM('loadModal'); render(); showToast(`Nastavljeno: ${s.name}`); };
    const db = document.createElement('button');
    db.className='sl-btn d small'; db.textContent='✕'; db.title='Obriši';
    db.onclick=()=>openConfirm({title:'Obrisati?',msg:`Obrisati "${s.name}"?`,
      onOk:()=>{ setSaves(getSaves().filter(x=>x.name!==s.name)); renderSavedList(); }});
    const actions = document.createElement('div');
    actions.className = 'saved-actions';
    actions.appendChild(lb); actions.appendChild(db);
    row.appendChild(actions);
    wrap.appendChild(row);
  });
}

// Povijest odigranih (završenih) partija - samo pregled/brisanje, bez učitavanja u tijeku igre
// Gradi kompletan pregled kretanja rezultata (sve runde, kroz sve partije meča) za završenu partiju
function buildFullMatchDetailHTML(teams, matchHistory, lowWins) {
  let out = '';
  matchHistory.forEach((g, gi) => {
    if (matchHistory.length > 1) {
      out += `<div class="match-detail-partija-label">Partija ${gi+1}</div>`;
    }
    const rounds = g.rounds || [];
    if (!rounds.length) {
      out += '<div class="empty-hist">Detalji rundi nisu dostupni za ovu partiju</div>';
    } else {
      out += buildHistoryRowsHTML(teams, rounds, lowWins, true);
      let tLines = '';
      teams.forEach(t => {
        const finalTeam = g.teams[t.id] || {score:0};
        const isWinner = t.id === g.winnerIdx;
        tLines += `<div class="hist-line">
          <span class="hist-name">${esc(t.name)}</span>
          <span class="hist-pts" style="${isWinner?'color:var(--green);font-weight:800;':'color:var(--red);'}">${finalTeam.score}</span>
        </div>`;
      });
      out += `<div class="hist-row hist-total"><div class="hist-num">Σ</div><div class="hist-content">${tLines}</div><div></div></div>`;
    }
  });
  return out;
}

function openMatchDetail(s) {
  document.getElementById('matchDetailTitle').textContent = s.name;
  const body = document.getElementById('matchDetailBody');
  const mh = s.state.matchHistory || [];
  if (!mh.length || !mh.some(g=>g.rounds && g.rounds.length)) {
    body.innerHTML = '<div class="empty-hist">Detaljna povijest rundi nije dostupna za ovu partiju (spremljena je prije uvođenja ove opcije).</div>';
  } else {
    body.innerHTML = buildFullMatchDetailHTML(s.state.teams, mh, s.state.lowWins);
  }
  openM('matchDetailModal');
}
document.getElementById('matchDetailClose').onclick = ()=> closeM('matchDetailModal');

function renderMatchHistoryList() {
  const wrap = document.getElementById('matchHistList');
  const saves = getSaves().filter(s=>s.state.finished);
  if (!saves.length) {
    wrap.innerHTML = '<div class="empty-hist">Nema odigranih partija</div>';
    return;
  }
  // Formatira niz brojeva za red, podebljano i zeleno označava pobjednikov broj (po indexu winnerIdx unutar niza)
  function fmtScoreRow(values, winnerIdx) {
    return values.map((v,i)=> i===winnerIdx ? `<strong style="color:var(--green);">${v}</strong>` : `${v}`).join(' : ');
  }
  wrap.innerHTML = '';
  saves.forEach(s=>{
    const row = document.createElement('div');
    row.className = 'saved-row';
    const wn = s.state.winsNeeded || 1;
    const teams = s.state.teams;
    const mh = s.state.matchHistory || [];
    let winnerName, participantsLine, linesHtml = '', totalStr, divider = '', extraNote = '';

    if (mh.length) {
      let winnerTeam;
      if (s.state.matchWins) {
        winnerTeam = teams.reduce((best,t)=> (s.state.matchWins[t.id]||0) > (s.state.matchWins[best.id]||0) ? t : best, teams[0]);
      } else {
        const lastWinnerName = mh[mh.length-1].teams[mh[mh.length-1].winnerIdx].name;
        winnerTeam = teams.find(t=>t.name===lastWinnerName) || teams[0];
      }
      const orderedTeams = [winnerTeam, ...teams.filter(t=>t.id!==winnerTeam.id)];
      winnerName = winnerTeam.name;
      participantsLine = orderedTeams.map(t=>esc(t.name)).join(' / ');

      if (mh.length > 1) {
        linesHtml = mh.map((g, gi) => {
          const values = orderedTeams.map(t=> (g.teams[t.id]||{}).score||0);
          const winIdx = orderedTeams.findIndex(t=>t.id===g.winnerIdx);
          return `<div class="hist-match-line">Partija ${gi+1} — ${fmtScoreRow(values, winIdx)}</div>`;
        }).join('');
        divider = '<div class="hist-divider"></div>';
        const totalValues = (wn > 1 && s.state.matchWins)
          ? orderedTeams.map(t=> s.state.matchWins[t.id]||0)
          : orderedTeams.map(t=> (mh[mh.length-1].teams[t.id]||{}).score||0);
        totalStr = fmtScoreRow(totalValues, 0); // orderedTeams[0] je uvijek pobjednik
      } else {
        const values = orderedTeams.map(t=> (mh[0].teams[t.id]||{}).score||0);
        const winIdx = orderedTeams.findIndex(t=>t.id===mh[0].winnerIdx);
        totalStr = fmtScoreRow(values, winIdx);
      }
    } else {
      // Fallback za starije spremljene partije bez matchHistory podataka
      const sorted = [...teams].sort((a,b)=>b.score-a.score);
      winnerName = sorted[0].name;
      participantsLine = sorted.map(t=>esc(t.name)).join(' / ');
      totalStr = fmtScoreRow(sorted.map(t=>t.score), 0);
      extraNote = `  ·  ${s.state.rounds.length} rundi`;
    }

    row.innerHTML = `
      <div class="saved-info">
        <div class="hist-participants">${participantsLine}</div>
        <div class="hist-winner-total-big">${totalStr}</div>
        <div class="saved-name">🏆 ${esc(winnerName)}${extraNote}</div>
        <div class="hist-date">${fmt(s.ts)}</div>
        ${divider}
        ${linesHtml}
      </div>
    `;
    const ib = document.createElement('button');
    ib.className='sl-btn r small'; ib.textContent='ⓘ'; ib.title='Kompletno kretanje rezultata';
    ib.onclick = () => openMatchDetail(s);
    const db = document.createElement('button');
    db.className='sl-btn d small'; db.textContent='✕'; db.title='Obriši';
    db.onclick=()=>openConfirm({title:'Obrisati?',msg:`Obrisati povijest "${s.name}"?`,
      onOk:()=>{ setSaves(getSaves().filter(x=>x.name!==s.name)); renderMatchHistoryList(); }});
    const actions = document.createElement('div');
    actions.className = 'saved-actions';
    actions.appendChild(ib); actions.appendChild(db);
    row.appendChild(actions);
    wrap.appendChild(row);
  });
}

// ===================== INIT =====================
initTheme();
initSound();
buildSetupNames();
const vLbl = document.getElementById('appVersionLabel');
if (vLbl) vLbl.textContent = APP_VERSION;

function bootApp() {
  const auto = loadAuto();
  const hasUnfinished = auto && auto.teams && auto.teams.length && !auto.teams.find(t=>t.score>=((auto.targetScore)||DEFAULT_TARGET));
  if (hasUnfinished) {
    closeM('setupModal');
    openConfirm({
      title:'Nastaviti?',
      msg:`Pronađena prekinuta partija (${auto.teams.map(t=>t.name).join(', ')}, ${auto.rounds.length} rundi). Nastaviti?`,
      onOk:()=>{ G=normalizeGame(auto); draft=blankDraft(tc(), pc()); akuzTeam=0; for(const k in _prevScores) delete _prevScores[k]; render(); }
    });
    const origNo = document.getElementById('confirmNo').onclick;
    document.getElementById('confirmNo').onclick = ()=>{
      closeM('confirmModal'); _confirmOk=null;
      clearAuto(); initialMenu = true; openM('menuModal');
      document.getElementById('confirmNo').onclick = origNo;
    };
  } else {
    initialMenu = true;
    openM('menuModal');
  }
}

// Naslovnica: dodir pokreće aplikaciju
(function(){
  const splash = document.getElementById('splash');
  let booted = false;
  function go(e) {
    if (booted) return;
    booted = true;
    // Spriječi da preglednik nakon touchstart-a naknadno emitira sintetički "click"
    // na istoj poziciji (koji bi inače "propao" kroz splash na gumb ispod, npr. u meniju,
    // jer splash odmah dobiva pointer-events:none) - klasični "ghost click" na Androidu.
    if (e && e.cancelable) e.preventDefault();
    splash.classList.add('hide');
    bootApp();
    setTimeout(()=>{ splash.style.display = 'none'; }, 550);
  }
  splash.addEventListener('touchstart', go, {passive:false});
  splash.addEventListener('click', go);
})();

// ===================== PWA / SERVICE WORKER =====================
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
      // Odmah provjeri ima li novija verzija
      reg.update();
      // I dalje provjeravaj svakih 30 min dok je tab otvoren
      setInterval(() => reg.update(), 30 * 60 * 1000);

      // Kad se pronađe nova verzija, pusti je da preuzme kontrolu odmah
      reg.addEventListener('updatefound', () => {
        const newSW = reg.installing;
        if (!newSW) return;
        newSW.addEventListener('statechange', () => {
          if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
            // Nova verzija je spremna -> reci joj da preuzme kontrolu
            newSW.postMessage('SKIP_WAITING');
          }
        });
      });
    }).catch(() => {});

    // Kad novi SW preuzme kontrolu, osvježi stranicu jednom
    // (osim ako je partija u tijeku — tad čekamo sljedeći otvor)
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded) return;
      const partijaUTijeku = (typeof G !== 'undefined') && G && G.rounds && G.rounds.length > 0 && !G.finished;
      if (partijaUTijeku) {
        showToast && showToast('Nova verzija spremna — učitat će se kod sljedećeg otvaranja');
        return;
      }
      reloaded = true;
      location.reload();
    });
  });
}
