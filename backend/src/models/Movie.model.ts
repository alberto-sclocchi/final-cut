import mongoose from 'mongoose';

const movieSchema = new mongoose.Schema(
  {
    tmdbId:      { type: Number, required: true, unique: true },
    title:       { type: String, required: true, index: true },
    overview:    { type: String, default: '' },
    releaseDate: { type: Date },
    genres:      { type: [String], default: [] },
    posterUrl:   { type: String, default: null },
    rating:      { type: Number, min: 0, max: 10 },
    voteCount:   { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Lets PBI-17 (search endpoint) do fast title search
movieSchema.index({ title: 'text' });

export default mongoose.model('Movie', movieSchema);