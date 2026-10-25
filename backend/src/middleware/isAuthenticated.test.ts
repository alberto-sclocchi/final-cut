import { afterEach, describe, expect, it, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { isAuthenticated } from "./isAuthenticated";

const secret = "test-secret";
const originalSecret = process.env.TOKEN_SECRET;

function makeResponse() {
    return {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
    } as unknown as Response;
}

afterEach(() => {
    if (originalSecret === undefined) {
        delete process.env.TOKEN_SECRET;
    } else {
        process.env.TOKEN_SECRET = originalSecret;
    }
});

describe("isAuthenticated", () => {
    it("rejects a request with no auth cookie", () => {
        const req = { cookies: {} } as Request;
        const res = makeResponse();
        const next = vi.fn();

        isAuthenticated(req, res, next as NextFunction);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({
            success: false,
            message: "Not logged in.",
        });
        expect(next).not.toHaveBeenCalled();
    });

    it("rejects an invalid token", () => {
        process.env.TOKEN_SECRET = secret;
        const req = { cookies: { authToken: "not-a-valid-token" } } as unknown as Request;
        const res = makeResponse();
        const next = vi.fn();

        isAuthenticated(req, res, next as NextFunction);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({
            success: false,
            message: "Session expired or invalid. Please log in again.",
        });
        expect(next).not.toHaveBeenCalled();
    });

    it("sets the user ID and calls next for a valid token", () => {
        process.env.TOKEN_SECRET = secret;
        const token = jwt.sign({ _id: "user123" }, secret);
        const req = { cookies: { authToken: token } } as unknown as Request;
        const res = makeResponse();
        const next = vi.fn();

        isAuthenticated(req, res, next as NextFunction);

        expect(req.payload).toEqual({ _id: "user123" });
        expect(next).toHaveBeenCalledOnce();
        expect(res.status).not.toHaveBeenCalled();
    });

    it("passes an error to next if TOKEN_SECRET is missing", () => {
        delete process.env.TOKEN_SECRET;
        const req = { cookies: { authToken: "some-token" } } as unknown as Request;
        const res = makeResponse();
        const next = vi.fn();

        isAuthenticated(req, res, next as NextFunction);

        expect(next).toHaveBeenCalledWith(
            expect.objectContaining({ message: "TOKEN_SECRET is missing from .env" }),
        );
        expect(res.status).not.toHaveBeenCalled();
    });
});