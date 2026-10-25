import { describe, expect, it } from "vitest";
import { validateHypePoints, totalHypePoints } from "./hype";

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
