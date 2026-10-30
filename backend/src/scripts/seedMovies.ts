import 'dotenv/config';
import mongoose from 'mongoose';
import Movie from '../models/Movie.model';

const TMDB_URL = 'https://api.themoviedb.org/3';
const IMAGE_URL = 'https://image.tmdb.org/t/p/w500';
const PAGES_TO_FETCH = 110;

// The fields we use from a TMDb movie.
type TmdbMovie = {
  id: number;
  title: string;
  overview: string;
  release_date: string;
  genre_ids: number[];
  poster_path: string | null;
  vote_average: number;
  vote_count: number;
};

// Gets data from a TMDb URL.
async function getFromTmdb(path: string) {
  const response = await fetch(TMDB_URL + path, {
    headers: { Authorization: 'Bearer ' + process.env.TMDB_TOKEN },
  });

  if (!response.ok) {
    throw new Error('TMDb request failed: ' + response.status);
  }

  return await response.json();
}

// Turns the genre list into an object like { 28: "Action" }.
async function getGenreNames() {
  const data = await getFromTmdb('/genre/movie/list');
  const genreNames: Record<number, string> = {};

  for (const genre of data.genres) {
    genreNames[genre.id] = genre.name;
  }

  return genreNames;
}

// Changes a TMDb movie into the shape of our Movie model.
function formatMovie(tmdbMovie: TmdbMovie, genreNames: Record<number, string>) {
  const genres: string[] = [];
  for (const id of tmdbMovie.genre_ids) {
    if (genreNames[id]) {
      genres.push(genreNames[id]);
    }
  }

  let posterUrl: string | null = null;
  if (tmdbMovie.poster_path) {
    posterUrl = IMAGE_URL + tmdbMovie.poster_path;
  }

  let releaseDate: string | undefined = undefined;
  if (tmdbMovie.release_date) {
    releaseDate = tmdbMovie.release_date;
  }

  return {
    tmdbId: tmdbMovie.id,
    title: tmdbMovie.title,
    overview: tmdbMovie.overview,
    releaseDate: releaseDate,
    genres: genres,
    posterUrl: posterUrl,
    rating: tmdbMovie.vote_average,
    voteCount: tmdbMovie.vote_count,
  };
}

// Main function that fills the database.
async function seed() {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error('MONGODB_URI is missing from .env');
  }

  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB');

  const genreNames = await getGenreNames();

  for (let page = 1; page <= PAGES_TO_FETCH; page++) {
    const data = await getFromTmdb(
      '/discover/movie?sort_by=vote_count.desc&include_adult=false&page=' + page
    );

    for (const tmdbMovie of data.results) {
      const movie = formatMovie(tmdbMovie, genreNames);

      // Updates the movie if it exists, otherwise creates it.
      await Movie.findOneAndUpdate({ tmdbId: movie.tmdbId }, movie, { upsert: true });
    }

    console.log('Finished page ' + page);
  }

  const total = await Movie.countDocuments();
  console.log('Done! Movies in database: ' + total);

  await mongoose.disconnect();
}

seed();