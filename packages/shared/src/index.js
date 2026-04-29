export const DEFAULT_LEVEL_ID = "level-01";
export const ROLES = ["W", "A", "S", "D"];
export const DEFAULT_LEVEL = {
    id: "level-1",
    width: 1856,
    height: 1024,
    spawn: { x: 180, y: 300 },
    playerRadius: 18,
    moveSpeed: 160,
    obstacles: [
        { id: "goal", kind: "goal", position: { x: 1660, y: 190 }, size: { x: 120, y: 120 } }
    ],
    collectibles: []
};
export function emptyInputState() {
    return { W: false, A: false, S: false, D: false };
}
export function composeDirection(input) {
    const x = (input.D ? 1 : 0) - (input.A ? 1 : 0);
    const y = (input.S ? 1 : 0) - (input.W ? 1 : 0);
    if (x === 0 && y === 0) {
        return { x: 0, y: 0 };
    }
    const magnitude = Math.hypot(x, y);
    return { x: x / magnitude, y: y / magnitude };
}
export function circlesIntersectsRect(center, radius, rectPos, rectSize) {
    const nearestX = Math.max(rectPos.x, Math.min(center.x, rectPos.x + rectSize.x));
    const nearestY = Math.max(rectPos.y, Math.min(center.y, rectPos.y + rectSize.y));
    const dx = center.x - nearestX;
    const dy = center.y - nearestY;
    return dx * dx + dy * dy <= radius * radius;
}
export function roleBundlesForPlayerCount(playerCount) {
    if (playerCount <= 1)
        return [["W", "A", "S", "D"]];
    if (playerCount === 2)
        return [["W", "S"], ["A", "D"]];
    if (playerCount === 3)
        return [["W", "S"], ["A"], ["D"]];
    return [["W"], ["A"], ["S"], ["D"]];
}
