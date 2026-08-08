/**
 * Seeds the 12 doubles teams and the 15-match schedule (12 group-stage,
 * 2 semifinals, 1 final) exactly as laid out in the tournament rules document.
 * Safe to re-run - only inserts teams/matches that don't already exist by
 * code/matchNumber, so it never overwrites scores or edits.
 */
const mongoose = require('mongoose');
const Team = require('../models/Team');
const Match = require('../models/Match');

const teamsRaw = [
  ['A', 1, 'A1', 'Mahesh', 'Nagaraju'],
  ['A', 2, 'A2', 'Chetan', 'Manjunath P'],
  ['A', 3, 'A3', 'Pramod', 'Pradeep'],
  ['B', 1, 'B1', 'Swamy', 'Girish LC'],
  ['B', 2, 'B2', 'Girish S', 'TBD'],
  ['B', 3, 'B3', 'Lokendra', 'Alok'],
  ['C', 1, 'C1', 'Ganesh S', 'Kiran Surya'],
  ['C', 2, 'C2', 'Prajwal', 'Manjunath T'],
  ['C', 3, 'C3', 'Raveendra', 'Priyanshu'],
  ['D', 1, 'D1', 'Hemant', 'Vasista Sandeep'],
  ['D', 2, 'D2', 'Chandramouli', 'Sudheendra'],
  ['D', 3, 'D3', 'Vijay Raghavan', 'Sathish']
];

// matchNumber, stage, group, team1Code, team2Code, scheduledStart, scheduledEnd, session
const matchesRaw = [
  [1, 'Group', 'C', 'C1', 'C2', '6:30 AM', '7:30 AM', 'Morning'],
  [2, 'Group', 'A', 'A1', 'A3', '7:30 AM', '8:30 AM', 'Morning'],
  [3, 'Group', 'D', 'D1', 'D2', '8:30 AM', '9:30 AM', 'Morning'],
  [4, 'Group', 'B', 'B1', 'B3', '9:30 AM', '10:30 AM', 'Morning'],
  [5, 'Group', 'A', 'A2', 'A3', '12:00 PM', '1:00 PM', 'Midday'],
  [6, 'Group', 'C', 'C2', 'C3', '1:00 PM', '2:00 PM', 'Midday'],
  [7, 'Group', 'A', 'A1', 'A2', '4:00 PM', '5:00 PM', 'Evening'],
  [8, 'Group', 'D', 'D2', 'D3', '5:00 PM', '6:00 PM', 'Evening'],
  [9, 'Group', 'B', 'B2', 'B3', '6:00 PM', '7:00 PM', 'Evening'],
  [10, 'Group', 'C', 'C1', 'C3', '7:00 PM', '8:00 PM', 'Evening'],
  [11, 'Group', 'D', 'D1', 'D3', '8:00 PM', '9:00 PM', 'Evening'],
  // Note: source doc labels this row "B1 vs B3" but the listed teams are B1
  // (Swamy & Girish LC) vs B2 (Girish S & TBD) - corrected here to B1 vs B2,
  // since all 3 unique group-B pairings (B1v2, B1v3, B2v3) must appear exactly once.
  [12, 'Group', 'B', 'B1', 'B2', '9:00 PM', '10:00 PM', 'Evening']
];

// Semifinal pairing: Winner Group A vs Winner Group D, Winner Group B vs Winner Group C (fixed).
const semifinalsRaw = [
  [13, 'Semifinal', null, 'A', 'D', 'TBD', 'TBD', 'TBD'],
  [14, 'Semifinal', null, 'B', 'C', 'TBD', 'TBD', 'TBD']
];

async function seedData() {
  const created = { teams: [], matches: [] };

  for (const [group, slot, code, player1, player2] of teamsRaw) {
    const exists = await Team.findOne({ code });
    if (exists) continue;
    const team = await Team.create({ group, slot, code, player1, player2 });
    created.teams.push(team.code);
  }

  const teamByCode = {};
  (await Team.find()).forEach(t => { teamByCode[t.code] = t; });

  for (const [matchNumber, stage, group, t1Code, t2Code, start, end, session] of matchesRaw) {
    const exists = await Match.findOne({ matchNumber });
    if (exists) continue;
    const t1 = teamByCode[t1Code];
    const t2 = teamByCode[t2Code];
    await Match.create({
      matchNumber,
      stage,
      group,
      team1: { teamId: t1._id, code: t1.code, name: `${t1.player1} & ${t1.player2}` },
      team2: { teamId: t2._id, code: t2.code, name: `${t2.player1} & ${t2.player2}` },
      scheduledStart: start,
      scheduledEnd: end,
      session,
      formatType: 'group',
      decidingSet: 'match_tiebreak'
    });
    created.matches.push(matchNumber);
  }

  for (const [matchNumber, stage, group, sourceGroup1, sourceGroup2, start, end, session] of semifinalsRaw) {
    const exists = await Match.findOne({ matchNumber });
    if (exists) continue;
    await Match.create({
      matchNumber,
      stage,
      group,
      team1: { teamId: null, code: null, name: `Winner Group ${sourceGroup1}`, sourceGroup: sourceGroup1 },
      team2: { teamId: null, code: null, name: `Winner Group ${sourceGroup2}`, sourceGroup: sourceGroup2 },
      nextMatch: 15,
      nextMatchSlot: matchNumber === 13 ? 'team1' : 'team2',
      scheduledStart: start,
      scheduledEnd: end,
      session,
      formatType: 'group',
      decidingSet: 'match_tiebreak'
    });
    created.matches.push(matchNumber);
  }

  const finalExists = await Match.findOne({ matchNumber: 15 });
  if (!finalExists) {
    await Match.create({
      matchNumber: 15,
      stage: 'Final',
      group: null,
      team1: { teamId: null, code: null, name: 'Winner Semifinal 1', sourceGroup: null },
      team2: { teamId: null, code: null, name: 'Winner Semifinal 2', sourceGroup: null },
      nextMatch: null,
      nextMatchSlot: null,
      scheduledStart: 'TBD',
      scheduledEnd: 'TBD',
      session: 'TBD',
      formatType: 'final',
      decidingSet: 'match_tiebreak'
    });
    created.matches.push(15);
  }

  return created;
}

async function cliSeed() {
  require('dotenv').config();
  if (!process.env.MONGODB_URI) {
    console.warn(
      '\n[seed] Skipped: MONGODB_URI is not set (no .env found yet).\n' +
      '[seed] Once you create .env with your Atlas connection string, run: npm run seed\n'
    );
    return;
  }
  try {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
  } catch (err) {
    console.warn(
      `\n[seed] Skipped: could not connect to MongoDB (${err.message}).\n` +
      '[seed] Fix MONGODB_URI in .env, then run: npm run seed\n'
    );
    return;
  }
  console.log('Connected to MongoDB for seeding.');
  const created = await seedData();
  console.log(`Created ${created.teams.length} team(s) and ${created.matches.length} match(es).`);
  console.log('Seeding complete.');
  await mongoose.disconnect();
}

if (require.main === module) {
  cliSeed().catch(err => {
    console.error('Seeding failed:', err);
    process.exit(1);
  });
}

module.exports = { seedData };
