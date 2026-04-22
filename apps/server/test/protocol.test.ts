import { describe, expect, test } from "vitest";
import { z } from "zod";

const joinSchema = z.object({ roomCode: z.string().length(4), playerName: z.string().min(1).max(24) });

describe("protocol validation", () => {
  test("accepts valid join payload", () => {
    const parsed = joinSchema.safeParse({ roomCode: "ABCD", playerName: "Tori" });
    expect(parsed.success).toBe(true);
  });

  test("rejects invalid room code", () => {
    const parsed = joinSchema.safeParse({ roomCode: "ABCDE", playerName: "Tori" });
    expect(parsed.success).toBe(false);
  });
});
