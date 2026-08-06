const mongoose = require('mongoose');

const teamSlotSchema = new mongoose.Schema({
  teamId: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', default: null },
  code: { type: String, default: null }, // e.g. "A1"
  name: { type: String, default: 'TBD' }, // "Player1 & Player2", editable
  sourceGroup: { type: String, enum: ['A', 'B', 'C', 'D', null], default: null } // for Semifinal slots
}, { _id: false });

const coinTossSchema = new mongoose.Schema({
  tossWinner: { type: String, enum: ['team1', 'team2', null], default: null },
  winnerChoice: { type: String, enum: ['serve', 'end', 'defer', null], default: null },
  serveChoice: {
    team: { type: String, enum: ['team1', 'team2', null], default: null },
    decision: { type: String, enum: ['serve', 'receive', null], default: null }
  },
  endChoice: {
    team: { type: String, enum: ['team1', 'team2', null], default: null },
    end: { type: String, enum: ['pool-end', 'entrance-end', null], default: null }
  },
  recordedAt: { type: Date, default: null }
}, { _id: false });

const matchSchema = new mongoose.Schema({
  matchNumber: { type: Number, required: true, unique: true },
  stage: { type: String, enum: ['Group', 'Semifinal', 'Final'], required: true },
  group: { type: String, enum: ['A', 'B', 'C', 'D', null], default: null },

  team1: { type: teamSlotSchema, default: () => ({}) },
  team2: { type: teamSlotSchema, default: () => ({}) },

  // Where this match's winner advances to (Semifinal -> Final). Null for Group/Final matches.
  nextMatch: { type: Number, default: null },
  nextMatchSlot: { type: String, enum: ['team1', 'team2', null], default: null },

  scheduledStart: { type: String, default: '' },
  scheduledEnd: { type: String, default: '' },
  session: { type: String, default: '' },

  status: { type: String, enum: ['scheduled', 'toss_done', 'in_progress', 'completed'], default: 'scheduled' },

  // 'group': No-Ad scoring, 6-game sets, 7pt set TB (no win-by-2), match TB (win-by-2) if 1-1, no 3rd set.
  // 'final': Ad scoring, 6-game sets win-by-2, 7pt set TB (win-by-2), then decidingSet applies if 1-1.
  formatType: { type: String, enum: ['group', 'final'], required: true },
  // Only meaningful when formatType === 'final'. Group/Semifinal matches always use 'match_tiebreak'.
  decidingSet: { type: String, enum: ['match_tiebreak', 'full_set'], default: 'match_tiebreak' },

  coinToss: { type: coinTossSchema, default: () => ({}) },

  // Deeply nested, engine-managed game/set/tiebreak state including per-set
  // serve/receive orders - kept flexible rather than rigidly schema'd.
  score: { type: mongoose.Schema.Types.Mixed, default: null },
  history: { type: [mongoose.Schema.Types.Mixed], default: [] },

  actualStart: { type: Date, default: null },
  actualEnd: { type: Date, default: null },

  lock: {
    sessionId: { type: String, default: null },
    lockedAt: { type: Date, default: null }
  },

  version: { type: Number, default: 0 }
}, { timestamps: true });

module.exports = mongoose.model('Match', matchSchema);
