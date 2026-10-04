// @ts-check
/**
 * Placeholder pixel characters, drawn from tiny text maps so there are no image files to manage.
 * To use your own art later, replace `drawCharacter` with one that blits frames from a sprite
 * sheet. The renderer only calls `drawCharacter(ctx, look, pose, x, y)` and reads `SPRITE_W/H`.
 *
 * Map legend: h hair · s skin · e eyes · t top · p pants · k shoes · . transparent
 */

export const SPRITE_W = 10;
export const SPRITE_H = 16;

/** @typedef {import('./map.js').Facing} Facing */
/** @typedef {{ hair: string, skin: string, top: string, pants: string, shoes?: string, eyes?: string }} Look */
/**
 * @typedef {object} Pose
 * @property {Facing} facing
 * @property {boolean} walking
 * @property {boolean} seated
 * @property {boolean} typing
 * @property {number} frame  Animation counter; walk cycles use it modulo 4.
 */

const BODY = [
  '..tttttt..',
  '.tttttttt.',
  'stttttttts',
  'stttttttts',
  '.pppppppp.',
  '.pppppppp.',
];

const FRONT = [
  '..hhhhhh..',
  '.hhhhhhhh.',
  '.hhhhhhhh.',
  '.hssssssh.',
  '.sesssses.',
  '.ssssssss.',
  '..ssssss..',
  ...BODY,
  '.ppp..ppp.',
  '.ppp..ppp.',
  '.kkk..kkk.',
];

const BACK = [
  '..hhhhhh..',
  '.hhhhhhhh.',
  '.hhhhhhhh.',
  '.hhhhhhhh.',
  '.hhhhhhhh.',
  '.shhhhhhs.',
  '..ssssss..',
  ...BODY,
  '.ppp..ppp.',
  '.ppp..ppp.',
  '.kkk..kkk.',
];

const SIDE = [
  '..hhhhh...',
  '.hhhhhhh..',
  '.hhhhhhhh.',
  '.hhhsssss.',
  '.hhsssses.',
  '.hhssssss.',
  '..sssss...',
  '..tttttt..',
  '.tttttttt.',
  '.ttttttst.',
  '.ttttttst.',
  '..pppppp..',
  '..pppppp..',
  '..pp..pp..',
  '..pp..pp..',
  '..kk..kkk.',
];

/** Leg rows (last three) for the two stepping frames of each view. */
const STEPS = {
  front: [['.ppp..ppp.', '.kkk..ppp.', '......kkk.'], ['.ppp..ppp.', '.ppp..kkk.', '.kkk......']],
  side: [['.pp....pp.', '.pp....pp.', 'kk.....kkk'], ['..pp..pp..', '..pp..pp..', '..kk..kkk.']],
};

/** Seated: legs tucked under the chair. */
const SEATED_LEGS = { front: ['.pppppppp.', '.kk....kk.', '..........'], side: ['..pppppppp', '.......kk.', '..........'] };

/** Distinct, readable outfits per agent. Unknown agents get one derived from their id. */
export const LOOKS = /** @type {Record<string, Look>} */ ({
  'tech-lead': { hair: '#e7e9f0', skin: '#f1c9a5', top: '#1f2a44', pants: '#11151c', eyes: '#2b6cb0' },
  backend: { hair: '#2b1d14', skin: '#8d5a3b', top: '#2f6f4f', pants: '#1f2933' },
  frontend: { hair: '#1a1a1a', skin: '#c58c5c', top: '#c2410c', pants: '#27303d' },
  fullstack: { hair: '#c47f2c', skin: '#f0c19b', top: '#3b4a5e', pants: '#1c2430' },
  powershell: { hair: '#3b82f6', skin: '#f3cfb0', top: '#0b2a5b', pants: '#151b26' },
  zsh: { hair: '#111827', skin: '#d6a77a', top: '#15803d', pants: '#1f2933' },
  python: { hair: '#3d2b1f', skin: '#b97d55', top: '#ca8a04', pants: '#273043' },
  devops: { hair: '#7c2d12', skin: '#f1c9a5', top: '#0e7490', pants: '#1b2430' },
  qa: { hair: '#f59e0b', skin: '#f6d2b5', top: '#be123c', pants: '#222a36' },
  security: { hair: '#0b0b0b', skin: '#a26b47', top: '#111418', pants: '#0b0d10', eyes: '#0b0b0b' },
  database: { hair: '#9f1239', skin: '#e9b892', top: '#475569', pants: '#1c2430' },
  writer: { hair: '#a3a3a3', skin: '#f0c7a4', top: '#78716c', pants: '#2a2a2a' },
  bash: { hair: '#5b3a1e', skin: '#e9b892', top: '#3f6212', pants: '#1f2933' },
  javascript: { hair: '#2a1b12', skin: '#c58c5c', top: '#d4b106', pants: '#262b33' },
  typescript: { hair: '#e8b04a', skin: '#f6d2b5', top: '#2563eb', pants: '#1c2430' },
  java: { hair: '#3b2416', skin: '#b97d55', top: '#b45309', pants: '#1f2933' },
  csharp: { hair: '#1c1c1c', skin: '#f0c19b', top: '#6d28d9', pants: '#1b1f2a' },
  go: { hair: '#7dd3fc', skin: '#e9b892', top: '#0891b2', pants: '#1f2933' },
  c: { hair: '#4b5563', skin: '#d6a77a', top: '#334155', pants: '#111827' },
  cpp: { hair: '#111111', skin: '#f3cfb0', top: '#1e40af', pants: '#1c2430' },
  rust: { hair: '#9a3412', skin: '#f1c9a5', top: '#c2410c', pants: '#27303d' },
  php: { hair: '#6b4f3a', skin: '#e9b892', top: '#6366f1', pants: '#1f2933' },
  ruby: { hair: '#2b1d14', skin: '#a26b47', top: '#b91c1c', pants: '#1c2430' },
  swift: { hair: '#f97316', skin: '#f6d2b5', top: '#ea580c', pants: '#222a36' },
  kotlin: { hair: '#4c1d95', skin: '#f0c7a4', top: '#7c3aed', pants: '#1b1f2a' },
});

/** @param {string} id @returns {Look} */
export function lookFor(id) {
  if (LOOKS[id]) return LOOKS[id];
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  return { hair: `hsl(${(hue + 180) % 360} 45% 30%)`, skin: '#e9b892', top: `hsl(${hue} 55% 40%)`, pants: '#1f2933' };
}

/**
 * Draw a character with its feet centred on (x, y) in logical pixels.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Look} look
 * @param {Pose} pose
 * @param {number} x
 * @param {number} y
 */
export function drawCharacter(ctx, look, pose, x, y) {
  const view = pose.facing === 'up' ? 'back' : pose.facing === 'down' ? 'front' : 'side';
  const rows = [...(view === 'back' ? BACK : view === 'front' ? FRONT : SIDE)];
  const legKind = view === 'side' ? 'side' : 'front';

  if (pose.seated) {
    rows.splice(13, 3, ...SEATED_LEGS[legKind]);
  } else if (pose.walking) {
    const step = Math.floor(pose.frame) % 4;
    if (step === 1 || step === 3) rows.splice(13, 3, ...STEPS[legKind][step === 1 ? 0 : 1]);
  }
  if (pose.typing && Math.floor(pose.frame) % 2 === 1) {
    // Arms forward: shift the skin pixels of the arm rows inward.
    rows[9] = rows[9].replace(/^s/, '.').replace(/s$/, '.').replace(/^\.t/, '.s').replace(/t\.$/, 's.');
  }

  const colors = /** @type {Record<string, string>} */ ({
    h: look.hair, s: look.skin, e: look.eyes ?? '#1b1f27', t: look.top, p: look.pants, k: look.shoes ?? '#0d0f12',
  });
  const bob = pose.walking && Math.floor(pose.frame) % 2 === 1 ? -1 : 0;
  const left = Math.round(x - SPRITE_W / 2);
  const top = Math.round(y - SPRITE_H + bob + (pose.seated ? -2 : 0));
  const mirror = pose.facing === 'left';

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    for (let c = 0; c < SPRITE_W; c++) {
      const color = colors[row[mirror ? SPRITE_W - 1 - c : c]];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(left + c, top + r, 1, 1);
    }
  }
}
