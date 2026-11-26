import mongoose from 'mongoose';

const matchSchema = new mongoose.Schema(
  {
    title: { type: String, default: '' },
    venue: { type: String, default: '' },
    scheduledAt: { type: Date, default: Date.now },
    overs: { type: Number, required: true },
    // Snapshot of both squads, so later team edits never rewrite match history.
    teams: { type: [mongoose.Schema.Types.Mixed], required: true },
    events: { type: [mongoose.Schema.Types.Mixed], default: [] },
    // Bumped on every write: used for optimistic locking and ordering live updates.
    rev: { type: Number, default: 0 },
    summary: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { timestamps: true, minimize: false },
);

matchSchema.index({ 'summary.status': 1, scheduledAt: -1 });

export const Match = mongoose.model('Match', matchSchema);
