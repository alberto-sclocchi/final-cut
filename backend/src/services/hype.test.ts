import { describe, expect, it } from "vitest";
import {
    TOTAL_POINTS,
    hypeRefusal,
    isHypeRoundFinished,
    pickQualifiers,
    validateHypePoints,
    totalHypePoints,
} from "./hype";

const poolIds = ["movieA", "movieB", "movieC"];

describe("validateHypePoints", () => {
    it("accepts a valid 10-point allocation", () => {
        expect(validateHypePoints({ movieA: 3, movieB: 7 }, poolIds)).toBeNull();
    });

    it("rejects allocations that don't add up to 10", () => {
        expect(validateHypePoints({ movieA: 4, movieB: 5 }, poolIds))
            .toBe("Points must add up to exactly 10, got 9");
    });

    it("rejects negative or fractional points", () => {
        expect(validateHypePoints({ movieA: -1, movieB: 11 }, poolIds))
            .toBe("Points must be whole numbers 0 or higher");
        expect(validateHypePoints({ movieA: 2.5, movieB: 7.5 }, poolIds))
            .toBe("Points must be whole numbers 0 or higher");
    });

    it("rejects movies outside the pool", () => {
        expect(validateHypePoints({ movieX: 10 }, poolIds))
            .toBe("Movie movieX is not in this game");
    });
});

describe("totalHypePoints", () => {
    it("adds points across players and includes movies with no points", () => {
        expect(totalHypePoints(
            [{ movieA: 6, movieB: 4 }, { movieA: 2, movieC: 8 }],
            poolIds,
        )).toEqual({ movieA: 8, movieB: 4, movieC: 8 });
    });

    it("ignores points for movies outside the pool", () => {
        expect(totalHypePoints([{ movieA: 10, movieX: 5 }], poolIds))
            .toEqual({ movieA: 10, movieB: 0, movieC: 0 });
    });
});

describe("hypeRefusal", () => {
    // A normal submission: the game is running, it is the hype round, nothing is in the way.
    const normal = {
        status: "playing",
        currentRound: "hype",
        roundFinished: false,
        alreadySubmitted: false,
    };

    it("allows a submission during a normal hype round", () => {
        expect(hypeRefusal(normal)).toBeNull();
    });

    it("blocks a game that has not started", () => {
        expect(hypeRefusal({ ...normal, status: "lobby" })).toBe("This game has not started.");
    });

    it("blocks a game that is already over", () => {
        expect(hypeRefusal({ ...normal, status: "completed" })).toBe("This game is already over.");
    });

    it("blocks a round that is not the hype round", () => {
        expect(hypeRefusal({ ...normal, currentRound: "ban" })).toBe("It is not the hype round.");
    });

    it("blocks a finished hype round", () => {
        expect(hypeRefusal({ ...normal, roundFinished: true })).toBe("The hype round is over.");
    });

    it("blocks a player who already spent their points", () => {
        expect(hypeRefusal({ ...normal, alreadySubmitted: true }))
            .toBe("You already spent your points in this round.");
    });

    it("checks the state before the player", () => {
        expect(hypeRefusal({ ...normal, roundFinished: true, alreadySubmitted: true }))
            .toBe("The hype round is over.");
    });

    it("has a 10 point total", () => {
        expect(TOTAL_POINTS).toBe(10);
    });
});

describe("isHypeRoundFinished", () => {
    it("keeps going while players are missing", () => {
        expect(isHypeRoundFinished(2, 5)).toBe(false);
    });

    it("finishes when the last player submits", () => {
        expect(isHypeRoundFinished(5, 5)).toBe(true);
    });

    it("finishes when more submissions arrived than the snapshot expects", () => {
        expect(isHypeRoundFinished(6, 5)).toBe(true);
    });

    it("finishes when the round has no players to wait for", () => {
        expect(isHypeRoundFinished(0, 0)).toBe(true);
    });
});

describe("pickQualifiers", () => {
    const pool = ["a", "b", "c", "d", "e", "f"];

    it("keeps the top four when nobody is tied at the cutoff", () => {
        const totals = { a: 20, b: 15, c: 9, d: 4, e: 1, f: 0 };

        expect(pickQualifiers(totals, pool)).toEqual({
            qualifiers: ["a", "b", "c", "d"],
            cutoffTie: false,
            tied: [],
        });
    });

    it("returns the survivors in pool order, not score order", () => {
        const totals = { a: 1, b: 20, c: 2, d: 15, e: 4, f: 0 };

        expect(pickQualifiers(totals, pool).qualifiers).toEqual(["b", "c", "d", "e"]);
    });

    it("draws from a tie at the cutoff", () => {
        const totals = { a: 20, b: 15, c: 9, d: 7, e: 7, f: 0 };

        const result = pickQualifiers(totals, pool, 4, () => 0);

        // the tie group is shuffled and only the spots left are taken
        expect(result.qualifiers).toEqual(["a", "b", "c", "e"]);
        expect(result.cutoffTie).toBe(true);
        expect(result.tied).toEqual(["d", "e"]);
    });

    it("draws only the spots it needs from a three way tie", () => {
        const totals = { a: 20, b: 15, c: 9, d: 9, e: 9, f: 9 };

        const result = pickQualifiers(totals, pool, 4, () => 0.99);

        expect(result.qualifiers).toHaveLength(4);
        expect(result.cutoffTie).toBe(true);
        expect(result.tied).toEqual(["c", "d", "e", "f"]);
    });

    it("does not flag a tie that sits inside the top four", () => {
        const totals = { a: 20, b: 10, c: 10, d: 10, e: 1, f: 0 };

        const result = pickQualifiers(totals, pool);

        expect(result.qualifiers).toEqual(["a", "b", "c", "d"]);
        expect(result.cutoffTie).toBe(false);
    });

    it("keeps every movie when the pool is at or under the cutoff", () => {
        expect(pickQualifiers({ a: 3, b: 2 }, ["a", "b"])).toEqual({
            qualifiers: ["a", "b"],
            cutoffTie: false,
            tied: [],
        });
        expect(pickQualifiers({ a: 10, b: 0, c: 0, d: 0 }, ["a", "b", "c", "d"])).toEqual({
            qualifiers: ["a", "b", "c", "d"],
            cutoffTie: false,
            tied: [],
        });
    });
});
