export function mapKeyToRole(key) {
    const normalized = key.toUpperCase();
    if (normalized === "W" || normalized === "A" || normalized === "S" || normalized === "D") {
        return normalized;
    }
    return null;
}
