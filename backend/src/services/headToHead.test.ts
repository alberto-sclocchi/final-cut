import { describe, it, expect } from "vitest";
import { pickMatchupWinner } from "./headToHead";

describe("pickMatchupWinner", () => {
  it("picks the movie with more votes", () => {
    expect(pickMatchupWinner("a", "b", ["a", "a", "b"], {})).toBe("a");
  });

  it("breaks a vote tie with hype points", () => {
    expect(pickMatchupWinner("a", "b", ["a", "b"], { a: 3, b: 7 })).toBe("b");
  });

  it("breaks a full tie randomly", () => {
    expect(pickMatchupWinner("a", "b", ["a", "b"], { a: 5, b: 5 }, () => 0.1)).toBe("a");
    expect(pickMatchupWinner("a", "b", ["a", "b"], { a: 5, b: 5 }, () => 0.9)).toBe("b");
  });

  it("ignores picks for other movies", () => {
    expect(pickMatchupWinner("a", "b", ["c", "c", "b"], {})).toBe("b");
  });
});
