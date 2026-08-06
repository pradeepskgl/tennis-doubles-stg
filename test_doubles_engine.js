const { newMatchScore, submitOrders, addPoint, getCurrentServeInfo } = require('./utils/doublesRulesEngine');

let failures = 0;
function check(name, cond) {
  if (!cond) { console.log('FAIL:', name); failures++; }
  else console.log('PASS:', name);
}

const orders1 = {
  firstServingTeam: 'team1',
  team1ServeOrder: ['T1-Alice', 'T1-Bob'],
  team1ReceiveOrder: ['T1-Alice', 'T1-Bob'], // [deuceCourt, adCourt]
  team2ServeOrder: ['T2-Carl', 'T2-Dave'],
  team2ReceiveOrder: ['T2-Carl', 'T2-Dave']
};

function play(formatType, decidingSet, sequence, orders) {
  let score = newMatchScore();
  score = submitOrders(score, orders || orders1);
  let log = [];
  for (const scorer of sequence) {
    const r = addPoint(score, formatType, decidingSet, scorer);
    score = r.score;
    log.push(...r.events);
    if (r.switchSuggestion) log.push('SWITCH: ' + r.switchSuggestion);
    // If a new set just began (pendingOrders true), auto-submit same orders for tests
    // that don't specifically test order changes.
    if (score.pendingOrders && !score.winner) score = submitOrders(score, orders || orders1);
  }
  return { score, log };
}

function winGame(w) { return [w, w, w, w]; }

// ---- Test 1: No-Ad game (group format) ----
let r1 = play('group', 'match_tiebreak', ['team1', 'team1', 'team1', 'team2', 'team2', 'team2', 'team2']);
check('Group No-Ad: sudden death point at 40-40 decides game outright', r1.score.sets[0].p2Games === 1);

// ---- Test 2: Group set win 6-0 ----
let seq = [];
for (let g = 0; g < 6; g++) seq.push(...winGame('team1'));
let r2 = play('group', 'match_tiebreak', seq);
check('Group set won 6-0', r2.score.sets[0].p1Games === 6 && r2.score.sets[0].wonBy === 'team1');

// ---- Test 3: Group set tiebreak at 6-6, NO win-by-2 (first to 7 wins even 7-6... but here 7-5) ----
seq = [];
for (let i = 0; i < 6; i++) { seq.push(...winGame('team1')); seq.push(...winGame('team2')); }
// now 6-6, tiebreak: team2 to 7, team1 to 5 -> team2 should win outright at 7 pts even without 2-pt margin
let tbSeq = [];
for (let i = 0; i < 10; i++) tbSeq.push(i % 2 === 0 ? 'team1' : 'team2'); // 5-5
tbSeq.push('team2', 'team2'); // 5-7 -> team2 wins at 7 (lead only 2, but even 1-pt lead would suffice per rule)
let r3 = play('group', 'match_tiebreak', seq.concat(tbSeq));
check('Group 7pt set tiebreak: first to 7 wins outright (no win-by-2 required)',
  r3.score.sets[0].wonBy === 'team2' && r3.score.sets[0].tiebreak.p1 === 5 && r3.score.sets[0].tiebreak.p2 === 7);

// ---- Test 4: Final set tiebreak REQUIRES win-by-2 ----
seq = [];
for (let i = 0; i < 6; i++) { seq.push(...winGame('team1')); seq.push(...winGame('team2')); }
tbSeq = [];
for (let i = 0; i < 12; i++) tbSeq.push(i % 2 === 0 ? 'team1' : 'team2'); // 6-6
tbSeq.push('team2'); // 6-7, not decided (need lead of 2)
let r4a = play('final', 'match_tiebreak', seq.concat(tbSeq));
check('Final set tiebreak: 6-7 does NOT win (no 2pt lead yet)', r4a.score.inSetTiebreak === true && r4a.score.sets[0].wonBy === null);
tbSeq.push('team2'); // 6-8, team2 wins by 2
let r4b = play('final', 'match_tiebreak', seq.concat(tbSeq));
check('Final set tiebreak: wins only with 2pt lead, recorded as 7-6', r4b.score.sets[0].wonBy === 'team2' && r4b.score.sets[0].p1Games === 6 && r4b.score.sets[0].p2Games === 7 && r4b.score.sets[0].tiebreak.p1 === 6 && r4b.score.sets[0].tiebreak.p2 === 8);

// ---- Test 5: Match tiebreak triggers at 1-1 sets, win by 2 required ----
seq = [];
for (let g = 0; g < 6; g++) seq.push(...winGame('team1')); // set1 team1 6-0
for (let g = 0; g < 6; g++) seq.push(...winGame('team2')); // set2 team2 6-0
let r5setup = play('group', 'match_tiebreak', seq);
check('Sets 1-1 triggers match tiebreak (group format always match_tiebreak)', r5setup.score.inMatchTiebreak === true);

// ---- Test 6: Final with decidingSet='full_set' plays a real 3rd set instead ----
let r6setup = play('final', 'full_set', seq);
check('Final full_set: sets 1-1 starts 3rd set, not match tiebreak',
  r6setup.score.sets.length === 3 && r6setup.score.inMatchTiebreak === false && r6setup.score.winner === null);

// ---- Test 7: Rotation - server sequence across games 0..3 cycles correctly ----
let score = newMatchScore();
score = submitOrders(score, orders1);
const s0 = getCurrentServeInfo(score);
check('Game 1: team1 first player serves (per firstServingTeam)', s0.servingTeam === 'team1' && s0.servingPlayer === 'T1-Alice');

// win game 1 for team1 (4 points), check game2 server
let sc = score;
for (const p of winGame('team1')) sc = addPoint(sc, 'group', 'match_tiebreak', p).score;
const s1 = getCurrentServeInfo(sc);
check('Game 2: team2 first player serves', s1.servingTeam === 'team2' && s1.servingPlayer === 'T2-Carl');

for (const p of winGame('team2')) sc = addPoint(sc, 'group', 'match_tiebreak', p).score;
const s2 = getCurrentServeInfo(sc);
check('Game 3: team1 SECOND player serves (partner rotation)', s2.servingTeam === 'team1' && s2.servingPlayer === 'T1-Bob');

for (const p of winGame('team1')) sc = addPoint(sc, 'group', 'match_tiebreak', p).score;
const s3 = getCurrentServeInfo(sc);
check('Game 4: team2 second player serves', s3.servingTeam === 'team2' && s3.servingPlayer === 'T2-Dave');

for (const p of winGame('team2')) sc = addPoint(sc, 'group', 'match_tiebreak', p).score;
const s4 = getCurrentServeInfo(sc);
check('Game 5: rotation cycles back to team1 first player', s4.servingTeam === 'team1' && s4.servingPlayer === 'T1-Alice');

// ---- Test 8: Court side alternates deuce/ad within a game ----
check('Point 1 of game (0-0): deuce court', s0.courtSide === 'deuce');
let scMid = addPoint(score, 'group', 'match_tiebreak', 'team1').score; // 1-0
const sMid = getCurrentServeInfo(scMid);
check('After 1 point played (1-0): ad court', sMid.courtSide === 'ad');
scMid = addPoint(scMid, 'group', 'match_tiebreak', 'team2').score; // 1-1
const sMid2 = getCurrentServeInfo(scMid);
check('After 2 points played (1-1): deuce court', sMid2.courtSide === 'deuce');

// ---- Test 9: Receiver is the correct player for the court side ----
check('Deuce court receiver is team2 deuce-side player', s0.receivingPlayer === 'T2-Carl');
check('Ad court receiver is team2 ad-side player', sMid.receivingPlayer === 'T2-Dave');

// ---- Test 10: Tiebreak serving rotation (7pt), starting slot + 2-at-a-time pattern ----
seq = [];
for (let i = 0; i < 6; i++) { seq.push(...winGame('team1')); seq.push(...winGame('team2')); } // 6-6, k=12%4=0 -> starts at rotation[0]=team1-p0
let scTb = score;
for (const p of seq) scTb = addPoint(scTb, 'group', 'match_tiebreak', p).score;
const tbInfo1 = getCurrentServeInfo(scTb);
check('Set tiebreak point 1: team1 first player serves (rotation[0])', tbInfo1.servingTeam === 'team1' && tbInfo1.servingPlayer === 'T1-Alice' && tbInfo1.courtSide === 'deuce');

scTb = addPoint(scTb, 'group', 'match_tiebreak', 'team1').score; // pt1 played, now pt2
const tbInfo2 = getCurrentServeInfo(scTb);
check('Set tiebreak point 2: team2 first player serves (rotation[1]), ad court', tbInfo2.servingTeam === 'team2' && tbInfo2.servingPlayer === 'T2-Carl' && tbInfo2.courtSide === 'ad');

scTb = addPoint(scTb, 'group', 'match_tiebreak', 'team2').score; // pt2 played, now pt3 - still team2 (2nd of their 2 consecutive)
const tbInfo3 = getCurrentServeInfo(scTb);
check('Set tiebreak point 3: still team2 first player (2 consecutive), deuce court', tbInfo3.servingTeam === 'team2' && tbInfo3.servingPlayer === 'T2-Carl' && tbInfo3.courtSide === 'deuce');

scTb = addPoint(scTb, 'group', 'match_tiebreak', 'team2').score; // pt3 played, now pt4 - team1 second player (rotation[2])
const tbInfo4 = getCurrentServeInfo(scTb);
check('Set tiebreak point 4: team1 second player serves (rotation[2]), ad court', tbInfo4.servingTeam === 'team1' && tbInfo4.servingPlayer === 'T1-Bob' && tbInfo4.courtSide === 'ad');

// ---- Test 11: Match tiebreak rotation offset when set2 ends at a non-multiple-of-4 score ----
// Set1: team1 wins 6-0 (set1 games irrelevant to offset). Set2: team2 wins 6-4 (10 games -> k=10%4=2)
seq = [];
for (let g = 0; g < 6; g++) seq.push(...winGame('team1')); // set1 6-0 team1
for (let g = 0; g < 4; g++) seq.push(...winGame('team2')); // set2 building 4-0 team2
for (let g = 0; g < 4; g++) seq.push(...winGame('team1')); // set2 4-4
for (let g = 0; g < 2; g++) seq.push(...winGame('team2')); // set2 4-6, team2 wins 6-4 (10 games total)
let r11 = play('group', 'match_tiebreak', seq);
check('Set2 ends 6-4 (10 games): match tiebreak k=10%4=2 -> rotation[2] = team1 second player',
  r11.score.inMatchTiebreak === true && r11.score.matchTiebreak.startIndex === 2);
const tbInfo11 = getCurrentServeInfo(r11.score);
check('Match tiebreak point 1 served by team1 second player (T1-Bob) per rotation[2]',
  tbInfo11.servingTeam === 'team1' && tbInfo11.servingPlayer === 'T1-Bob');

console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
