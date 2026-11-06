// Movies that must stay in the pool, so the later rounds have something to play with.
export const MIN_POOL_SIZE = 6;

// Everything the ban rules need to know about a room and one player.
export interface BanContext {
  status: string;
  currentRound: string;
  roundFinished: boolean;
  alreadyBanned: boolean;
  poolSize: number;
}

// Why this player can't ban right now, or null if they can.
export function banRefusal({
  status,
  currentRound,
  roundFinished,
  alreadyBanned,
  poolSize,
}: BanContext): string | null {
  if (status === "lobby") {
    return "This game has not started.";
  }

  if (status === "completed") {
    return "This game is already over.";
  }

  if (currentRound !== "ban") {
    return "It is not the ban round.";
  }

  if (roundFinished) {
    return "The ban round is over.";
  }

  if (alreadyBanned) {
    return "You already banned a movie.";
  }

  if (poolSize <= MIN_POOL_SIZE) {
    return `The pool is at its minimum of ${MIN_POOL_SIZE} movies.`;
  }

  return null;
}

// True when the ban round has nothing left to collect: everyone has banned, or the
// pool reached the floor so nobody else is allowed to ban.
export function isBanRoundFinished(submittedBans: number, requiredBans: number, poolSize: number): boolean {
  if (poolSize <= MIN_POOL_SIZE) {
    return true;
  }

  // no snapshot means a room from before this round existed, nothing to wait for
  if (requiredBans <= 0) {
    return true;
  }

  return submittedBans >= requiredBans;
}
