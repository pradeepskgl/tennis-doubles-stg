const mongoose = require('mongoose');

const teamSchema = new mongoose.Schema({
  group: { type: String, enum: ['A', 'B', 'C', 'D'], required: true },
  slot: { type: Number, enum: [1, 2, 3], required: true }, // A1, A2, A3 etc.
  code: { type: String, required: true, unique: true }, // e.g. "A1", denormalized for convenience
  player1: { type: String, required: true },
  player2: { type: String, required: true }
}, { timestamps: true });

teamSchema.virtual('name').get(function () {
  return `${this.player1} & ${this.player2}`;
});
teamSchema.set('toJSON', { virtuals: true });
teamSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Team', teamSchema);
