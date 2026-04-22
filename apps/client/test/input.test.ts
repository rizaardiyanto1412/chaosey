import { describe, expect, test } from "vitest";
import { mapKeyToRole } from "../src/lib/input";

describe("mapKeyToRole", () => {
  test("maps valid keys", () => {
    expect(mapKeyToRole("w")).toBe("W");
    expect(mapKeyToRole("A")).toBe("A");
  });

  test("rejects non role keys", () => {
    expect(mapKeyToRole("Q")).toBeNull();
  });
});
