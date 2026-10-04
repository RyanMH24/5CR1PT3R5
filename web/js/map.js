// @ts-check
/**
 * The office floor plan, in tiles. This file is pure data: change it (or replace it with one
 * exported from a tile editor) to redesign the office. The renderer, pathfinding and seating
 * logic all read from here.
 *
 * Coordinates: (0,0) is the top-left tile. A room's x/y/w/h include its walls, so its floor is
 * (x+1 .. x+w-2, y+1 .. y+h-2). Doors are wall tiles that can be walked through. Every tile
 * that is not inside a room is corridor.
 */

/** @typedef {'up' | 'down' | 'left' | 'right'} Facing */
/** @typedef {{ x: number, y: number }} Tile */
/**
 * @typedef {object} Room
 * @property {string} id
 * @property {string} label
 * @property {number} x
 * @property {number} y
 * @property {number} w
 * @property {number} h
 * @property {Tile[]} doors
 * @property {string} [floor]  Floor colour override.
 * @property {boolean} [highlight]  Draw a glowing border, like a control room.
 */
/**
 * @typedef {object} Furniture
 * @property {string} type  Renderer drawing routine, e.g. `desk`, `plant`, `rack`.
 * @property {number} x
 * @property {number} y
 * @property {number} w
 * @property {number} h
 * @property {boolean} blocks  Whether agents must walk around it.
 */
/**
 * @typedef {object} Seat
 * @property {string} id
 * @property {number} x
 * @property {number} y
 * @property {Facing} facing  Direction the agent faces once seated.
 * @property {string} zone
 * @property {boolean} chair  Draw a chair under the seat.
 * @property {Tile} [screen]  Monitor that lights up while the agent here is working.
 */

export const TILE = 16;
export const COLS = 76;
export const ROWS = 40;

/** Where agents appear when they first walk in. */
export const ENTRANCE = { x: 26, y: 12 };

/** @type {Room[]} */
export const ROOMS = [
  { id: 'briefing', label: 'BRIEFING ROOM', x: 0, y: 0, w: 15, h: 11, doors: [{ x: 7, y: 10 }, { x: 8, y: 10 }] },
  { id: 'meeting', label: 'MEETING ROOM', x: 15, y: 0, w: 19, h: 11, doors: [{ x: 24, y: 10 }, { x: 25, y: 10 }] },
  { id: 'approval', label: 'NEEDS YOU', x: 34, y: 0, w: 16, h: 11, doors: [{ x: 41, y: 10 }, { x: 42, y: 10 }] },
  {
    id: 'workspace', label: 'WORKSPACE', x: 0, y: 13, w: 26, h: 15, floor: '#262a31',
    doors: [{ x: 12, y: 13 }, { x: 13, y: 13 }, { x: 25, y: 20 }, { x: 12, y: 27 }, { x: 13, y: 27 }],
  },
  {
    id: 'command', label: 'COMMAND CENTER', x: 27, y: 13, w: 23, h: 17, floor: '#1c2129', highlight: true,
    doors: [{ x: 27, y: 20 }, { x: 27, y: 21 }],
  },
  { id: 'lounge', label: 'LOUNGE', x: 0, y: 29, w: 13, h: 11, floor: '#272420', doors: [{ x: 9, y: 29 }] },
  { id: 'pantry', label: 'PANTRY', x: 13, y: 29, w: 13, h: 11, floor: '#24262a', doors: [{ x: 16, y: 29 }] },
  { id: 'server', label: 'SERVER ROOM', x: 27, y: 31, w: 23, h: 9, floor: '#1a1d22', doors: [{ x: 33, y: 31 }, { x: 27, y: 35 }] },
  { id: 'cafe', label: 'CAFÉ', x: 50, y: 0, w: 26, h: 11, floor: '#29241f', doors: [{ x: 62, y: 10 }, { x: 63, y: 10 }] },
  { id: 'lab', label: 'LANGUAGE LAB', x: 50, y: 13, w: 26, h: 27, floor: '#22262d', doors: [{ x: 58, y: 13 }, { x: 59, y: 13 }] },
];

/** @param {string} type @param {number} x @param {number} y @param {number} w @param {number} h @param {boolean} [blocks] @returns {Furniture} */
const f = (type, x, y, w, h, blocks = true) => ({ type, x, y, w, h, blocks });

/** Desk pods: [x, y] of each 4x2 desk. Two seats sit below each desk, one at each end. */
const DESKS = [[3, 16], [10, 16], [17, 16], [3, 21], [10, 21], [17, 21]];
const LAB_DESKS = [16, 22, 28].flatMap((y) => [53, 61, 69].map((x) => [x, y]));
/** Café tables (2x2), each with four seats around it. */
const CAFE_TABLES = [[54, 5], [61, 5], [68, 5]];

/** @type {Furniture[]} */
export const FURNITURE = [
  // Briefing room
  f('projector', 4, 1, 7, 1),
  f('plant', 1, 9, 1, 1), f('plant', 13, 9, 1, 1), f('plant', 13, 1, 1, 1),
  // Meeting room
  f('tv', 21, 1, 5, 1), f('whiteboard', 27, 1, 4, 1),
  f('plant', 16, 1, 1, 1), f('plant', 32, 1, 1, 1),
  f('table', 19, 4, 11, 3),
  // Approval ("needs you") room
  f('rug', 37, 5, 10, 4, false),
  f('approvalDesk', 39, 3, 6, 2), f('chair', 41, 2, 1, 1, false),
  f('shelf', 47, 4, 2, 4), f('plant', 35, 1, 1, 1), f('plant', 35, 9, 1, 1),
  // Workspace
  ...DESKS.map(([x, y]) => f('desk', x, y, 4, 2)),
  f('shelf', 2, 26, 8, 1), f('cabinet', 16, 26, 3, 1),
  f('plant', 1, 14, 1, 1), f('plant', 24, 14, 1, 1), f('plant', 24, 26, 1, 1), f('plant', 1, 26, 1, 1),
  // Command center
  f('bigScreen', 31, 14, 15, 2),
  f('rack', 28, 15, 2, 3),
  f('console', 32, 18, 13, 2), f('console', 32, 24, 13, 2),
  f('sideMonitors', 46, 18, 2, 5),
  f('rack', 45, 26, 3, 3),
  f('plant', 28, 27, 1, 1), f('plant', 48, 14, 1, 1),
  // Lounge
  f('rug', 2, 31, 8, 6, false),
  f('sofa', 2, 30, 6, 1, false), f('armchair', 9, 32, 1, 1, false),
  f('coffeeTable', 3, 32, 4, 2),
  f('floorLamp', 11, 30, 1, 1), f('plant', 1, 38, 1, 1), f('plant', 11, 38, 1, 1),
  // Pantry
  f('fridge', 14, 30, 2, 2), f('counter', 18, 30, 7, 1),
  f('table', 17, 34, 5, 2),
  f('plant', 14, 38, 1, 1), f('plant', 24, 38, 1, 1),
  // Server room
  f('rack', 29, 33, 2, 4), f('rack', 32, 33, 2, 4), f('rack', 35, 33, 2, 4), f('rack', 47, 33, 2, 5),
  f('serverDesk', 42, 33, 4, 1),
  f('plant', 39, 38, 1, 1),
  // Café
  f('counter', 52, 1, 8, 1), f('fridge', 66, 1, 2, 2),
  ...CAFE_TABLES.map(([x, y]) => f('cafeTable', x, y, 2, 2)),
  f('sofa', 69, 9, 4, 1, false),
  f('plant', 51, 9, 1, 1), f('plant', 74, 1, 1, 1), f('plant', 60, 1, 1, 1),
  // Language Lab
  f('whiteboard', 63, 14, 5, 1), f('tv', 52, 14, 5, 1),
  ...LAB_DESKS.map(([x, y]) => f('desk', x, y, 4, 2)),
  f('rug', 53, 32, 20, 5, false),
  f('shelf', 52, 38, 8, 1), f('shelf', 64, 38, 8, 1),
  f('plant', 74, 14, 1, 1), f('plant', 51, 38, 1, 1), f('plant', 74, 38, 1, 1), f('plant', 61, 38, 1, 1),
];

/** Wall lamps: warm light pools, purely decorative. */
export const LAMPS = [
  { x: 3, y: 0 }, { x: 11, y: 0 }, { x: 18, y: 0 }, { x: 30, y: 0 }, { x: 37, y: 0 }, { x: 46, y: 0 },
  { x: 0, y: 17 }, { x: 0, y: 23 }, { x: 25, y: 16 }, { x: 25, y: 24 },
  { x: 27, y: 16 }, { x: 27, y: 26 }, { x: 49, y: 20 },
  { x: 0, y: 33 }, { x: 25, y: 34 }, { x: 49, y: 35 },
  { x: 55, y: 0 }, { x: 66, y: 0 }, { x: 72, y: 0 },
  { x: 66, y: 13 }, { x: 72, y: 13 }, { x: 75, y: 20 }, { x: 75, y: 27 }, { x: 75, y: 34 }, { x: 50, y: 33 },
];

/**
 * @param {string} id @param {number} x @param {number} y @param {Facing} facing @param {string} zone
 * @param {{ chair?: boolean, screen?: Tile }} [extra]
 * @returns {Seat}
 */
const seat = (id, x, y, facing, zone, extra = {}) => ({ id, x, y, facing, zone, chair: extra.chair ?? true, screen: extra.screen });

/** @type {Seat[]} */
export const SEATS = [
  // Briefing: 12 chairs facing the screen. Agents wait here while their job is queued.
  ...[4, 6, 8].flatMap((y, row) => [3, 5, 9, 11].map((x, col) => seat(`brief-${row * 4 + col}`, x, y, 'up', 'briefing'))),
  // Meeting: Ava plans at the head of the table.
  seat('meet-head', 18, 5, 'right', 'meeting'),
  seat('meet-foot', 30, 5, 'left', 'meeting'),
  ...[20, 22, 24, 26, 28].map((x, i) => seat(`meet-top-${i}`, x, 3, 'down', 'meeting')),
  ...[20, 22, 24, 26, 28].map((x, i) => seat(`meet-bottom-${i}`, x, 7, 'up', 'meeting')),
  // Needs you: agents whose job failed wait here until you look at it.
  ...[6, 8].flatMap((y, row) => [38, 40, 42, 44].map((x, col) => seat(`approval-${row * 4 + col}`, x, y, 'up', 'approval'))),
  // Workspace desks: one seat at each end of a pod, monitor directly above each seat.
  ...DESKS.flatMap(([x, y], d) => [0, 1].map((side) => {
    const sx = x + side * 3;
    return seat(`desk-${d * 2 + side}`, sx, y + 2, 'up', 'workspace', { screen: { x: sx, y } });
  })),
  // Command center consoles.
  seat('cc-lead', 35, 20, 'up', 'command', { screen: { x: 35, y: 18 } }),
  seat('cc-1', 41, 20, 'up', 'command', { screen: { x: 41, y: 18 } }),
  seat('cc-sec', 38, 26, 'up', 'command', { screen: { x: 38, y: 24 } }),
  seat('cc-2', 35, 26, 'up', 'command', { screen: { x: 35, y: 24 } }),
  // Server room desk.
  seat('srv-0', 43, 34, 'up', 'server', { screen: { x: 43, y: 33 } }),
  // Lounge: sofa, armchair and two chairs.
  seat('lounge-0', 3, 30, 'down', 'lounge', { chair: false }),
  seat('lounge-1', 5, 30, 'down', 'lounge', { chair: false }),
  seat('lounge-2', 7, 30, 'down', 'lounge', { chair: false }),
  seat('lounge-3', 9, 32, 'left', 'lounge', { chair: false }),
  seat('lounge-4', 4, 35, 'up', 'lounge'),
  seat('lounge-5', 7, 35, 'up', 'lounge'),
  // Pantry table.
  seat('pantry-0', 18, 33, 'down', 'pantry'),
  seat('pantry-1', 20, 33, 'down', 'pantry'),
  seat('pantry-2', 18, 36, 'up', 'pantry'),
  seat('pantry-3', 20, 36, 'up', 'pantry'),
  seat('pantry-4', 16, 34, 'right', 'pantry'),
  seat('pantry-5', 22, 35, 'left', 'pantry'),
  // Café: four seats round each table, plus the sofa.
  ...CAFE_TABLES.flatMap(([x, y], t) => [
    seat(`cafe-${t * 4}`, x - 1, y, 'right', 'cafe'),
    seat(`cafe-${t * 4 + 1}`, x + 2, y + 1, 'left', 'cafe'),
    seat(`cafe-${t * 4 + 2}`, x, y - 1, 'down', 'cafe'),
    seat(`cafe-${t * 4 + 3}`, x + 1, y + 2, 'up', 'cafe'),
  ]),
  seat('cafe-12', 70, 9, 'up', 'cafe', { chair: false }),
  seat('cafe-13', 72, 9, 'up', 'cafe', { chair: false }),
  // Language Lab: one desk per language specialist, monitor above each seat.
  ...LAB_DESKS.flatMap(([x, y], d) => [0, 1].map((side) => {
    const sx = x + side * 3;
    return seat(`lab-${d * 2 + side}`, sx, y + 2, 'up', 'lab', { screen: { x: sx, y } });
  })),
];

/** Each agent's own workstation. Agents not listed get a spare seat. */
export const WORKSTATIONS = /** @type {Record<string, string>} */ ({
  // Leadership
  'tech-lead': 'cc-lead',
  security: 'cc-sec',
  // Engineering roles
  backend: 'desk-0',
  frontend: 'desk-1',
  fullstack: 'desk-2',
  devops: 'desk-3',
  database: 'desk-4',
  qa: 'desk-5',
  writer: 'desk-6',
  // Language Lab
  powershell: 'lab-0',
  zsh: 'lab-1',
  bash: 'lab-2',
  python: 'lab-3',
  javascript: 'lab-4',
  typescript: 'lab-5',
  java: 'lab-6',
  csharp: 'lab-7',
  go: 'lab-8',
  c: 'lab-9',
  cpp: 'lab-10',
  rust: 'lab-11',
  php: 'lab-12',
  ruby: 'lab-13',
  swift: 'lab-14',
  kotlin: 'lab-15',
});
export const SPARE_WORKSTATIONS = ['lab-16', 'lab-17', 'desk-7', 'desk-8', 'desk-9', 'desk-10', 'desk-11', 'cc-1', 'cc-2', 'srv-0'];

export const PLANNING_SEAT = 'meet-head';
export const zoneSeats = (/** @type {string} */ zone) => SEATS.filter((s) => s.zone === zone).map((s) => s.id);
export const BRIEFING_SEATS = zoneSeats('briefing');
export const APPROVAL_SEATS = zoneSeats('approval');
/** Idle agents spread across the lounge, pantry and café. */
export const IDLE_SEATS = interleave(zoneSeats('lounge'), zoneSeats('pantry'), zoneSeats('cafe'));

/**
 * @typedef {object} Hangout
 * @property {string} id
 * @property {number} x
 * @property {number} y
 * @property {Facing} facing  Direction the agent faces while standing here.
 * @property {string} bubble  What they're up to, shown once they arrive.
 */

/** @param {string} id @param {number} x @param {number} y @param {Facing} facing @param {string} bubble @returns {Hangout} */
const spot = (id, x, y, facing, bubble) => ({ id, x, y, facing, bubble });

/**
 * Places idle agents wander to for a moment: open floor tiles next to something worth a visit.
 * One agent per spot. Pairs facing each other make two agents look like they're chatting.
 * @type {Hangout[]}
 */
export const HANGOUTS = [
  spot('cafe-counter-a', 53, 2, 'up', 'Coffee run'),
  spot('cafe-counter-b', 57, 2, 'up', 'Coffee run'),
  spot('cafe-fridge', 67, 3, 'up', 'Grabbing a drink'),
  spot('pantry-fridge', 15, 32, 'up', 'Snack break'),
  spot('pantry-counter-a', 19, 31, 'up', 'Making tea'),
  spot('pantry-counter-b', 23, 31, 'up', 'Snack break'),
  spot('lounge-stretch', 10, 36, 'left', 'Stretching'),
  spot('meeting-board', 28, 2, 'up', 'Sketching ideas'),
  spot('lab-board', 66, 15, 'up', 'Reading the board'),
  spot('command-screen', 40, 16, 'up', 'Checking the dashboard'),
  spot('server-racks', 37, 35, 'left', 'Checking servers'),
  spot('workspace-shelf', 5, 25, 'down', 'Finding a book'),
  spot('hall-west-a', 30, 11, 'right', 'Small talk'),
  spot('hall-west-b', 31, 11, 'left', 'Small talk'),
  spot('hall-east-a', 66, 11, 'right', 'Small talk'),
  spot('hall-east-b', 67, 11, 'left', 'Small talk'),
];

/** @param {string[][]} lists */
function interleave(...lists) {
  /** @type {string[]} */
  const out = [];
  for (let i = 0; i < Math.max(...lists.map((l) => l.length)); i++) {
    for (const list of lists) if (list[i]) out.push(list[i]);
  }
  return out;
}

/** @param {string} id */
export function getSeat(id) {
  const found = SEATS.find((s) => s.id === id);
  if (!found) throw new Error(`Unknown seat: ${id}`);
  return found;
}
