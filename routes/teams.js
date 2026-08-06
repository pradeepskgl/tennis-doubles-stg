const express = require('express');
const Team = require('../models/Team');
const Match = require('../models/Match');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// GET /api/teams - all teams grouped, public
router.get('/', async (req, res) => {
  const teams = await Team.find().sort({ group: 1, slot: 1 }).lean();
  res.json(teams);
});

// PATCH /api/teams/:code - edit a team's player names (admin only)
router.patch('/:code', requireAuth, async (req, res) => {
  const { player1, player2 } = req.body;
  const team = await Team.findOne({ code: req.params.code });
  if (!team) return res.status(404).json({ error: 'Team not found.' });

  if (player1 !== undefined) team.player1 = player1;
  if (player2 !== undefined) team.player2 = player2;
  await team.save();

  // Keep any match team-slot display names in sync, since matches store a
  // denormalized "name" string for display/schedule editing convenience.
  const newName = `${team.player1} & ${team.player2}`;
  await Match.updateMany({ 'team1.code': team.code }, { $set: { 'team1.name': newName } });
  await Match.updateMany({ 'team2.code': team.code }, { $set: { 'team2.name': newName } });

  res.json({ ok: true, team });
});

module.exports = router;
