const params = new URLSearchParams(location.search);
const matchNumber = Number(params.get('m'));
document.getElementById('mNum').textContent = matchNumber;

const API_BASE = '/api/matches';

function playerPills(teamName) {
  const parts = (teamName || '').split(' & ');
  if (parts.length !== 2) return teamName || '';
  return `<span class="pill">${parts[0]}</span><span class="amp">&amp;</span><span class="pill">${parts[1]}</span>`;
}

let match = null;
let teamsByCode = {};
let socket = null;
let lockHeartbeat = null;
let tossState = { tossWinner: null, winnerChoice: null, deferPick: null };

function onAdminLogin() { acquireLockIfAdmin(); render(); }
function onAdminLogout() { render(); }

// ---- Timer ----

function formatDuration(ms) {
  if (ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = n => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function renderTimer() {
  const block = document.getElementById('timerBlock');
  const display = document.getElementById('timerDisplay');
  if (!match || !match.actualStart) { block.style.display = 'none'; return; }
  block.style.display = 'block';
  const start = new Date(match.actualStart).getTime();
  const end = match.actualEnd ? new Date(match.actualEnd).getTime() : Date.now();
  const elapsedMs = end - start;
  const label = match.status === 'completed' ? 'Duration' : 'Elapsed';
  display.innerHTML = `${label}: <b>${formatDuration(elapsedMs)}</b>`;
}

let timerInterval = null;
function startTimerTicker() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    if (match && match.status === 'in_progress') renderTimer();
  }, 1000);
}

// ---- Data loading ----

async function loadTeams() {
  const teams = await Api.get('/api/teams');
  teams.forEach(t => { teamsByCode[t.code] = t; });
}

async function loadMatch() {
  match = await Api.get(`${API_BASE}/${matchNumber}`);
  render();
}

function connectSocket() {
  socket = io();
  socket.emit('join:match', matchNumber);
  socket.on('match:update', (updated) => {
    if (updated.matchNumber === matchNumber) {
      match = updated;
      render();
    }
  });
}

async function acquireLockIfAdmin() {
  if (!isAdmin) return;
  try {
    await Api.post(`${API_BASE}/${matchNumber}/lock`);
    lockHeartbeat = setInterval(() => {
      Api.post(`${API_BASE}/${matchNumber}/lock/refresh`).catch(() => {});
    }, 60000);
  } catch (e) {
    console.warn(e.message);
  }
}

window.addEventListener('beforeunload', () => {
  if (isAdmin) navigator.sendBeacon && navigator.sendBeacon(`${API_BASE}/${matchNumber}/lock`, '');
});

function getPlayers(teamSlot) {
  if (teamSlot.code && teamsByCode[teamSlot.code]) {
    const t = teamsByCode[teamSlot.code];
    return [t.player1, t.player2];
  }
  const parts = (teamSlot.name || '').split(' & ');
  return parts.length === 2 ? parts : [teamSlot.name || 'Player 1', 'Player 2'];
}

function otherOf(name, pair) { return pair[0] === name ? pair[1] : pair[0]; }

// ---- Schedule ----

function renderSchedule() {
  const view = document.getElementById('scheduleView');
  const groupLabel = match.group ? `Group ${match.group} - ` : '';
  view.innerHTML = `
    <div class="match-meta">${groupLabel}${match.stage} - ${match.session || ''} - ${match.scheduledStart} to ${match.scheduledEnd}</div>
    <div class="match-players">${playerPills(match.team1.name)} <span class="small-note">vs</span> ${playerPills(match.team2.name)}</div>
    <div class="small-note">Format: ${match.formatType === 'final' ? 'Final (Ad scoring)' : 'Group/Semifinal (No-Ad)'} · If 1-1: ${match.decidingSet === 'full_set' ? 'full 3rd set' : '10-point match tiebreak'}</div>
    ${isAdmin ? '<button class="secondary" onclick="toggleScheduleEdit()">Edit</button>' : ''}
  `;

  const edit = document.getElementById('scheduleEdit');
  const t1 = teamsByCode[match.team1.code];
  const t2 = teamsByCode[match.team2.code];
  const playersEditable = !!(t1 && t2);
  edit.innerHTML = `
    ${playersEditable ? `
    <div class="field-row"><label>${match.team1.name}</label>
      <input id="editT1P1" value="${t1.player1}" style="width:130px;">
      <input id="editT1P2" value="${t1.player2}" style="width:130px;">
    </div>
    <div class="field-row"><label>${match.team2.name}</label>
      <input id="editT2P1" value="${t2.player1}" style="width:130px;">
      <input id="editT2P2" value="${t2.player2}" style="width:130px;">
    </div>` : ''}
    <div class="field-row"><label>Session</label><input id="sessionInput" value="${match.session || ''}"></div>
    <div class="field-row"><label>Start time</label><input id="startInput" value="${match.scheduledStart}"></div>
    <div class="field-row"><label>End time</label><input id="endInput" value="${match.scheduledEnd}"></div>
    ${match.stage === 'Final' ? `
    <div class="field-row"><label>If sets tie 1-1</label>
      <select id="decidingSetInput">
        <option value="match_tiebreak" ${match.decidingSet === 'match_tiebreak' ? 'selected' : ''}>10-Point Match Tiebreak</option>
        <option value="full_set" ${match.decidingSet === 'full_set' ? 'selected' : ''}>Full 3rd Set</option>
      </select>
    </div>` : ''}
    <button onclick="saveSchedule()">Save</button>
    <button class="secondary" onclick="toggleScheduleEdit()">Cancel</button>
    <div id="scheduleError" class="error-msg"></div>
  `;
}

function toggleScheduleEdit() {
  const edit = document.getElementById('scheduleEdit');
  edit.style.display = edit.style.display === 'none' ? 'block' : 'none';
}

async function saveSchedule() {
  try {
    const t1P1El = document.getElementById('editT1P1');
    if (t1P1El) {
      await Api.patch(`/api/teams/${match.team1.code}`, {
        player1: t1P1El.value,
        player2: document.getElementById('editT1P2').value
      });
      await Api.patch(`/api/teams/${match.team2.code}`, {
        player1: document.getElementById('editT2P1').value,
        player2: document.getElementById('editT2P2').value
      });
      await loadTeams();
    }

    const body = {
      session: document.getElementById('sessionInput').value,
      scheduledStart: document.getElementById('startInput').value,
      scheduledEnd: document.getElementById('endInput').value,
      expectedVersion: match.version
    };
    const decidingEl = document.getElementById('decidingSetInput');
    if (decidingEl) body.decidingSet = decidingEl.value;
    const res = await Api.patch(`${API_BASE}/${matchNumber}/schedule`, body);
    match = res.match;
    toggleScheduleEdit();
    render();
  } catch (e) {
    document.getElementById('scheduleError').textContent = e.message;
  }
}

// ---- Coin toss ----

function teamsResolved() {
  return !!(match.team1 && match.team1.code) && !!(match.team2 && match.team2.code);
}

function renderToss() {
  const view = document.getElementById('tossView');
  const form = document.getElementById('tossForm');

  if (!teamsResolved()) {
    view.innerHTML = '<span class="small-note">Waiting for both teams to be determined.</span>';
    form.style.display = 'none';
    return;
  }

  if (match.coinToss && match.coinToss.recordedAt) {
    const ct = match.coinToss;
    view.innerHTML = `
      <div>Toss winner: <b>${match[ct.tossWinner].name}</b> chose to <b>${ct.winnerChoice}</b>${ct.winnerChoice === 'defer' ? ' (passed first choice to opponent)' : ''}.</div>
      <div>${match[ct.serveChoice.team].name} will <b>${ct.serveChoice.decision}</b> first.</div>
      <div>${match[ct.endChoice.team].name} starts on the <b>${ct.endChoice.end}</b>.</div>
      ${isAdmin && match.status === 'toss_done' ? '<button onclick="toggleTossForm()">Re-record toss</button>' : ''}
    `;
  } else {
    view.innerHTML = '<span class="small-note">Not recorded yet.</span>';
  }

  if (isAdmin && match.status === 'scheduled') {
    form.style.display = 'block';
    renderTossForm();
  } else if (isAdmin && match.status === 'toss_done') {
    form.style.display = 'none';
  } else {
    form.style.display = 'none';
  }
}

function toggleTossForm() {
  const form = document.getElementById('tossForm');
  form.style.display = form.style.display === 'none' ? 'block' : 'none';
  renderTossForm();
}

function renderTossForm() {
  const form = document.getElementById('tossForm');
  const t1 = match.team1.name, t2 = match.team2.name;

  let html = `
    <div class="field-row"><label>Toss winner</label>
      <select id="tossWinnerSel" onchange="updateToss()">
        <option value="">Select</option>
        <option value="team1" ${tossState.tossWinner === 'team1' ? 'selected' : ''}>${t1}</option>
        <option value="team2" ${tossState.tossWinner === 'team2' ? 'selected' : ''}>${t2}</option>
      </select>
    </div>`;

  if (tossState.tossWinner) {
    html += `
    <div class="field-row"><label>Winner's choice</label>
      <select id="winnerChoiceSel" onchange="updateToss()">
        <option value="">Select</option>
        <option value="serve" ${tossState.winnerChoice === 'serve' ? 'selected' : ''}>To Serve or Receive</option>
        <option value="end" ${tossState.winnerChoice === 'end' ? 'selected' : ''}>The Starting End</option>
        <option value="defer" ${tossState.winnerChoice === 'defer' ? 'selected' : ''}>Defer to opponent</option>
      </select>
    </div>`;
  }

  let chooser = tossState.tossWinner;
  let pick = tossState.winnerChoice;

  if (tossState.winnerChoice === 'defer' && tossState.tossWinner) {
    chooser = tossState.tossWinner === 'team1' ? 'team2' : 'team1';
    html += `
    <div class="field-row"><label>${match[chooser].name} chooses</label>
      <select id="deferPickSel" onchange="updateToss()">
        <option value="">Select</option>
        <option value="serve" ${tossState.deferPick === 'serve' ? 'selected' : ''}>To Serve or Receive</option>
        <option value="end" ${tossState.deferPick === 'end' ? 'selected' : ''}>The Starting End</option>
      </select>
    </div>`;
    pick = tossState.deferPick;
  }

  if (pick === 'serve' && chooser) {
    const endChooser = chooser === 'team1' ? 'team2' : 'team1';
    html += `
    <div class="field-row"><label>${match[chooser].name} decides</label>
      <select id="serveDecisionSel" onchange="updateToss()">
        <option value="">Select</option>
        <option value="serve" ${tossState.serveDecision === 'serve' ? 'selected' : ''}>Serve first</option>
        <option value="receive" ${tossState.serveDecision === 'receive' ? 'selected' : ''}>Receive first</option>
      </select>
    </div>
    <div class="field-row"><label>${match[endChooser].name} picks end</label>
      <select id="endSel" onchange="updateToss()">
        <option value="">Select</option>
        <option value="pool-end" ${tossState.end === 'pool-end' ? 'selected' : ''}>Pool End</option>
        <option value="entrance-end" ${tossState.end === 'entrance-end' ? 'selected' : ''}>Entrance End</option>
      </select>
    </div>`;
  } else if (pick === 'end' && chooser) {
    const serveChooser = chooser === 'team1' ? 'team2' : 'team1';
    html += `
    <div class="field-row"><label>${match[chooser].name} picks end</label>
      <select id="endSel" onchange="updateToss()">
        <option value="">Select</option>
        <option value="pool-end" ${tossState.end === 'pool-end' ? 'selected' : ''}>Pool End</option>
        <option value="entrance-end" ${tossState.end === 'entrance-end' ? 'selected' : ''}>Entrance End</option>
      </select>
    </div>
    <div class="field-row"><label>${match[serveChooser].name} decides</label>
      <select id="serveDecisionSel" onchange="updateToss()">
        <option value="">Select</option>
        <option value="serve" ${tossState.serveDecision === 'serve' ? 'selected' : ''}>Serve first</option>
        <option value="receive" ${tossState.serveDecision === 'receive' ? 'selected' : ''}>Receive first</option>
      </select>
    </div>`;
  }

  const ready = tossState.tossWinner && tossState.winnerChoice &&
    (tossState.winnerChoice !== 'defer' || tossState.deferPick) &&
    tossState.serveDecision && tossState.end;

  html += `<button ${ready ? '' : 'disabled'} onclick="saveToss()">Save Coin Toss</button>
    <div id="tossError" class="error-msg"></div>`;

  form.innerHTML = html;
}

function updateToss() {
  const g = id => document.getElementById(id);
  if (g('tossWinnerSel')) tossState.tossWinner = g('tossWinnerSel').value || null;
  if (g('winnerChoiceSel')) tossState.winnerChoice = g('winnerChoiceSel').value || null;
  if (g('deferPickSel')) tossState.deferPick = g('deferPickSel').value || null;
  if (g('serveDecisionSel')) tossState.serveDecision = g('serveDecisionSel').value || null;
  if (g('endSel')) tossState.end = g('endSel').value || null;
  renderTossForm();
}

async function saveToss() {
  const chooser = tossState.winnerChoice === 'defer' ? (tossState.tossWinner === 'team1' ? 'team2' : 'team1') : tossState.tossWinner;
  const pick = tossState.winnerChoice === 'defer' ? tossState.deferPick : tossState.winnerChoice;
  const serveChoiceTeam = pick === 'serve' ? chooser : (chooser === 'team1' ? 'team2' : 'team1');
  const endChoiceTeam = pick === 'end' ? chooser : (chooser === 'team1' ? 'team2' : 'team1');

  try {
    const res = await Api.post(`${API_BASE}/${matchNumber}/toss`, {
      tossWinner: tossState.tossWinner,
      winnerChoice: tossState.winnerChoice,
      serveChoiceTeam,
      serveDecision: tossState.serveDecision,
      endChoiceTeam,
      end: tossState.end,
      expectedVersion: match.version
    });
    match = res.match;
    render();
  } catch (e) {
    document.getElementById('tossError').textContent = e.message;
  }
}

// ---- Serve/receive orders ----

function renderOrders() {
  const block = document.getElementById('ordersBlock');
  const view = document.getElementById('ordersView');
  const form = document.getElementById('ordersForm');
  const title = document.getElementById('ordersTitle');

  if (!match.coinToss || !match.coinToss.recordedAt || match.status === 'scheduled') {
    block.style.display = 'none';
    return;
  }
  block.style.display = 'block';

  const pending = match.status === 'toss_done' || (match.score && match.score.pendingOrders);
  const setIdx = match.score ? match.score.currentSetIndex : 0;
  title.textContent = `Serve & receive order - Set ${setIdx + 1}`;

  const currentOrders = (match.score && match.score.sets && match.score.sets[setIdx]) ? match.score.sets[setIdx].orders : null;
  if (currentOrders && !pending) {
    view.innerHTML = `
      <div class="small-note">First to serve this set: <b>${match[currentOrders.firstServingTeam].name}</b></div>
      <div class="small-note">${match.team1.name} serve order: ${currentOrders.team1ServeOrder.join(' \u2192 ')}</div>
      <div class="small-note">${match.team1.name} receive: Deuce court - ${currentOrders.team1ReceiveOrder[0]}, Ad court - ${currentOrders.team1ReceiveOrder[1]}</div>
      <div class="small-note">${match.team2.name} serve order: ${currentOrders.team2ServeOrder.join(' \u2192 ')}</div>
      <div class="small-note">${match.team2.name} receive: Deuce court - ${currentOrders.team2ReceiveOrder[0]}, Ad court - ${currentOrders.team2ReceiveOrder[1]}</div>
    `;
  } else {
    view.innerHTML = '';
  }

  if (isAdmin && pending) {
    form.style.display = 'block';
    renderOrdersForm();
  } else {
    form.style.display = 'none';
  }
}

function renderOrdersForm() {
  const form = document.getElementById('ordersForm');
  const [t1p1, t1p2] = getPlayers(match.team1);
  const [t2p1, t2p2] = getPlayers(match.team2);

  form.innerHTML = `
    <div class="field-row"><label>First to serve (Game 1)</label>
      <select id="ord-firstTeam">
        <option value="team1">${match.team1.name}</option>
        <option value="team2">${match.team2.name}</option>
      </select>
    </div>
    <div class="field-row"><label>${match.team1.name}: first server</label>
      <select id="ord-t1-server"><option value="${t1p1}">${t1p1}</option><option value="${t1p2}">${t1p2}</option></select>
    </div>
    <div class="field-row"><label>${match.team1.name}: Deuce-court receiver</label>
      <select id="ord-t1-receiver"><option value="${t1p1}">${t1p1}</option><option value="${t1p2}">${t1p2}</option></select>
    </div>
    <div class="field-row"><label>${match.team2.name}: first server</label>
      <select id="ord-t2-server"><option value="${t2p1}">${t2p1}</option><option value="${t2p2}">${t2p2}</option></select>
    </div>
    <div class="field-row"><label>${match.team2.name}: Deuce-court receiver</label>
      <select id="ord-t2-receiver"><option value="${t2p1}">${t2p1}</option><option value="${t2p2}">${t2p2}</option></select>
    </div>
    <button onclick="submitOrdersForm()">${match.status === 'toss_done' ? 'Submit & Start Match' : 'Submit & Continue'}</button>
    <div id="ordersError" class="error-msg"></div>
  `;
}

async function submitOrdersForm() {
  const [t1p1, t1p2] = getPlayers(match.team1);
  const [t2p1, t2p2] = getPlayers(match.team2);
  const firstServingTeam = document.getElementById('ord-firstTeam').value;
  const t1Server = document.getElementById('ord-t1-server').value;
  const t1Receiver = document.getElementById('ord-t1-receiver').value;
  const t2Server = document.getElementById('ord-t2-server').value;
  const t2Receiver = document.getElementById('ord-t2-receiver').value;

  const body = {
    firstServingTeam,
    team1ServeOrder: [t1Server, otherOf(t1Server, [t1p1, t1p2])],
    team1ReceiveOrder: [t1Receiver, otherOf(t1Receiver, [t1p1, t1p2])],
    team2ServeOrder: [t2Server, otherOf(t2Server, [t2p1, t2p2])],
    team2ReceiveOrder: [t2Receiver, otherOf(t2Receiver, [t2p1, t2p2])]
  };

  try {
    const endpoint = match.status === 'toss_done' ? `${API_BASE}/${matchNumber}/start` : `${API_BASE}/${matchNumber}/orders`;
    const res = await Api.post(endpoint, body);
    match = res.match;
    render();
  } catch (e) {
    document.getElementById('ordersError').textContent = e.message;
  }
}

async function startMatch() {
  // Handled via the orders form's "Submit & Start Match" button (submitOrdersForm).
  // Kept as a no-op fallback in case adminControls' hidden startBtn is ever shown.
}

// ---- Scoreboard ----

function pointLabel(count, otherCount, noAd) {
  const labels = ['0', '15', '30', '40'];
  if (count < 3 && otherCount < 3) return labels[count];
  if (count < 3) return labels[count];
  if (otherCount < 3) return '40';
  if (count === otherCount) return 'Deuce';
  if (noAd) return '40';
  return count > otherCount ? 'Ad' : '40';
}

function setLabel(set, idx) {
  let label = `Set${idx + 1}: ${set.p1Games}-${set.p2Games}`;
  if (set.tiebreak && set.wonBy) label += ` (TB: ${set.tiebreak.p1}-${set.tiebreak.p2})`;
  return label;
}

function buildSetsSummary(s) {
  const parts = s.sets.map((set, idx) => setLabel(set, idx));
  if (s.matchTiebreak) parts.push(`Match Tiebreak: ${s.matchTiebreak.p1}-${s.matchTiebreak.p2}`);
  return parts.join(' | ');
}

function renderScoreboard() {
  const board = document.getElementById('scoreboard');
  if (match.status === 'scheduled' || match.status === 'toss_done' || !match.score || match.score.sets.length === 0) {
    board.style.display = 'none';
    return;
  }
  board.style.display = 'block';
  const s = match.score;
  const setsStr = buildSetsSummary(s);
  const noAd = match.formatType === 'group';

  let pointsStr = '';
  if (s.inMatchTiebreak && s.matchTiebreak) {
    pointsStr = `${s.matchTiebreak.p1} - ${s.matchTiebreak.p2} (10-Point Match Tiebreak)`;
  } else if (s.inSetTiebreak && s.sets[s.currentSetIndex].tiebreak) {
    const tb = s.sets[s.currentSetIndex].tiebreak;
    pointsStr = `${tb.p1} - ${tb.p2} (7-Point Set Tiebreak${tb.winBy2 ? ', win by 2' : ''})`;
  } else if (s.pendingOrders) {
    pointsStr = 'Waiting for next set\'s serve/receive order...';
  } else {
    pointsStr = `${pointLabel(s.game.p1Points, s.game.p2Points, noAd)} - ${pointLabel(s.game.p2Points, s.game.p1Points, noAd)}`;
  }

  let serverBlock = '';
  if (match.serveInfo) {
    const si = match.serveInfo;
    serverBlock = `
      <div class="server-tag">Serving: ${si.servingPlayer} (${match[si.servingTeam].name}) - from the ${si.courtSide === 'deuce' ? 'Deuce' : 'Ad'} Court</div>
      <div class="receiver-tag">Receiving: ${si.receivingPlayer} (${match[si.receivingTeam].name})</div>
    `;
  }

  board.innerHTML = `
    <div class="names">${playerPills(match.team1.name)} <span class="small-note">vs</span> ${playerPills(match.team2.name)}</div>
    <div class="sets">${setsStr}</div>
    <div class="points">${pointsStr}</div>
    ${serverBlock}
    ${s.winner ? `<div class="server-tag">Winner: ${match[s.winner].name} 🏆</div>` : ''}
  `;
}

// ---- Admin scoring controls ----

function renderAdminControls() {
  const controls = document.getElementById('adminControls');
  const finishBtn = document.getElementById('finishBtn');
  const startBtn = document.getElementById('startBtn');
  startBtn.style.display = 'none'; // starting happens via the orders form now

  if (!isAdmin) { controls.style.display = 'none'; return; }

  document.getElementById('t1NameBtn').textContent = match.team1.name;
  document.getElementById('t2NameBtn').textContent = match.team2.name;

  const canScore = match.status === 'in_progress' && match.score && !match.score.pendingOrders;

  if (match.status === 'in_progress' || match.status === 'completed') {
    controls.style.display = 'block';
    finishBtn.style.display = match.status === 'in_progress' ? 'inline-block' : 'none';
    document.querySelectorAll('.point-buttons button').forEach(b => b.disabled = !canScore);
  } else {
    controls.style.display = 'none';
  }
}

function openFinishPanel() {
  document.getElementById('finishPanel').style.display = 'block';
  const row = document.getElementById('finishWinnerRow');
  if (!match.score.winner) {
    row.style.display = 'flex';
    document.querySelector('#finishWinnerSel option[value="team1"]').textContent = match.team1.name;
    document.querySelector('#finishWinnerSel option[value="team2"]').textContent = match.team2.name;
  } else {
    row.style.display = 'none';
  }
  document.getElementById('finishError').textContent = '';
}

function closeFinishPanel() {
  document.getElementById('finishPanel').style.display = 'none';
}

async function confirmFinish() {
  try {
    const body = { expectedVersion: match.version };
    if (!match.score.winner) body.winner = document.getElementById('finishWinnerSel').value;
    const res = await Api.post(`${API_BASE}/${matchNumber}/finish`, body);
    match = res.match;
    closeFinishPanel();
    logEvent('Match marked as finished.');
    render();
  } catch (e) {
    document.getElementById('finishError').textContent = e.message;
  }
}

async function addPoint(scorer) {
  try {
    const res = await Api.post(`${API_BASE}/${matchNumber}/point`, { scorer, expectedVersion: match.version });
    match = res.match;
    (res.events || []).forEach(logEvent);
    const banner = document.getElementById('switchBanner');
    if (res.switchSuggestion) {
      banner.style.display = 'block';
      banner.textContent = res.switchSuggestion;
    } else {
      banner.style.display = 'none';
    }
    render();
  } catch (e) {
    logEvent('Error: ' + e.message);
  }
}

async function undoPoint() {
  try {
    const res = await Api.post(`${API_BASE}/${matchNumber}/undo`);
    match = res.match;
    logEvent('Last point undone.');
    document.getElementById('switchBanner').style.display = 'none';
    render();
  } catch (e) {
    logEvent('Error: ' + e.message);
  }
}

function logEvent(text) {
  const log = document.getElementById('eventLog');
  const div = document.createElement('div');
  div.textContent = text;
  log.prepend(div);
}

// ---- Master render ----

function render() {
  renderSchedule();
  renderToss();
  renderOrders();
  renderTimer();
  renderScoreboard();
  renderAdminControls();
}

(async function init() {
  await initShared('matches');
  await loadTeams();
  await loadMatch();
  connectSocket();
  await acquireLockIfAdmin();
  startTimerTicker();
})();
