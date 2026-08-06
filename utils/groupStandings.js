/**
 * Computes group-stage standings from completed matches within a single group,
 * per the rulebook (section 1.1 Group Winner Selection):
 *   1. Match points: Win = 2, Loss = 0.
 *   2. If one team wins both group matches, it qualifies outright.
 *   3. If all three teams finish 1-1 (2 points each), rank by:
 *        a. Highest game difference (games won - games lost)
 *        b. Highest total games won
 *        c. Coin toss / drawing lots (cannot be automated - flagged for manual admin decision)
 *   Match-tiebreak points never count as games won/lost.
 */

function computeGroupStandings(teams, matches) {
  const stats = {}; // teamCode -> { teamId, code, name, matchPoints, wins, losses, gamesWon, gamesLost, played }

  teams.forEach(t => {
    stats[t.code] = {
      teamId: t._id ? t._id.toString() : t.code,
      code: t.code,
      name: t.name || `${t.player1} & ${t.player2}`,
      matchPoints: 0,
      wins: 0,
      losses: 0,
      gamesWon: 0,
      gamesLost: 0,
      played: 0
    };
  });

  const completed = matches.filter(m => m.status === 'completed' && m.score && m.score.winner);

  for (const m of completed) {
    const t1Code = m.team1.code;
    const t2Code = m.team2.code;
    if (!stats[t1Code] || !stats[t2Code]) continue; // skip if team data incomplete

    let p1Games = 0, p2Games = 0;
    for (const set of (m.score.sets || [])) {
      p1Games += set.p1Games || 0;
      p2Games += set.p2Games || 0;
    }

    stats[t1Code].played += 1;
    stats[t2Code].played += 1;
    stats[t1Code].gamesWon += p1Games;
    stats[t1Code].gamesLost += p2Games;
    stats[t2Code].gamesWon += p2Games;
    stats[t2Code].gamesLost += p1Games;

    const winnerCode = m.score.winner === 'team1' ? t1Code : t2Code;
    const loserCode = m.score.winner === 'team1' ? t2Code : t1Code;
    stats[winnerCode].matchPoints += 2;
    stats[winnerCode].wins += 1;
    stats[loserCode].losses += 1;
  }

  const list = Object.values(stats).map(s => ({ ...s, gameDiff: s.gamesWon - s.gamesLost }));

  // An outright 2-0 team (matchPoints=4 in a 3-team round robin) always ranks 1st.
  // Otherwise sort by matchPoints, then gameDiff, then gamesWon.
  list.sort((a, b) => {
    if (b.matchPoints !== a.matchPoints) return b.matchPoints - a.matchPoints;
    if (b.gameDiff !== a.gameDiff) return b.gameDiff - a.gameDiff;
    return b.gamesWon - a.gamesWon;
  });

  // Detect whether the top spot is a genuine tie needing manual resolution
  // (all played, same matchPoints, same gameDiff, same gamesWon at rank 1).
  const allPlayed = list.every(s => s.played === teams.length - 1); // each team has played everyone else in a 3-team group
  let needsManualTiebreak = false;
  if (allPlayed && list.length >= 2) {
    const top = list[0];
    const tiedWithTop = list.filter(s =>
      s.matchPoints === top.matchPoints && s.gameDiff === top.gameDiff && s.gamesWon === top.gamesWon
    );
    if (tiedWithTop.length > 1) needsManualTiebreak = true;
  }

  return { standings: list, needsManualTiebreak, allMatchesPlayed: allPlayed };
}

module.exports = { computeGroupStandings };
