const express = require('express');
const Team = require('../models/Team');
const Match = require('../models/Match');
const GroupWinner = require('../models/GroupWinner');
const { requireAuth } = require('../middleware/auth');
const { computeGroupStandings } = require('../utils/groupStandings');

const router = express.Router();
const GROUPS = ['A', 'B', 'C', 'D'];

// GET /api/standings - live standings for all 4 groups, public
router.get('/', async (req, res) => {
  const teams = await Team.find().lean();
  const matches = await Match.find({ stage: 'Group' }).lean();
  const confirmedWinners = await GroupWinner.find().lean();
  const confirmedMap = {};
  confirmedWinners.forEach(w => { confirmedMap[w.group] = w; });

  const result = GROUPS.map(group => {
    const groupTeams = teams.filter(t => t.group === group);
    const groupMatches = matches.filter(m => m.group === group);
    const { standings, needsManualTiebreak, allMatchesPlayed } = computeGroupStandings(groupTeams, groupMatches);

    let autoWinnerCode = null;
    if (allMatchesPlayed && !needsManualTiebreak && standings.length > 0) {
      autoWinnerCode = standings[0].code;
    }

    return {
      group,
      standings,
      allMatchesPlayed,
      needsManualTiebreak,
      autoWinnerCode,
      confirmedWinner: confirmedMap[group] || null
    };
  });

  res.json(result);
});

// POST /api/standings/:group/confirm-winner - admin confirms (or overrides via coin
// toss/draw) the group qualifier, and propagates that team into the Semifinal slot.
router.post('/:group/confirm-winner', requireAuth, async (req, res) => {
  const group = req.params.group;
  if (!GROUPS.includes(group)) return res.status(400).json({ error: 'Invalid group.' });
  const { teamCode } = req.body;
  if (!teamCode) return res.status(400).json({ error: 'teamCode is required.' });

  const team = await Team.findOne({ code: teamCode, group });
  if (!team) return res.status(404).json({ error: 'Team not found in this group.' });

  const teams = await Team.find({ group }).lean();
  const matches = await Match.find({ stage: 'Group', group }).lean();
  const { standings, needsManualTiebreak, allMatchesPlayed } = computeGroupStandings(teams, matches);
  const autoWinnerCode = (allMatchesPlayed && !needsManualTiebreak && standings.length > 0) ? standings[0].code : null;

  const method = (autoWinnerCode && autoWinnerCode === teamCode) ? 'auto' : 'manual';

  const winner = await GroupWinner.findOneAndUpdate(
    { group },
    { group, teamCode, method, confirmedAt: new Date() },
    { upsert: true, new: true }
  );

  // Propagate into whichever Semifinal match slot(s) source from this group.
  const teamSlotUpdate = { teamId: team._id, code: team.code, name: `${team.player1} & ${team.player2}` };
  const sfMatches = await Match.find({ stage: 'Semifinal' });
  for (const m of sfMatches) {
    let changed = false;
    if (m.team1.sourceGroup === group) { m.team1 = { ...m.team1.toObject(), ...teamSlotUpdate }; changed = true; }
    if (m.team2.sourceGroup === group) { m.team2 = { ...m.team2.toObject(), ...teamSlotUpdate }; changed = true; }
    if (changed) { m.version += 1; await m.save(); }
  }

  res.json({ ok: true, winner });
});

module.exports = router;
