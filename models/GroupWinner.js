const mongoose = require('mongoose');

const groupWinnerSchema = new mongoose.Schema({
  group: { type: String, enum: ['A', 'B', 'C', 'D'], required: true, unique: true },
  teamCode: { type: String, required: true },
  method: { type: String, enum: ['auto', 'manual'], default: 'auto' },
  confirmedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('GroupWinner', groupWinnerSchema);
