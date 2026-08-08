/**
 * One-time fix for deployments that already seeded the Semifinal matches under
 * the old pairing (A vs B, C vs D). Corrects match 13/14's sourceGroup to the
 * intended pairing (A vs D, B vs C) and re-propagates any already-confirmed
 * group winners into the right slot.
 *
 * Safe to re-run - it's a no-op once the pairing is already correct. Refuses to
 * touch a Semifinal match that has already started or completed, since the
 * pairing can't be safely changed once real points have been scored; in that
 * case it prints a warning so you can decide manually.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Match = require('../models/Match');
const GroupWinner = require('../models/GroupWinner');
const Team = require('../models/Team');

const CORRECT_PAIRING = { 13: ['A', 'D'], 14: ['B', 'C'] };

async function fixPairing() {
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI is not set. Configure .env first.');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB.');

  let changed = false;

  for (const matchNumber of [13, 14]) {
    const match = await Match.findOne({ matchNumber });
    if (!match) {
      console.log(`Match ${matchNumber} not found - nothing to fix.`);
      continue;
    }
    const [wantGroup1, wantGroup2] = CORRECT_PAIRING[matchNumber];
    const alreadyCorrect = match.team1.sourceGroup === wantGroup1 && match.team2.sourceGroup === wantGroup2;

    if (alreadyCorrect) {
      console.log(`Match ${matchNumber} already has the correct pairing (Group ${wantGroup1} vs Group ${wantGroup2}).`);
      continue;
    }

    if (match.status === 'in_progress' || match.status === 'completed') {
      console.warn(
        `\n[WARNING] Match ${matchNumber} has status "${match.status}" under the OLD pairing ` +
        `(Group ${match.team1.sourceGroup} vs Group ${match.team2.sourceGroup}). ` +
        `Refusing to auto-change a match that has already started - resolve this manually if needed.\n`
      );
      continue;
    }

    match.team1 = { teamId: null, code: null, name: `Winner Group ${wantGroup1}`, sourceGroup: wantGroup1 };
    match.team2 = { teamId: null, code: null, name: `Winner Group ${wantGroup2}`, sourceGroup: wantGroup2 };
    match.version += 1;
    await match.save();
    changed = true;
    console.log(`Match ${matchNumber} corrected to Group ${wantGroup1} vs Group ${wantGroup2} (reset to TBD pending re-propagation).`);
  }

  // Re-propagate any already-confirmed group winners into the corrected slots.
  const confirmedWinners = await GroupWinner.find();
  for (const winner of confirmedWinners) {
    const team = await Team.findOne({ code: winner.teamCode });
    if (!team) continue;
    const teamSlotUpdate = { teamId: team._id, code: team.code, name: `${team.player1} & ${team.player2}` };

    const sfMatches = await Match.find({ stage: 'Semifinal' });
    for (const m of sfMatches) {
      if (m.status === 'in_progress' || m.status === 'completed') continue;
      let touched = false;
      if (m.team1.sourceGroup === winner.group) { m.team1 = { ...m.team1.toObject(), ...teamSlotUpdate }; touched = true; }
      if (m.team2.sourceGroup === winner.group) { m.team2 = { ...m.team2.toObject(), ...teamSlotUpdate }; touched = true; }
      if (touched) {
        m.version += 1;
        await m.save();
        changed = true;
        console.log(`Re-propagated confirmed Group ${winner.group} winner (${team.code}) into Match ${m.matchNumber}.`);
      }
    }
  }

  console.log(changed ? '\nPairing fix complete.' : '\nNothing needed fixing.');
  await mongoose.disconnect();
}

fixPairing().catch(err => {
  console.error('Fix failed:', err);
  process.exit(1);
});
