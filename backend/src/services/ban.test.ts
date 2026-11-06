import { describe, it, expect } from "vitest";
import { MIN_POOL_SIZE, banRefusal, isBanRoundFinished } from "./ban";

// A normal ban: the game is running, it is the ban round, nothing is in the way.
const normal = {
  status: "playing",
  currentRound: "ban",
  roundFinished: false,
  alreadyBanned: false,
  poolSize: 12,
};

describe("banRefusal", () => {
  it("allows a ban during a normal ban round", () => {
    expect(banRefusal(normal)).toBeNull();
  });

  it("blocks a game that has not started", () => {
    expect(banRefusal({ ...normal, status: "lobby" })).toBe("This game has not started.");
  });

  it("blocks a game that is already over", () => {
    expect(banRefusal({ ...normal, status: "completed" })).toBe("This game is already over.");
  });

  it("blocks a round that is not the ban round", () => {
    expect(banRefusal({ ...normal, currentRound: "hype" })).toBe("It is not the ban round.");
  });

  it("blocks a finished ban round", () => {
    expect(banRefusal({ ...normal, roundFinished: true })).toBe("The ban round is over.");
  });

  it("blocks a player who already banned", () => {
    expect(banRefusal({ ...normal, alreadyBanned: true })).toBe("You already banned a movie.");
  });

  it("blocks a ban that would take the pool below the floor", () => {
    expect(banRefusal({ ...normal, poolSize: MIN_POOL_SIZE })).toBe("The pool is at its minimum of 6 movies.");
    expect(banRefusal({ ...normal, poolSize: MIN_POOL_SIZE + 1 })).toBeNull();
  });

  it("checks the state before the player, and the player before the pool", () => {
    expect(banRefusal({ ...normal, status: "playing", roundFinished: true, alreadyBanned: true })).toBe(
      "The ban round is over."
    );
    expect(banRefusal({ ...normal, alreadyBanned: true, poolSize: 6 })).toBe("You already banned a movie.");
  });
});

describe("isBanRoundFinished", () => {
  it("keeps going while players are missing", () => {
    expect(isBanRoundFinished(2, 5, 12)).toBe(false);
  });

  it("finishes when the last player bans", () => {
    expect(isBanRoundFinished(5, 5, 12)).toBe(true);
  });

  it("finishes when more bans arrived than the snapshot expects", () => {
    expect(isBanRoundFinished(6, 5, 12)).toBe(true);
  });

  it("finishes when the pool reaches the floor", () => {
    expect(isBanRoundFinished(1, 5, MIN_POOL_SIZE)).toBe(true);
  });

  it("finishes when the pool is already below the floor", () => {
    expect(isBanRoundFinished(0, 5, MIN_POOL_SIZE - 1)).toBe(true);
  });

  it("finishes when the round has no players to wait for", () => {
    expect(isBanRoundFinished(0, 0, 12)).toBe(true);
  });
});
