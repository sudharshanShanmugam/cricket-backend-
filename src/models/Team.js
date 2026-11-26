import mongoose from 'mongoose';

const playerSchema = new mongoose.Schema(
  { id: { type: String, required: true }, name: { type: String, required: true } },
  { _id: false },
);

const teamSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    shortName: { type: String, required: true },
    players: { type: [playerSchema], default: [] },
  },
  { timestamps: true },
);

export const Team = mongoose.model('Team', teamSchema);
