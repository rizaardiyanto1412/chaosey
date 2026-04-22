import { describe, expect, test } from "vitest";
import { circlesIntersectsRect, composeDirection, roleBundlesForPlayerCount } from "../src";

describe("composeDirection", () => {
  test("normalizes diagonal input", () => {
    const output = composeDirection({ W: true, A: false, S: false, D: true });
    expect(output.x).toBeCloseTo(0.707, 2);
    expect(output.y).toBeCloseTo(-0.707, 2);
  });

  test("returns zero vector when idle", () => {
    const output = composeDirection({ W: false, A: false, S: false, D: false });
    expect(output).toEqual({ x: 0, y: 0 });
  });
});

describe("collision", () => {
  test("detects circle/rect overlap", () => {
    const hit = circlesIntersectsRect({ x: 10, y: 10 }, 4, { x: 12, y: 8 }, { x: 20, y: 20 });
    expect(hit).toBe(true);
  });

  test("detects no overlap", () => {
    const hit = circlesIntersectsRect({ x: 0, y: 0 }, 2, { x: 20, y: 20 }, { x: 5, y: 5 });
    expect(hit).toBe(false);
  });
});

describe("roleBundlesForPlayerCount", () => {
  test("assigns two keys each for two players", () => {
    expect(roleBundlesForPlayerCount(2)).toEqual([
      ["W", "S"],
      ["A", "D"]
    ]);
  });

  test("assigns one bundle per role for four players", () => {
    expect(roleBundlesForPlayerCount(4)).toEqual([["W"], ["A"], ["S"], ["D"]]);
  });
});
