/**
 * Pure doubles scoring engine. No DB / Express dependencies, unit-testable in isolation.
 *
 * Format rules (from the tournament rulebook):
 *
 * 'group' formatType (Group Stage + Semifinals):
 *   - No-Ad game scoring (sudden deciding point at 40-40)
 *   - Sets first to 6 games, win by 2
 *   - At 6-6: 7-point tiebreak, NO win-by-2 required (first to 7 wins outright)
 *   - Sets split 1-1: 10-point match tiebreak, win by 2, decides the match (no 3rd set ever)
 *
 * 'final' formatType (Final only):
 *   - Traditional Advantage scoring
 *   - Sets first to 6 games, win by 2
 *   - At 6-6: 7-point tiebreak, WIN BY 2 required
 *   - Sets split 1-1: either a 10-point match tiebreak (win by 2) OR a full 3rd set,
 *     per the match's decidingSet setting
 *
 * Serve/receive rotation (both formats):
 *   - Each set has its own admin-submitted "orders": which team serves game 1, each
 *     team's fixed serve order (2 players) and fixed receive order (deuce-court
 *     player, ad-court player).
 *   - Server for game N (0-indexed) = rotation[N % 4], where rotation cycles
 *     [firstTeam-p0, otherTeam-p0, firstTeam-p1, otherTeam-p1].
 *   - Within a game, court side alternates deuce/ad based on total points played
 *     so far (even = deuce, odd = ad).
 *   - Tiebreaks (7pt or 10pt): reuse the current/just-finished set's rotation,
 *     starting from whichever slot is "due" next (gamesPlayedInSet % 4). Point 1
 *     is a single point by that slot; then each slot serves 2 consecutive points,
 *     cycling through all 4. Point parity (odd/even) determines deuce/ad court,
 *     independent of team.
 */

const otherTeam = t => (t === 'team1' ? 'team2' : 'team1');

function freshSet(orders) {
  return { p1Games: 0, p2Games: 0, wonBy: null, tiebreak: null, orders };
}

function newMatchScore() {
  return {
    sets: [],
    currentSetIndex: 0,
    game: { p1Points: 0, p2Points: 0 },
    matchTiebreak: null,
    inSetTiebreak: false,
    inMatchTiebreak: false,
    pendingOrders: true, // must submitOrders() before the first point of set 1
    winner: null
  };
}

// orders = { firstServingTeam, team1ServeOrder:[p1,p2], team1ReceiveOrder:[deuceP,adP], team2ServeOrder, team2ReceiveOrder }
function submitOrders(score, orders) {
  const s = JSON.parse(JSON.stringify(score));
  if (s.sets.length === s.currentSetIndex) {
    s.sets.push(freshSet(orders));
  } else {
    s.sets[s.currentSetIndex].orders = orders;
  }
  s.game = { p1Points: 0, p2Points: 0 };
  s.pendingOrders = false;
  return s;
}

function buildRotation(orders) {
  const first = orders.firstServingTeam;
  const other = otherTeam(first);
  return [
    { team: first, idx: 0 },
    { team: other, idx: 0 },
    { team: first, idx: 1 },
    { team: other, idx: 1 }
  ];
}

function slotServerName(slot, orders) {
  return orders[`${slot.team}ServeOrder`][slot.idx];
}

// k = rotation start offset (which slot is "due" next)
function tiebreakSlot(pointNumber, rotation, k) {
  const r = [rotation[k % 4], rotation[(k + 1) % 4], rotation[(k + 2) % 4], rotation[(k + 3) % 4]];
  if (pointNumber <= 1) return r[0];
  const idx = pointNumber - 2;
  const group = Math.floor(idx / 2);
  return r[(group + 1) % 4];
}

function isTiebreakSwitchPoint(pointNumber) {
  return pointNumber % 6 === 0;
}

/**
 * Returns the current server/receiver/court-side info for display, or null if
 * no point can be played right now (match not started, orders pending, or over).
 */
function getCurrentServeInfo(score) {
  if (!score || score.winner || score.pendingOrders) return null;

  if (score.inMatchTiebreak && score.matchTiebreak) {
    const tb = score.matchTiebreak;
    const orders = tb.sourceOrders;
    const rotation = buildRotation(orders);
    const totalPts = tb.p1 + tb.p2;
    const pointNumber = totalPts + 1;
    const slot = tiebreakSlot(pointNumber, rotation, tb.startIndex);
    const servingTeam = slot.team;
    const receivingTeam = otherTeam(servingTeam);
    const courtSide = pointNumber % 2 === 1 ? 'deuce' : 'ad';
    return {
      servingTeam,
      servingPlayer: slotServerName(slot, orders),
      receivingTeam,
      receivingPlayer: orders[`${receivingTeam}ReceiveOrder`][courtSide === 'deuce' ? 0 : 1],
      courtSide,
      pointNumber,
      context: 'Match Tiebreak'
    };
  }

  const set = score.sets[score.currentSetIndex];
  if (!set || !set.orders) return null;

  if (score.inSetTiebreak && set.tiebreak) {
    const tb = set.tiebreak;
    const rotation = buildRotation(set.orders);
    const k = (set.p1Games + set.p2Games) % 4;
    const totalPts = tb.p1 + tb.p2;
    const pointNumber = totalPts + 1;
    const slot = tiebreakSlot(pointNumber, rotation, k);
    const servingTeam = slot.team;
    const receivingTeam = otherTeam(servingTeam);
    const courtSide = pointNumber % 2 === 1 ? 'deuce' : 'ad';
    return {
      servingTeam,
      servingPlayer: slotServerName(slot, set.orders),
      receivingTeam,
      receivingPlayer: set.orders[`${receivingTeam}ReceiveOrder`][courtSide === 'deuce' ? 0 : 1],
      courtSide,
      pointNumber,
      context: 'Set Tiebreak'
    };
  }

  const rotation = buildRotation(set.orders);
  const gamesPlayed = set.p1Games + set.p2Games;
  const slot = rotation[gamesPlayed % 4];
  const servingTeam = slot.team;
  const receivingTeam = otherTeam(servingTeam);
  const totalPlayed = score.game.p1Points + score.game.p2Points;
  const courtSide = totalPlayed % 2 === 0 ? 'deuce' : 'ad';
  return {
    servingTeam,
    servingPlayer: slotServerName(slot, set.orders),
    receivingTeam,
    receivingPlayer: set.orders[`${receivingTeam}ReceiveOrder`][courtSide === 'deuce' ? 0 : 1],
    courtSide,
    context: 'Game'
  };
}

function pointLabel(count, otherCount, noAd) {
  const labels = ['0', '15', '30', '40'];
  if (count < 3 && otherCount < 3) return labels[count];
  if (count < 3) return labels[count];
  if (otherCount < 3) return '40';
  if (count === otherCount) return 'Deuce';
  if (noAd) return '40';
  return count > otherCount ? 'Ad' : '40';
}

/**
 * @param {object} score
 * @param {string} formatType - 'group' | 'final'
 * @param {string} decidingSet - 'match_tiebreak' | 'full_set' (only affects 'final')
 * @param {string} scorer - 'team1' | 'team2'
 */
function addPoint(score, formatType, decidingSet, scorer) {
  const s = JSON.parse(JSON.stringify(score));
  const events = [];
  let switchSuggestion = null;

  if (s.winner) return { score: s, events: ['Match already completed.'], switchSuggestion: null };
  if (s.pendingOrders) return { score: s, events: ['Serve/receive order must be submitted before play can continue.'], switchSuggestion: null };

  const noAd = formatType === 'group';
  const effectiveDecidingSet = formatType === 'group' ? 'match_tiebreak' : (decidingSet || 'match_tiebreak');
  const winnerP = scorer;
  const loserP = otherTeam(scorer);

  // ---- 1. Match tiebreak in progress ----
  if (s.inMatchTiebreak) {
    const tb = s.matchTiebreak;
    tb[winnerP === 'team1' ? 'p1' : 'p2'] += 1;
    const total = tb.p1 + tb.p2;
    events.push(`Match tiebreak point to ${winnerP}: ${tb.p1}-${tb.p2}`);
    if (isTiebreakSwitchPoint(total)) switchSuggestion = 'Switch ends now (match tiebreak).';

    const lead = Math.abs(tb.p1 - tb.p2);
    const high = Math.max(tb.p1, tb.p2);
    if (high >= 10 && lead >= 2) {
      s.winner = winnerP;
      events.push(`${winnerP} wins the match tiebreak ${tb.p1}-${tb.p2} and the match!`);
    }
    return { score: s, events, switchSuggestion };
  }

  // ---- 2. Set tiebreak in progress ----
  if (s.inSetTiebreak) {
    const set = s.sets[s.currentSetIndex];
    const tb = set.tiebreak;
    tb[winnerP === 'team1' ? 'p1' : 'p2'] += 1;
    const total = tb.p1 + tb.p2;
    events.push(`Set tiebreak point to ${winnerP}: ${tb.p1}-${tb.p2}`);
    if (isTiebreakSwitchPoint(total)) switchSuggestion = 'Switch ends now (tiebreak).';

    let setWon = false;
    if (tb.winBy2) {
      const lead = Math.abs(tb.p1 - tb.p2);
      const high = Math.max(tb.p1, tb.p2);
      if (high >= tb.target && lead >= 2) setWon = true;
    } else {
      if (tb.p1 >= tb.target || tb.p2 >= tb.target) setWon = true;
    }

    if (setWon) {
      set.wonBy = winnerP;
      if (winnerP === 'team1') set.p1Games = Math.max(set.p1Games, set.p2Games + 1);
      else set.p2Games = Math.max(set.p2Games, set.p1Games + 1);
      s.inSetTiebreak = false;
      events.push(`${winnerP} wins the set tiebreak and the set!`);

      const setsWonT1 = s.sets.filter(x => x.wonBy === 'team1').length;
      const setsWonT2 = s.sets.filter(x => x.wonBy === 'team2').length;

      if (setsWonT1 === 2 || setsWonT2 === 2) {
        s.winner = setsWonT1 === 2 ? 'team1' : 'team2';
        events.push(`${s.winner} wins the match!`);
      } else if (setsWonT1 === 1 && setsWonT2 === 1 && effectiveDecidingSet === 'match_tiebreak') {
        const k = (set.p1Games + set.p2Games) % 4;
        s.inMatchTiebreak = true;
        s.matchTiebreak = { p1: 0, p2: 0, target: 10, winBy2: true, sourceOrders: set.orders, startIndex: k };
        events.push('Sets tied 1-1: playing a 10-point match tiebreak instead of a 3rd set.');
        switchSuggestion = 'Change ends before the match tiebreak.';
      } else {
        s.currentSetIndex += 1;
        s.pendingOrders = true;
        events.push(setsWonT1 === 1 && setsWonT2 === 1
          ? 'Sets tied 1-1: submit serve/receive order for the 3rd (deciding) set.'
          : 'Submit serve/receive order for the next set.');
      }
    }
    return { score: s, events, switchSuggestion };
  }

  // ---- 3. Normal game in progress ----
  const set = s.sets[s.currentSetIndex];
  const game = s.game;
  const key = winnerP === 'team1' ? 'p1Points' : 'p2Points';
  const otherKey = winnerP === 'team1' ? 'p2Points' : 'p1Points';
  game[key] += 1;

  const p1Label = pointLabel(game.p1Points, game.p2Points, noAd);
  const p2Label = pointLabel(game.p2Points, game.p1Points, noAd);
  events.push(`Point to ${winnerP}: ${p1Label}-${p2Label}`);

  let gameWon = false;
  if (noAd) {
    if (game[key] >= 4) gameWon = true;
  } else {
    if (game[key] >= 4 && (game[key] - game[otherKey]) >= 2) gameWon = true;
  }
  if (!gameWon) return { score: s, events, switchSuggestion };

  if (winnerP === 'team1') set.p1Games += 1; else set.p2Games += 1;
  events.push(`${winnerP} wins the game. Games: ${set.p1Games}-${set.p2Games}`);

  const totalGamesInSet = set.p1Games + set.p2Games;
  if (totalGamesInSet % 2 === 1) switchSuggestion = 'Switch ends now.';

  s.game = { p1Points: 0, p2Points: 0 };

  let setDecided = false;
  if (set.p1Games >= 6 && (set.p1Games - set.p2Games) >= 2) { set.wonBy = 'team1'; setDecided = true; }
  else if (set.p2Games >= 6 && (set.p2Games - set.p1Games) >= 2) { set.wonBy = 'team2'; setDecided = true; }
  else if (set.p1Games === 6 && set.p2Games === 6) {
    s.inSetTiebreak = true;
    set.tiebreak = { p1: 0, p2: 0, target: 7, winBy2: formatType === 'final' };
    events.push(`Set reaches 6-6: playing a 7-point tiebreak${formatType === 'final' ? ' (win by 2)' : ' (first to 7 wins)'}.`);
  }

  if (setDecided) {
    events.push(`${set.wonBy} wins the set ${set.p1Games}-${set.p2Games}!`);
    const setsWonT1 = s.sets.filter(x => x.wonBy === 'team1').length;
    const setsWonT2 = s.sets.filter(x => x.wonBy === 'team2').length;

    if (setsWonT1 === 2 || setsWonT2 === 2) {
      s.winner = setsWonT1 === 2 ? 'team1' : 'team2';
      events.push(`${s.winner} wins the match!`);
    } else if (setsWonT1 === 1 && setsWonT2 === 1 && effectiveDecidingSet === 'match_tiebreak') {
      const k = totalGamesInSet % 4;
      s.inMatchTiebreak = true;
      s.matchTiebreak = { p1: 0, p2: 0, target: 10, winBy2: true, sourceOrders: set.orders, startIndex: k };
      events.push('Sets tied 1-1: playing a 10-point match tiebreak instead of a 3rd set.');
      switchSuggestion = 'Change ends before the match tiebreak.';
    } else {
      s.currentSetIndex += 1;
      s.pendingOrders = true;
      events.push(setsWonT1 === 1 && setsWonT2 === 1
        ? 'Sets tied 1-1: submit serve/receive order for the 3rd (deciding) set.'
        : 'Submit serve/receive order for the next set.');
    }
  }

  return { score: s, events, switchSuggestion };
}

module.exports = {
  newMatchScore,
  submitOrders,
  addPoint,
  getCurrentServeInfo,
  pointLabel,
  buildRotation,
  tiebreakSlot,
  otherTeam
};
