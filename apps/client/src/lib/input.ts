import type { PlayerRole } from "@wasd/shared";

export function mapKeyToRole(key: string): PlayerRole | null {
  const normalized = key.toUpperCase();
  if (normalized === "W" || normalized === "A" || normalized === "S" || normalized === "D") {
    return normalized;
  }
  return null;
}
