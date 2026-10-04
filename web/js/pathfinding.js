// @ts-check
/**
 * Walkability grid and shortest paths over the floor plan. The map is small (50x40), so a plain
 * breadth-first search per trip is instant and needs no heuristics.
 */

/** @typedef {import('./map.js').Room} Room */
/** @typedef {import('./map.js').Furniture} Furniture */
/** @typedef {import('./map.js').Tile} Tile */

/**
 * @typedef {object} Grid
 * @property {number} cols
 * @property {number} rows
 * @property {Uint8Array} walkable  1 = walkable, indexed y * cols + x.
 */

/**
 * @param {Room[]} rooms
 * @param {Furniture[]} furniture
 * @param {number} cols
 * @param {number} rows
 * @returns {Grid}
 */
export function buildGrid(rooms, furniture, cols, rows) {
  const walkable = new Uint8Array(cols * rows).fill(1); // corridor by default
  for (const room of rooms) {
    for (let y = room.y; y < room.y + room.h; y++) {
      for (let x = room.x; x < room.x + room.w; x++) {
        const isWall = x === room.x || y === room.y || x === room.x + room.w - 1 || y === room.y + room.h - 1;
        if (isWall) walkable[y * cols + x] = 0;
      }
    }
  }
  // Doors last, so a door punches through any wall drawn by a neighbouring room.
  for (const room of rooms) for (const d of room.doors) walkable[d.y * cols + d.x] = 1;
  for (const item of furniture) {
    if (!item.blocks) continue;
    for (let y = item.y; y < item.y + item.h; y++) {
      for (let x = item.x; x < item.x + item.w; x++) walkable[y * cols + x] = 0;
    }
  }
  return { cols, rows, walkable };
}

/** @param {Grid} grid @param {number} x @param {number} y */
export function isWalkable(grid, x, y) {
  return x >= 0 && y >= 0 && x < grid.cols && y < grid.rows && grid.walkable[y * grid.cols + x] === 1;
}

/**
 * Shortest 4-directional path from `from` to `to`, excluding `from`. Empty when already there
 * or unreachable. The target itself may be unwalkable furniture (e.g. a sofa seat).
 * @param {Grid} grid
 * @param {Tile} from
 * @param {Tile} to
 * @returns {Tile[]}
 */
export function findPath(grid, from, to) {
  if (from.x === to.x && from.y === to.y) return [];
  const { cols, rows } = grid;
  const start = from.y * cols + from.x;
  const goal = to.y * cols + to.x;
  const previous = new Int32Array(cols * rows).fill(-1);
  previous[start] = start;
  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];
    if (current === goal) break;
    const cx = current % cols;
    const cy = (current - cx) / cols;
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const nx = cx + dx;
      const ny = cy + dy;
      const next = ny * cols + nx;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || previous[next] !== -1) continue;
      if (next !== goal && !isWalkable(grid, nx, ny)) continue;
      previous[next] = current;
      queue.push(next);
    }
  }
  if (previous[goal] === -1) return [];
  /** @type {Tile[]} */
  const path = [];
  for (let at = goal; at !== start; at = previous[at]) path.push({ x: at % cols, y: Math.floor(at / cols) });
  return path.reverse();
}
