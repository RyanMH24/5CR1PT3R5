// @ts-check
/**
 * Canvas renderer for the office. The floor plan is drawn once into an offscreen layer (redrawn
 * only on resize); each frame then adds the moving parts: blinking servers, lit monitors, agents,
 * name tags and speech bubbles. Drawing happens in logical pixels (TILE units) under a single
 * scale transform, so the art stays crisp at any window size.
 */
import { COLS, FURNITURE, LAMPS, ROOMS, ROWS, SEATS, TILE } from './map.js';
import { drawCharacter, SPRITE_H } from './sprites.js';

/** @typedef {import('./map.js').Furniture} Furniture */
/** @typedef {import('./map.js').Tile} Tile */
/** @typedef {import('./director.js').Mood} Mood */
/**
 * @typedef {object} SceneAgent
 * @property {string} id
 * @property {string} name
 * @property {import('./sprites.js').Look} look
 * @property {number} x  Feet position, logical px.
 * @property {number} y
 * @property {import('./sprites.js').Pose} pose
 * @property {Mood} mood
 * @property {string} [bubble]
 * @property {{ done: number, total: number }} [progress]
 * @property {boolean} selected
 */
/** @typedef {{ agents: SceneAgent[], litScreens: Tile[], time: number, animate: boolean }} Scene */

export const LOGICAL_W = COLS * TILE;
export const LOGICAL_H = ROWS * TILE;
/** Characters are drawn at 2x so they read at a glance; the room art stays at 1x. */
const CHAR_SCALE = 2;
const CHAR_H = SPRITE_H * CHAR_SCALE;
const FONT = '"Pixelify Sans", ui-monospace, monospace';

const C = {
  corridor: '#2a2e35',
  corridorLine: '#30353d',
  roomFloor: '#23272e',
  floorLine: 'rgba(255,255,255,0.035)',
  wallCap: '#121418',
  wallFace: '#2b3038',
  wallEdge: '#3b414b',
  glass: 'rgba(120,180,200,0.28)',
  glassEdge: 'rgba(170,220,235,0.55)',
  label: '#b3bcc8',
  wood: '#5a3e2b',
  woodEdge: '#3f2b1f',
  woodLight: '#6d4c35',
  metal: '#2a2f37',
  screenOff: '#16283a',
  screenOn: '#3aa0e0',
  screenGlow: 'rgba(80,170,240,0.22)',
  lamp: '#f2c36b',
  highlight: '#4f8cc9',
};

export class OfficeRenderer {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available in this browser');
    this.ctx = ctx;
    this.scale = 1;
    /** @type {HTMLCanvasElement | null} */
    this.floorLayer = null;
  }

  /** Match the backing store to the displayed size so pixels stay sharp. @param {number} cssWidth */
  resize(cssWidth) {
    const scale = Math.max(0.5, (cssWidth / LOGICAL_W) * (window.devicePixelRatio || 1));
    if (Math.abs(scale - this.scale) < 0.01 && this.floorLayer) return;
    this.scale = scale;
    this.canvas.width = Math.round(LOGICAL_W * scale);
    this.canvas.height = Math.round(LOGICAL_H * scale);
    this.floorLayer = this.drawFloorLayer();
  }

  /** Rebuild the static layer, e.g. once the pixel font has loaded. */
  invalidate() {
    this.floorLayer = this.drawFloorLayer();
  }

  /** @param {Scene} scene */
  render(scene) {
    const { ctx } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.floorLayer) ctx.drawImage(this.floorLayer, 0, 0);
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    ctx.imageSmoothingEnabled = false;
    drawRackLights(ctx, scene.animate ? scene.time : 0);
    for (const screen of scene.litScreens) drawMonitor(ctx, screen, true, scene.time);
    const agents = [...scene.agents].sort((a, b) => a.y - b.y);
    for (const agent of agents) drawAgent(ctx, agent);
    for (const agent of agents) drawNameTag(ctx, agent);
    /** @type {Box[]} */
    const placed = [];
    // Bottom-most first, so higher bubbles are the ones nudged upward out of the way.
    for (const agent of [...agents].reverse()) if (agent.bubble) drawBubble(ctx, agent, placed);
  }

  /**
   * Agent under a point given in CSS pixels relative to the canvas, if any.
   * @param {Scene} scene @param {number} cssX @param {number} cssY @param {number} cssWidth
   */
  hitTest(scene, cssX, cssY, cssWidth) {
    const k = LOGICAL_W / cssWidth;
    const x = cssX * k;
    const y = cssY * k;
    const hits = scene.agents.filter((a) => Math.abs(a.x - x) <= 11 && y >= a.y - CHAR_H - 4 && y <= a.y + 10);
    return hits.sort((a, b) => b.y - a.y)[0];
  }

  drawFloorLayer() {
    const layer = document.createElement('canvas');
    layer.width = this.canvas.width;
    layer.height = this.canvas.height;
    const ctx = /** @type {CanvasRenderingContext2D} */ (layer.getContext('2d'));
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    ctx.imageSmoothingEnabled = false;
    drawFloors(ctx);
    for (const item of FURNITURE.filter((it) => it.type === 'rug')) drawFurniture(ctx, item);
    drawWalls(ctx);
    for (const seat of SEATS) if (seat.chair) drawChair(ctx, seat.x, seat.y, seat.facing);
    for (const item of FURNITURE.filter((it) => it.type !== 'rug')) drawFurniture(ctx, item);
    for (const seat of SEATS) if (seat.screen) drawMonitor(ctx, seat.screen, false, 0);
    drawLamps(ctx);
    drawLabels(ctx);
    return layer;
  }
}

// ── floor plan ──────────────────────────────────────────────────────────────

/** @param {CanvasRenderingContext2D} ctx */
function drawFloors(ctx) {
  fill(ctx, C.corridor, 0, 0, LOGICAL_W, LOGICAL_H); // every tile outside a room is corridor
  gridLines(ctx, 0, 0, COLS, ROWS, C.corridorLine);
  for (const room of ROOMS) {
    fill(ctx, room.floor ?? C.roomFloor, room.x * TILE, room.y * TILE, room.w * TILE, room.h * TILE);
    gridLines(ctx, room.x, room.y, room.w, room.h, C.floorLine);
  }
}

/** @param {CanvasRenderingContext2D} ctx @param {number} x @param {number} y @param {number} w @param {number} h @param {string} color */
function gridLines(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  for (let i = 1; i < w; i++) ctx.fillRect((x + i) * TILE, y * TILE, 0.5, h * TILE);
  for (let j = 1; j < h; j++) ctx.fillRect(x * TILE, (y + j) * TILE, w * TILE, 0.5);
}

/** @param {CanvasRenderingContext2D} ctx */
function drawWalls(ctx) {
  for (const room of ROOMS) {
    const isDoor = (/** @type {number} */ x, /** @type {number} */ y) => room.doors.some((d) => d.x === x && d.y === y);
    const right = room.x + room.w - 1;
    const bottom = room.y + room.h - 1;
    for (let x = room.x; x <= right; x++) {
      if (!isDoor(x, room.y)) wallTop(ctx, x, room.y);
      if (!isDoor(x, bottom)) wallGlass(ctx, x, bottom);
    }
    for (let y = room.y + 1; y < bottom; y++) {
      if (!isDoor(room.x, y)) wallSide(ctx, room.x, y, 'left');
      if (!isDoor(right, y)) wallSide(ctx, right, y, 'right');
    }
    if (room.highlight) {
      ctx.save();
      ctx.strokeStyle = C.highlight;
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = 1;
      ctx.shadowColor = C.highlight;
      ctx.shadowBlur = 6;
      ctx.strokeRect(room.x * TILE + 3.5, room.y * TILE + 3.5, room.w * TILE - 7, room.h * TILE - 7);
      ctx.restore();
    }
  }
}

/** Top walls show their face, like a 3/4 view. @param {CanvasRenderingContext2D} ctx @param {number} x @param {number} y */
function wallTop(ctx, x, y) {
  const px = x * TILE;
  const py = y * TILE;
  fill(ctx, C.wallCap, px, py, TILE, 5);
  fill(ctx, C.wallFace, px, py + 5, TILE, 11);
  fill(ctx, C.wallEdge, px, py + 5, TILE, 1);
  fill(ctx, 'rgba(0,0,0,0.35)', px, py + 15, TILE, 1);
}

/** Bottom walls are glass partitions. @param {CanvasRenderingContext2D} ctx @param {number} x @param {number} y */
function wallGlass(ctx, x, y) {
  const px = x * TILE;
  const py = y * TILE;
  fill(ctx, C.wallCap, px, py + 10, TILE, 6);
  fill(ctx, C.glass, px, py + 2, TILE, 8);
  fill(ctx, C.glassEdge, px, py + 2, TILE, 1);
  fill(ctx, C.wallCap, px + 15, py + 2, 1, 8); // mullion
}

/** @param {CanvasRenderingContext2D} ctx @param {number} x @param {number} y @param {'left' | 'right'} side */
function wallSide(ctx, x, y, side) {
  const px = x * TILE + (side === 'left' ? 0 : 10);
  fill(ctx, C.wallCap, px, y * TILE, 6, TILE);
  fill(ctx, C.wallEdge, side === 'left' ? px + 5 : px, y * TILE, 1, TILE);
}

/** @param {CanvasRenderingContext2D} ctx */
function drawLabels(ctx) {
  ctx.font = `600 7px ${FONT}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  for (const room of ROOMS) {
    ctx.fillStyle = C.label;
    ctx.fillText(room.label, room.x * TILE + 8, room.y * TILE + 10.5);
  }
}

/** @param {CanvasRenderingContext2D} ctx */
function drawLamps(ctx) {
  for (const lamp of LAMPS) {
    const cx = lamp.x * TILE + TILE / 2;
    const cy = lamp.y * TILE + (lamp.y === 0 ? 9 : TILE / 2);
    glow(ctx, cx, cy + 6, 34, 'rgba(255,190,110,0.16)');
    fill(ctx, C.lamp, cx - 2, cy - 2, 4, 3);
    fill(ctx, '#fff1cf', cx - 1, cy - 1, 2, 1);
  }
}

// ── furniture ───────────────────────────────────────────────────────────────

/** @type {Record<string, (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => void>} */
const DRAW = {
  projector(ctx, x, y, w) {
    fill(ctx, C.metal, x + 2, y + 3, w - 4, 11);
    fill(ctx, '#e8ecf1', x + 4, y + 4, w - 8, 9);
    fill(ctx, 'rgba(120,170,220,0.25)', x + 4, y + 4, w - 8, 3);
  },
  tv(ctx, x, y, w) {
    fill(ctx, '#0a0c0f', x + 1, y + 3, w - 2, 11);
    fill(ctx, '#12304d', x + 3, y + 5, w - 6, 7);
    fill(ctx, '#2f8fd8', x + 6, y + 9, 10, 1);
    fill(ctx, '#e0a33a', x + 20, y + 7, 12, 1);
  },
  whiteboard(ctx, x, y, w) {
    fill(ctx, '#8a929c', x + 1, y + 3, w - 2, 11);
    fill(ctx, '#e3e7ec', x + 2, y + 4, w - 4, 9);
    fill(ctx, '#d14d4d', x + 6, y + 6, 14, 1);
    fill(ctx, '#2f6fd1', x + 6, y + 9, 22, 1);
    fill(ctx, '#2f9e5b', x + 36, y + 6, 1, 5);
    fill(ctx, '#2f9e5b', x + 38, y + 8, 12, 1);
  },
  table(ctx, x, y, w, h) {
    fill(ctx, 'rgba(0,0,0,0.3)', x + 2, y + 3, w - 2, h - 1);
    fill(ctx, C.woodEdge, x, y + 1, w - 1, h - 1);
    fill(ctx, C.wood, x, y, w - 1, h - 4);
    fill(ctx, C.woodLight, x + 1, y + 1, w - 3, 1);
    for (let i = 1; i < w / TILE - 1; i += 2) {
      fill(ctx, '#1b1f25', x + i * TILE + 3, y + h / 2 - 4, 9, 6); // laptops
      fill(ctx, '#2a5d86', x + i * TILE + 4, y + h / 2 - 3, 7, 3);
    }
  },
  desk(ctx, x, y, w, h) {
    fill(ctx, 'rgba(0,0,0,0.3)', x + 2, y + 3, w - 2, h - 1);
    fill(ctx, C.woodEdge, x, y + 2, w - 1, h - 2);
    fill(ctx, C.wood, x, y, w - 1, h - 5);
    fill(ctx, C.woodLight, x + 1, y + 1, w - 3, 1);
    fill(ctx, '#d9d4c7', x + 3, y + h - 12, 5, 4); // papers
    fill(ctx, '#c9a06a', x + w - 8, y + h - 12, 3, 3); // mug
  },
  serverDesk(ctx, x, y, w, h) {
    DRAW.desk(ctx, x, y, w, h + 4);
  },
  approvalDesk(ctx, x, y, w, h) {
    DRAW.desk(ctx, x, y, w, h);
    glow(ctx, x + 10, y + 6, 22, 'rgba(255,200,120,0.25)');
    fill(ctx, C.lamp, x + 8, y + 3, 4, 3);
    fill(ctx, '#e8e2d0', x + w / 2 - 8, y + 6, 7, 9);
    fill(ctx, '#e8e2d0', x + w / 2 + 2, y + 7, 7, 9);
  },
  chair(ctx, x, y) {
    drawChair(ctx, x / TILE, y / TILE, 'down');
  },
  plant(ctx, x, y) {
    fill(ctx, 'rgba(0,0,0,0.3)', x + 4, y + 13, 9, 2);
    fill(ctx, '#5c4433', x + 4, y + 9, 8, 5);
    fill(ctx, '#2f7d4a', x + 2, y + 2, 12, 8);
    fill(ctx, '#3e9e5d', x + 4, y, 8, 6);
    fill(ctx, '#57b873', x + 6, y + 1, 3, 2);
  },
  shelf(ctx, x, y, w, h) {
    fill(ctx, '#3d2b20', x, y, w, h);
    const books = ['#8b3a3a', '#2f5d8a', '#c79a3a', '#3a7a5a', '#6b6f78', '#a4553a'];
    const rows = Math.max(1, Math.floor(h / 8));
    for (let r = 0; r < rows; r++) {
      for (let i = 0, bx = x + 2; bx < x + w - 3; i++, bx += 3) {
        fill(ctx, books[(i + r * 2) % books.length], bx, y + 1 + r * 8, 2, 6);
      }
    }
  },
  cabinet(ctx, x, y, w, h) {
    fill(ctx, '#3a3f47', x, y + 2, w, h - 2);
    for (let i = 1; i < w / TILE; i++) fill(ctx, '#2a2e35', x + i * TILE, y + 2, 1, h - 2);
  },
  rug(ctx, x, y, w, h) {
    fill(ctx, 'rgba(90,110,140,0.18)', x + 2, y + 2, w - 4, h - 4);
    ctx.strokeStyle = 'rgba(160,180,210,0.15)';
    ctx.strokeRect(x + 4.5, y + 4.5, w - 9, h - 9);
  },
  sofa(ctx, x, y, w) {
    fill(ctx, 'rgba(0,0,0,0.3)', x + 1, y + 13, w - 1, 3);
    fill(ctx, '#262a31', x, y + 1, w, 6);
    fill(ctx, '#353b44', x, y + 6, w, 8);
    for (let i = 1; i < w / TILE; i++) fill(ctx, '#2b3038', x + i * TILE, y + 6, 1, 8);
    fill(ctx, '#2b3038', x, y + 3, 3, 11);
    fill(ctx, '#2b3038', x + w - 3, y + 3, 3, 11);
  },
  armchair(ctx, x, y) {
    fill(ctx, '#262a31', x + 11, y + 1, 4, 14);
    fill(ctx, '#353b44', x + 2, y + 2, 10, 12);
  },
  cafeTable(ctx, x, y, w, h) {
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(x + w / 2 + 1, y + h / 2 + 3, w / 2 - 3, h / 2 - 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = C.woodEdge;
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h / 2 + 1, w / 2 - 4, h / 2 - 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = C.wood;
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h / 2 - 1, w / 2 - 4, h / 2 - 6, 0, 0, Math.PI * 2);
    ctx.fill();
    fill(ctx, '#e6dccb', x + 10, y + 12, 3, 3); // cups
    fill(ctx, '#e6dccb', x + 19, y + 15, 3, 3);
  },
  coffeeTable(ctx, x, y, w, h) {
    fill(ctx, 'rgba(0,0,0,0.3)', x + 3, y + 5, w - 4, h - 6);
    fill(ctx, C.wood, x + 2, y + 3, w - 4, h - 8);
    fill(ctx, C.woodEdge, x + 2, y + h - 6, w - 4, 2);
    fill(ctx, '#e6dccb', x + 12, y + 8, 4, 3);
    glow(ctx, x + w / 2, y + h / 2, 12, 'rgba(255,200,120,0.15)');
  },
  floorLamp(ctx, x, y) {
    glow(ctx, x + 8, y + 4, 30, 'rgba(255,190,110,0.22)');
    fill(ctx, '#3a3f47', x + 7, y + 4, 2, 11);
    fill(ctx, C.lamp, x + 4, y + 1, 8, 4);
  },
  fridge(ctx, x, y, w, h) {
    fill(ctx, '#aeb5bf', x + 2, y + 1, w - 4, h - 2);
    fill(ctx, '#c9cfd7', x + 3, y + 2, w - 6, h - 4);
    fill(ctx, '#8d96a2', x + 3, y + 12, w - 6, 1);
    fill(ctx, '#6e7782', x + w - 7, y + 5, 1, 5);
  },
  counter(ctx, x, y, w) {
    fill(ctx, '#33373e', x, y + 3, w, 13);
    fill(ctx, '#5b616b', x, y + 3, w, 4);
    fill(ctx, '#8a96a3', x + 20, y + 4, 12, 2); // sink
    fill(ctx, '#1b1e23', x + 50, y, 8, 7); // coffee machine
    fill(ctx, '#e05252', x + 55, y + 2, 1, 1);
  },
  rack(ctx, x, y, w, h) {
    fill(ctx, 'rgba(0,0,0,0.35)', x + 2, y + 3, w - 2, h - 1);
    fill(ctx, '#0d1014', x + 1, y, w - 2, h - 1);
    ctx.strokeStyle = '#262b33';
    ctx.strokeRect(x + 1.5, y + 0.5, w - 3, h - 2);
    for (let ry = y + 3; ry < y + h - 3; ry += 4) fill(ctx, '#161a20', x + 3, ry, w - 6, 2);
  },
  bigScreen(ctx, x, y, w, h) {
    fill(ctx, '#0b0e13', x, y + 1, w, h - 2);
    fill(ctx, '#0b1d33', x + 2, y + 3, w - 4, h - 6);
    // Left: pie chart.
    pie(ctx, x + 16, y + 15, 7);
    // Middle: world map made of dots.
    const mx = x + 40;
    for (let i = 0; i < 26; i++) {
      for (let j = 0; j < 7; j++) {
        if ((i * 7 + j * 3) % 5 < 3 && !(i > 8 && i < 11) && !(i > 17 && j > 4)) fill(ctx, '#2a6a9e', mx + i * 4, y + 6 + j * 3, 2, 2);
      }
    }
    // Right: line charts.
    ctx.strokeStyle = '#e0a33a';
    ctx.beginPath();
    for (let i = 0; i < 9; i++) ctx.lineTo(x + w - 60 + i * 6, y + 18 - ((i * 37) % 11));
    ctx.stroke();
    ctx.strokeStyle = '#3aa0e0';
    ctx.beginPath();
    for (let i = 0; i < 9; i++) ctx.lineTo(x + w - 60 + i * 6, y + 24 - ((i * 23) % 8));
    ctx.stroke();
  },
  console(ctx, x, y, w, h) {
    fill(ctx, 'rgba(0,0,0,0.3)', x + 2, y + 3, w - 2, h - 1);
    fill(ctx, '#20252d', x, y + 4, w, h - 4);
    fill(ctx, '#2c323b', x, y + 4, w, 3);
    for (let i = 0; i < w / TILE; i++) {
      fill(ctx, '#0d1015', x + i * TILE + 2, y, 12, 8);
      fill(ctx, '#123049', x + i * TILE + 3, y + 1, 10, 6);
    }
  },
  sideMonitors(ctx, x, y, w, h) {
    fill(ctx, '#0d1015', x + 2, y, w - 4, h);
    for (let my = y + 2; my < y + h - 8; my += 13) fill(ctx, '#14395a', x + 4, my, w - 8, 10);
  },
};

/** @param {CanvasRenderingContext2D} ctx @param {Furniture} item */
function drawFurniture(ctx, item) {
  const draw = DRAW[item.type];
  if (draw) draw(ctx, item.x * TILE, item.y * TILE, item.w * TILE, item.h * TILE);
}

/** @param {CanvasRenderingContext2D} ctx @param {number} tx @param {number} ty @param {import('./map.js').Facing} facing */
function drawChair(ctx, tx, ty, facing) {
  const x = tx * TILE;
  const y = ty * TILE;
  fill(ctx, 'rgba(0,0,0,0.3)', x + 3, y + 12, 11, 3);
  fill(ctx, '#1d2026', x + 3, y + 4, 10, 9);
  if (facing === 'up') fill(ctx, '#121418', x + 3, y + 11, 10, 4);
  else if (facing === 'down') fill(ctx, '#121418', x + 3, y + 1, 10, 4);
  else if (facing === 'left') fill(ctx, '#121418', x + 11, y + 2, 4, 11);
  else fill(ctx, '#121418', x + 1, y + 2, 4, 11);
}

/** @param {CanvasRenderingContext2D} ctx @param {Tile} tile @param {boolean} on @param {number} time */
function drawMonitor(ctx, tile, on, time) {
  const x = tile.x * TILE + 2;
  const y = tile.y * TILE + 1;
  if (on) glow(ctx, x + 6, y + 5, 14, C.screenGlow);
  fill(ctx, '#0b0d11', x, y, 12, 9);
  fill(ctx, on ? C.screenOn : C.screenOff, x + 1, y + 1, 10, 6);
  fill(ctx, C.metal, x + 5, y + 9, 2, 2);
  if (on) {
    // Scrolling "code" lines.
    const offset = Math.floor(time / 180) % 4;
    for (let i = 0; i < 3; i++) {
      const len = 3 + ((i + offset) * 5) % 6;
      fill(ctx, '#bfe6ff', x + 2, y + 2 + i * 2, len, 1);
    }
  }
}

/** @param {CanvasRenderingContext2D} ctx @param {number} time */
function drawRackLights(ctx, time) {
  let n = 0;
  for (const rack of FURNITURE) {
    if (rack.type !== 'rack') continue;
    const x = rack.x * TILE;
    const y = rack.y * TILE;
    for (let ry = y + 3; ry < y + rack.h * TILE - 3; ry += 4) {
      n++;
      const blink = Math.floor(time / 400 + n * 1.7) % 5;
      fill(ctx, blink === 0 ? '#0f3d24' : '#38d07a', x + rack.w * TILE - 6, ry, 1, 1);
      fill(ctx, (n + Math.floor(time / 900)) % 7 === 0 ? '#f0b45a' : '#1b5e8a', x + rack.w * TILE - 8, ry, 1, 1);
    }
  }
}

// ── agents ──────────────────────────────────────────────────────────────────

/** @param {CanvasRenderingContext2D} ctx @param {SceneAgent} agent */
function drawAgent(ctx, agent) {
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(agent.x, agent.y, 8, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  if (agent.selected) {
    ctx.strokeStyle = '#f0b45a';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(agent.x, agent.y, 12, 5, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.save();
  ctx.translate(Math.round(agent.x), Math.round(agent.y));
  ctx.scale(CHAR_SCALE, CHAR_SCALE);
  drawCharacter(ctx, agent.look, agent.pose, 0, 0);
  ctx.restore();
}

const BUBBLE_STYLE = /** @type {Record<Mood, { bg: string, fg: string, edge: string }>} */ ({
  working: { bg: '#f3f5f8', fg: '#14171c', edge: '#c9d1db' },
  planning: { bg: '#f3f5f8', fg: '#14171c', edge: '#c9d1db' },
  waiting: { bg: '#2b2f36', fg: '#f0d48a', edge: '#5b5340' },
  attention: { bg: '#3a1d1f', fg: '#ffb4b4', edge: '#f06a6a' },
  celebrating: { bg: '#163325', fg: '#9ff0c4', edge: '#4cc38a' },
  idle: { bg: '#2b2f36', fg: '#c9d1db', edge: '#444b55' },
});

/** @typedef {{ x: number, y: number, w: number, h: number }} Box */

/** Drawn after all bodies so no one's head covers a name. @param {CanvasRenderingContext2D} ctx @param {SceneAgent} agent */
function drawNameTag(ctx, agent) {
  ctx.font = `600 7px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(8,10,13,0.92)';
  ctx.strokeText(agent.name, agent.x, agent.y + 2);
  ctx.fillStyle = agent.selected ? '#f0b45a' : '#e9edf2';
  ctx.fillText(agent.name, agent.x, agent.y + 2);
}

/**
 * Speech bubble above the head, nudged upward if it would overlap one already drawn.
 * @param {CanvasRenderingContext2D} ctx @param {SceneAgent} agent @param {Box[]} placed
 */
function drawBubble(ctx, agent, placed) {
  const text = /** @type {string} */ (agent.bubble);
  const seatedLift = agent.pose.seated ? 2 * CHAR_SCALE : 0;
  const style = BUBBLE_STYLE[agent.mood];
  ctx.font = `7px ${FONT}`;
  ctx.textAlign = 'center';
  const textW = Math.ceil(ctx.measureText(text).width);
  const barH = agent.progress ? 4 : 0;
  const w = textW + 10;
  const h = 12 + barH;
  const bx = Math.round(Math.min(Math.max(agent.x - w / 2, 2), LOGICAL_W - w - 2));
  let by = Math.round(agent.y - CHAR_H - seatedLift - h - 4);
  const overlaps = (/** @type {Box} */ b) => bx < b.x + b.w + 2 && bx + w + 2 > b.x && by < b.y + b.h + 2 && by + h + 2 > b.y;
  for (let guard = 0; guard < 6; guard++) {
    const hit = placed.find(overlaps);
    if (!hit) break;
    by = hit.y - h - 3;
  }
  placed.push({ x: bx, y: by, w, h });

  // Tail points at the head, stretching if the bubble was nudged up.
  const tailTop = by + h;
  const headTop = Math.round(agent.y - CHAR_H - seatedLift);
  ctx.fillStyle = style.edge;
  if (headTop - tailTop > 4) ctx.fillRect(agent.x - 0.5, tailTop, 1, headTop - tailTop - 1);
  roundRect(ctx, bx - 0.5, by - 0.5, w + 1, h + 1, 3);
  ctx.fillStyle = style.bg;
  roundRect(ctx, bx, by, w, h, 2.5);
  ctx.beginPath(); // tail
  ctx.moveTo(agent.x - 2, by + h);
  ctx.lineTo(agent.x + 2, by + h);
  ctx.lineTo(agent.x, by + h + 3);
  ctx.fill();
  ctx.fillStyle = style.fg;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, bx + w / 2, by + 6.5);

  if (agent.progress) {
    const pw = w - 10;
    const done = Math.round((agent.progress.done / agent.progress.total) * pw);
    fill(ctx, '#d5dbe3', bx + 5, by + 12, pw, 2);
    fill(ctx, '#2f9e6b', bx + 5, by + 12, done, 2);
  }
}

// ── primitives ──────────────────────────────────────────────────────────────

/** @param {CanvasRenderingContext2D} ctx @param {string} color @param {number} x @param {number} y @param {number} w @param {number} h */
function fill(ctx, color, x, y, w, h) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

/** @param {CanvasRenderingContext2D} ctx @param {number} x @param {number} y @param {number} r @param {string} color */
function glow(ctx, x, y, r, color) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  ctx.restore();
}

/** @param {CanvasRenderingContext2D} ctx @param {number} x @param {number} y @param {number} r */
function pie(ctx, x, y, r) {
  const slices = [[0.45, '#2f8fd8'], [0.3, '#e0a33a'], [0.25, '#c94f4f']];
  let start = -Math.PI / 2;
  for (const [share, color] of slices) {
    const end = start + Number(share) * Math.PI * 2;
    ctx.fillStyle = String(color);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.arc(x, y, r, start, end);
    ctx.fill();
    start = end;
  }
}

/** @param {CanvasRenderingContext2D} ctx @param {number} x @param {number} y @param {number} w @param {number} h @param {number} r */
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}
