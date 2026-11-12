// Each player hands out exactly this many points.
export const TOTAL_POINTS = 10;

// How many movies survive the hype round.
export const QUALIFIERS = 4;

// One player's points, like { "movieA": 3, "movieB": 7 }.
export type HypePoints = Record<string, number>;

// Checks one player's points. Returns an error message, or null if valid.
export function validateHypePoints(points: HypePoints, poolIds: string[]): string | null {
  let sum = 0;

  for (const movieId in points) {
    const value = points[movieId];

    if (!poolIds.includes(movieId)) {
      return "Movie " + movieId + " is not in this game";
    }

    if (!Number.isInteger(value) || value < 0) {
      return "Points must be whole numbers 0 or higher";
    }

    sum = sum + value;
  }

  if (sum !== TOTAL_POINTS) {
    return "Points must add up to exactly " + TOTAL_POINTS + ", got " + sum;
  }

  return null;
}

// Everything the hype rules need to know about a room and one player.
export interface HypeContext {
  status: string;
  currentRound: string;
  roundFinished: boolean;
  alreadySubmitted: boolean;
}

// Why this player can't spend their points right now, or null if they can.
export function hypeRefusal({
  status,
  currentRound,
  roundFinished,
  alreadySubmitted,
}: HypeContext): string | null {
  if (status === "lobby") {
    return "This game has not started.";
  }

  if (status === "completed") {
    return "This game is already over.";
  }

  if (currentRound !== "hype") {
    return "It is not the hype round.";
  }

  if (roundFinished) {
    return "The hype round is over.";
  }

  if (alreadySubmitted) {
    return "You already spent your points in this round.";
  }

  return null;
}

// True when the hype round has nothing left to collect.
export function isHypeRoundFinished(submitted: number, required: number): boolean {
  // no snapshot means a room from before this round existed, nothing to wait for
  if (required <= 0) {
    return true;
  }

  return submitted >= required;
}

// One random ordering, used only to break a tie at the cutoff.
function shuffleWith<T>(list: T[], random: () => number): T[] {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const temp = copy[i];
    copy[i] = copy[j];
    copy[j] = temp;
  }
  return copy;
}

// Picks the movies that survive the hype round. A tie at the cutoff is broken randomly so
// exactly four go through, and the ties that had to be drawn from are reported back.
export function pickQualifiers(
  totals: HypePoints,
  poolIds: string[],
  qualifiers: number = QUALIFIERS,
  random: () => number = Math.random
): { qualifiers: string[]; cutoffTie: boolean; tied: string[] } {
  // a pool at or under the cutoff has nothing to cut
  if (poolIds.length <= qualifiers) {
    return { qualifiers: [...poolIds], cutoffTie: false, tied: [] };
  }

  const ranked = [...poolIds].sort((a, b) => (totals[b] ?? 0) - (totals[a] ?? 0));

  // walk the ranking in point groups, so a tie is only broken when it crosses the cutoff
  const chosen = new Set<string>();
  let drawnFrom: string[] = [];
  let index = 0;

  while (index < ranked.length && chosen.size < qualifiers) {
    const points = totals[ranked[index]] ?? 0;
    const group: string[] = [];

    while (index < ranked.length && (totals[ranked[index]] ?? 0) === points) {
      group.push(ranked[index]);
      index++;
    }

    const spotsLeft = qualifiers - chosen.size;

    if (group.length <= spotsLeft) {
      for (const movieId of group) {
        chosen.add(movieId);
      }
    } else {
      // more movies tied for the last spots than spots left: draw at random
      drawnFrom = [...group];
      for (const movieId of shuffleWith(group, random).slice(0, spotsLeft)) {
        chosen.add(movieId);
      }
    }
  }

  return {
    // keep the pool order for the survivors, not the score order
    qualifiers: poolIds.filter((movieId) => chosen.has(movieId)),
    cutoffTie: drawnFrom.length > 0,
    tied: poolIds.filter((movieId) => drawnFrom.includes(movieId)),
  };
}

// Adds up every player's points for each movie.
export function totalHypePoints(allPoints: HypePoints[], poolIds: string[]): HypePoints {
  const totals: HypePoints = {};

  // Starts every movie at 0 so movies with no points still show up.
  for (const movieId of poolIds) {
    totals[movieId] = 0;
  }

  for (const points of allPoints) {
    for (const movieId in points) {
      // Skips movies that aren't in the pool.
      if (totals[movieId] !== undefined) {
        totals[movieId] = totals[movieId] + points[movieId];
      }
    }
  }

  return totals;
}