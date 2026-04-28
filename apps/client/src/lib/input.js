export function mapKeyToRole(key) {
    if (typeof key !== "string")
        return null;
    const normalized = key.toUpperCase();
    if (normalized === "W" || normalized === "A" || normalized === "S" || normalized === "D") {
        return normalized;
    }
    return null;
}
