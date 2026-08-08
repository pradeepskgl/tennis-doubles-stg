const express = require('express');
const Match = require('../models/Match');
const { requireAuth } = require('../middleware/auth');
const engine = require('../utils/doublesRulesEngine');

const router = express.Router();
const LOCK_TTL_MS = parseFloat(process.env.LOCK_TTL_SECONDS || '90') * 1000;

function lockIsActive(match) {
  return match.lock && match.lock.sessionId && match.lock.lockedAt &&
    (Date.now() - new Date(match.lock.lockedAt).getTime()) < LOCK_TTL_MS;
}

function requireLockOwnership(req, res, next) {
  const match = req.match;
  if (lockIsActive(match) && match.lock.sessionId !== req.sessionId) {
    return res.status(423).json({
      error: 'This match is currently being edited in another session. Please wait or try again shortly.',
      lockedAt: match.lock.lockedAt
    });
  }
  next();
}

async function loadMatch(req, res, next) {
  const match = await Match.findOne({ matchNumber: Number(req.params.matchNumber) });
  if (!match) return res.status(404).json({ error: 'Match not found.' });
  req.match = match;
  next();
}

function broadcast(io, match) {
  const payload = matchWithServeInfo(match);
  io.to(`match:${match.matchNumber}`).emit('match:update', payload);
  io.to('matches').emit('matches:update', { matchNumber: match.matchNumber });
}

function matchWithServeInfo(match) {
  const obj = match.toObject ? match.toObject() : match;
  obj.serveInfo = engine.getCurrentServeInfo(obj.score);
  return obj;
}

function validOrders(body) {
  const { firstServingTeam, team1ServeOrder, team1ReceiveOrder, team2ServeOrder, team2ReceiveOrder } = body;
  if (!['team1', 'team2'].includes(firstServingTeam)) return 'firstServingTeam must be team1 or team2.';
  for (const [label, arr] of [
    ['team1ServeOrder', team1ServeOrder], ['team1ReceiveOrder', team1ReceiveOrder],
    ['team2ServeOrder', team2ServeOrder], ['team2ReceiveOrder', team2ReceiveOrder]
  ]) {
    if (!Array.isArray(arr) || arr.length !== 2 || !arr[0] || !arr[1]) {
      return `${label} must contain exactly 2 player names.`;
    }
  }
  return null;
}

// ---- Public read endpoints ----

router.get('/', async (req, res) => {
  const matches = await Match.find().sort({ matchNumber: 1 }).lean();
  res.json(matches);
});

router.get('/:matchNumber', loadMatch, (req, res) => {
  res.json(matchWithServeInfo(req.match));
});

// ---- Lock endpoints ----

router.post('/:matchNumber/lock', requireAuth, loadMatch, async (req, res) => {
  const match = req.match;
  if (lockIsActive(match) && match.lock.sessionId !== req.sessionId) {
    return res.status(423).json({ error: 'Already locked by another session.' });
  }
  match.lock = { sessionId: req.sessionId, lockedAt: new Date() };
  await match.save();
  res.json({ ok: true, lock: match.lock });
});

router.post('/:matchNumber/lock/refresh', requireAuth, loadMatch, requireLockOwnership, async (req, res) => {
  const match = req.match;
  match.lock = { sessionId: req.sessionId, lockedAt: new Date() };
  await match.save();
  res.json({ ok: true, lock: match.lock });
});

router.delete('/:matchNumber/lock', requireAuth, loadMatch, async (req, res) => {
  const match = req.match;
  if (match.lock && match.lock.sessionId === req.sessionId) {
    match.lock = { sessionId: null, lockedAt: null };
    await match.save();
  }
  res.json({ ok: true });
});

// ---- Schedule editing (time/session/format - team names are edited via /api/teams) ----

router.patch('/:matchNumber/schedule', requireAuth, loadMatch, requireLockOwnership, async (req, res) => {
  const match = req.match;
  const { scheduledStart, scheduledEnd, session, decidingSet, formatType, expectedVersion } = req.body;

  if (typeof expectedVersion === 'number' && expectedVersion !== match.version) {
    return res.status(409).json({ error: 'Match was updated elsewhere. Please reload.', match });
  }

  if (scheduledStart !== undefined) match.scheduledStart = scheduledStart;
  if (scheduledEnd !== undefined) match.scheduledEnd = scheduledEnd;
  if (session !== undefined) match.session = session;
  if (decidingSet !== undefined && ['match_tiebreak', 'full_set'].includes(decidingSet)) match.decidingSet = decidingSet;

  // Game format is only choosable for Semifinal matches (Group is always No-Ad per the
  // rulebook; Final is always the Regular/Ad-scoring format). It also can't be changed
  // once the match has started, since switching scoring rules mid-match would corrupt
  // the in-progress score.
  if (formatType !== undefined && ['group', 'final'].includes(formatType)) {
    if (match.stage !== 'Semifinal') {
      return res.status(400).json({ error: 'Game format can only be changed for Semifinal matches.' });
    }
    if (match.status === 'in_progress' || match.status === 'completed') {
      return res.status(400).json({ error: 'Game format cannot be changed after the match has started.' });
    }
    match.formatType = formatType;
  }

  match.version += 1;
  await match.save();
  broadcast(req.app.get('io'), match);
  res.json({ ok: true, match: matchWithServeInfo(match) });
});

// ---- Coin toss ----

router.post('/:matchNumber/toss', requireAuth, loadMatch, requireLockOwnership, async (req, res) => {
  const match = req.match;
  const { tossWinner, winnerChoice, serveChoiceTeam, serveDecision, endChoiceTeam, end, expectedVersion } = req.body;

  if (typeof expectedVersion === 'number' && expectedVersion !== match.version) {
    return res.status(409).json({ error: 'Match was updated elsewhere. Please reload.', match });
  }
  if (!['team1', 'team2'].includes(tossWinner)) return res.status(400).json({ error: 'tossWinner must be team1 or team2.' });
  if (!['serve', 'end', 'defer'].includes(winnerChoice)) return res.status(400).json({ error: 'winnerChoice must be serve, end, or defer.' });

  match.coinToss = {
    tossWinner,
    winnerChoice,
    serveChoice: { team: serveChoiceTeam || null, decision: serveDecision || null },
    endChoice: { team: endChoiceTeam || null, end: end || null },
    recordedAt: new Date()
  };
  match.status = 'toss_done';
  match.version += 1;
  await match.save();
  broadcast(req.app.get('io'), match);
  res.json({ ok: true, match: matchWithServeInfo(match) });
});

// ---- Start match: requires toss done + Set 1 serve/receive orders ----

router.post('/:matchNumber/start', requireAuth, loadMatch, requireLockOwnership, async (req, res) => {
  const match = req.match;
  if (match.status === 'in_progress' || match.status === 'completed') {
    return res.status(400).json({ error: 'Match has already been started.' });
  }
  if (!match.coinToss || !match.coinToss.recordedAt) {
    return res.status(400).json({ error: 'Coin toss must be recorded before starting the match.' });
  }
  const err = validOrders(req.body);
  if (err) return res.status(400).json({ error: err });

  const orders = {
    firstServingTeam: req.body.firstServingTeam,
    team1ServeOrder: req.body.team1ServeOrder,
    team1ReceiveOrder: req.body.team1ReceiveOrder,
    team2ServeOrder: req.body.team2ServeOrder,
    team2ReceiveOrder: req.body.team2ReceiveOrder
  };

  let score = engine.newMatchScore();
  score = engine.submitOrders(score, orders);
  match.score = score;
  match.status = 'in_progress';
  match.history = [];
  match.actualStart = new Date();
  match.actualEnd = null;
  match.version += 1;
  await match.save();
  broadcast(req.app.get('io'), match);
  res.json({ ok: true, match: matchWithServeInfo(match) });
});

// ---- Submit orders for a new set (set 2, or a 3rd deciding set in Final full_set mode) ----

router.post('/:matchNumber/orders', requireAuth, loadMatch, requireLockOwnership, async (req, res) => {
  const match = req.match;
  if (match.status !== 'in_progress') return res.status(400).json({ error: 'Match is not in progress.' });
  if (!match.score || !match.score.pendingOrders) return res.status(400).json({ error: 'No pending order submission is needed right now.' });

  const err = validOrders(req.body);
  if (err) return res.status(400).json({ error: err });

  const orders = {
    firstServingTeam: req.body.firstServingTeam,
    team1ServeOrder: req.body.team1ServeOrder,
    team1ReceiveOrder: req.body.team1ReceiveOrder,
    team2ServeOrder: req.body.team2ServeOrder,
    team2ReceiveOrder: req.body.team2ReceiveOrder
  };

  match.score = engine.submitOrders(match.score, orders);
  match.version += 1;
  await match.save();
  broadcast(req.app.get('io'), match);
  res.json({ ok: true, match: matchWithServeInfo(match) });
});

// ---- Scoring: add a point ----

router.post('/:matchNumber/point', requireAuth, loadMatch, requireLockOwnership, async (req, res) => {
  const match = req.match;
  const { scorer, expectedVersion } = req.body;

  if (typeof expectedVersion === 'number' && expectedVersion !== match.version) {
    return res.status(409).json({ error: 'Match was updated elsewhere. Please reload.', match });
  }
  if (!['team1', 'team2'].includes(scorer)) return res.status(400).json({ error: 'scorer must be team1 or team2.' });
  if (match.status !== 'in_progress') return res.status(400).json({ error: 'Match is not in progress.' });
  if (match.score.pendingOrders) return res.status(400).json({ error: 'Submit the serve/receive order for this set before scoring.' });

  match.history.push(JSON.parse(JSON.stringify(match.score)));
  if (match.history.length > 80) match.history.shift();

  const { score, events, switchSuggestion } = engine.addPoint(match.score, match.formatType, match.decidingSet, scorer);
  match.score = score;
  if (score.winner) {
    match.status = 'completed';
    match.actualEnd = new Date();
    await propagateWinner(match);
  }
  match.version += 1;
  await match.save();
  broadcast(req.app.get('io'), match);
  res.json({ ok: true, match: matchWithServeInfo(match), events, switchSuggestion });
});

// ---- Undo last point ----

router.post('/:matchNumber/undo', requireAuth, loadMatch, requireLockOwnership, async (req, res) => {
  const match = req.match;
  if (!match.history || match.history.length === 0) return res.status(400).json({ error: 'No previous point to undo.' });
  match.score = match.history.pop();
  if (match.status === 'completed') {
    match.status = 'in_progress';
    match.actualEnd = null;
  }
  match.version += 1;
  await match.save();
  broadcast(req.app.get('io'), match);
  res.json({ ok: true, match: matchWithServeInfo(match) });
});

// ---- Manually finish a match (retirement/walkover) ----

router.post('/:matchNumber/finish', requireAuth, loadMatch, requireLockOwnership, async (req, res) => {
  const match = req.match;
  const { winner, expectedVersion } = req.body;

  if (match.status === 'completed') return res.status(400).json({ error: 'Match is already marked as finished.' });
  if (match.status !== 'in_progress') return res.status(400).json({ error: 'Match must be in progress before it can be marked finished.' });
  if (typeof expectedVersion === 'number' && expectedVersion !== match.version) {
    return res.status(409).json({ error: 'Match was updated elsewhere. Please reload.', match });
  }

  if (!match.score.winner) {
    if (!['team1', 'team2'].includes(winner)) return res.status(400).json({ error: 'A winner must be selected to finish a match with no completed score.' });
    match.score.winner = winner;
  }
  match.status = 'completed';
  match.actualEnd = new Date();
  match.version += 1;
  await match.save();
  await propagateWinner(match);
  broadcast(req.app.get('io'), match);
  res.json({ ok: true, match: matchWithServeInfo(match) });
});

async function propagateWinner(match) {
  if (!match.nextMatch || !match.nextMatchSlot) return;
  const winnerTeam = match.score.winner === 'team1' ? match.team1 : match.team2;
  const nextMatch = await Match.findOne({ matchNumber: match.nextMatch });
  if (!nextMatch) return;
  nextMatch[match.nextMatchSlot] = { teamId: winnerTeam.teamId, code: winnerTeam.code, name: winnerTeam.name, sourceGroup: null };
  nextMatch.version += 1;
  await nextMatch.save();
}

module.exports = router;
