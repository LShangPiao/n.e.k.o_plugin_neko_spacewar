// 猫娘星海作战 —— 像素精灵与绘制工具
import { GAME_W } from "./config.js";

const spriteCache = new Map();

export const SCALE = 3;

const SPRITES = {
  ship: {
    palette: { A: "#ffb6ec", P: "#ff7ad9", H: "#f4f7ff", C: "#6ff7ff" },
    rows: [
      ".....A.....",
      "....APA....",
      "....APA....",
      "...PPPPP...",
      "..PPHHHPP..",
      "..PHCHCHP..",
      ".PPHHHHHPP.",
      ".PHHCHCHHP.",
      ".PHHHHHHHP.",
      "..PHHHHHP..",
      "..P.P.P.P..",
      "...P...P...",
      "....P.P....",
    ],
  },
  drone: {
    palette: { A: "#6ff7ff", H: "#ffffff", P: "#ff7ad9" },
    rows: ["..A..", ".AAA.", "AAHAA", ".APA.", "..A.."],
  },
  wanderer: {
    palette: { A: "#ff6b8b", H: "#ffd166" },
    rows: [
      "A.......A",
      ".A.....A.",
      "..AAAAA..",
      ".AAHAHAA.",
      "AAAAAAAAA",
      ".AAAAAAA.",
      "..A...A..",
      ".A.....A.",
      "A.......A",
    ],
  },
  rusher: {
    palette: { A: "#ff9f43", B: "#ff6b8b", H: "#ffe9a8" },
    rows: [
      "....A....",
      "...AAA...",
      "..AABAA..",
      ".AABBBAA.",
      "AABHBBBAA",
      ".AABBBAA.",
      "..AABAA..",
      "...AAA...",
      "....A....",
    ],
  },
  gunner: {
    palette: { A: "#9d7bff", B: "#c9b6ff", H: "#ff7ad9" },
    rows: [
      "..AAAAA..",
      ".AAAAAAA.",
      "AAABBBAAA",
      "AABHHHBAA",
      "AABHHHBAA",
      "AAABBBAAA",
      ".AAAAAAA.",
      "..AAAAA..",
      "....A....",
    ],
  },
  tank: {
    palette: { A: "#5ee6a8", B: "#1b4d3a", H: "#ffd166" },
    rows: [
      "AAAAAAAAAAA",
      "ABBBBBBBBBA",
      "ABBBBBBBBBA",
      "ABBBBHBBBBA",
      "ABBHHHHHBBA",
      "ABBBHHHBBBA",
      "ABBHHHHHBBA",
      "ABBBBHBBBBA",
      "ABBBBBBBBBA",
      "ABBBBBBBBBA",
      "AAAAAAAAAAA",
    ],
  },
  heart: {
    palette: { A: "#ff7ad9", H: "#ffd0f2" },
    rows: [".AA.AA.", "AHHAAHA", "AHAAAAH", ".AAAAA.", "..AAA..", "...A..."],
  },
  bullet: {
    palette: { A: "#c8ffff", H: "#6ff7ff" },
    rows: [".A.", "AHA", "AHA", ".A.", ".A."],
  },
  orb: {
    palette: { A: "#ff6b8b", H: "#ffd166" },
    rows: [".AA.", "AHHA", "AHHA", ".AA."],
  },
};

export function makeSprite(name, scale = SCALE) {
  const key = name + "@" + scale;
  if (spriteCache.has(key)) return spriteCache.get(key);
  const def = SPRITES[name];
  const width = def.rows[0].length * scale;
  const height = def.rows.length * scale;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  def.rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) {
      const color = def.palette[row[x]];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  });
  spriteCache.set(key, canvas);
  return canvas;
}

export function drawSprite(ctx, name, cx, cy, scale = SCALE) {
  const sprite = makeSprite(name, scale);
  ctx.drawImage(sprite, Math.round(cx - sprite.width / 2), Math.round(cy - sprite.height / 2));
}

const GLYPHS = {
  P: ["###", "#.#", "###", "#..", "#.."],
  A: [".#.", "#.#", "###", "#.#", "#.#"],
  B: ["##.", "#.#", "##.", "#.#", "##."],
  H: ["#.#", "#.#", "###", "#.#", "#.#"],
  U: ["#.#", "#.#", "#.#", "#.#", "###"],
};

export function drawGlyph(ctx, letter, x, y, scale, color) {
  const glyph = GLYPHS[letter];
  if (!glyph) return;
  ctx.fillStyle = color;
  glyph.forEach((row, gy) => {
    for (let gx = 0; gx < row.length; gx += 1) {
      if (row[gx] === "#") ctx.fillRect(x + gx * scale, y + gy * scale, scale, scale);
    }
  });
}

export const POWERUP_LETTER = { p: ["P", "#ffd166"], a: ["A", "#ff7ad9"], b: ["B", "#6ff7ff"] };

export function drawPowerup(ctx, kind, cx, cy, scale = 2) {
  const [letter, color] = POWERUP_LETTER[kind] || POWERUP_LETTER.p;
  const size = 11 * scale;
  ctx.save();
  ctx.translate(Math.round(cx - size / 2), Math.round(cy - size / 2));
  ctx.fillStyle = "rgba(8, 10, 28, 0.92)";
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, size - 2, size - 2);
  drawGlyph(ctx, letter, (size - 3 * 3) / 2, (size - 5 * 3) / 2, 3, color);
  ctx.restore();
}

const CAT_FACE = [
  "................",
  "..AA........AA..",
  "..APA......APA..",
  "..APA......APA..",
  "..AAAAAAAAAAAA..",
  ".AAAAAAAAAAAAAA.",
  ".AAHHAAAAAAHHAA.",
  ".AAHHAAAAAAHHAA.",
  ".AAAAAAAAAAAAAA.",
  ".AAAAWWWWWWAAAA.",
  ".AAAWWPWWPWWWAAA",
  ".AAAAWWWWWWAAAA.",
  "..AAAAAAAAAAAA..",
  "...AAAAAAAAAA...",
  "....AA.AA.AA....",
  "................",
];

export function drawCatFace(canvas) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const scale = Math.max(1, Math.floor(canvas.width / 16));
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const palette = { A: "#ffb6ec", P: "#ff7ad9", H: "#7ad0ff", W: "#fff5fb" };
  const offsetX = Math.floor((canvas.width - 16 * scale) / 2);
  const offsetY = Math.floor((canvas.height - 16 * scale) / 2);
  CAT_FACE.forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) {
      const color = palette[row[x]];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(offsetX + x * scale, offsetY + y * scale, scale, scale);
    }
  });
  // 腮红
  ctx.fillStyle = "rgba(255, 122, 217, 0.55)";
  const blushY = offsetY + 9 * scale;
  ctx.fillRect(offsetX + 2 * scale, blushY, 2 * scale, scale);
  ctx.fillRect(offsetX + 12 * scale, blushY, 2 * scale, scale);
}

export function drawHeartIcon(canvas, empty = false) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const sprite = makeSprite("heart", 2);
  ctx.globalAlpha = empty ? 0.35 : 1;
  ctx.drawImage(sprite, 0, 0);
  ctx.globalAlpha = 1;
}

export function drawPlayer(ctx, player, t) {
  const { x, y, invuln, shield } = player;
  ctx.save();
  if (invuln > 0 && Math.floor(t * 18) % 2 === 0) ctx.globalAlpha = 0.55;
  // 引擎尾焰
  const flame = 4 + Math.floor(Math.sin(t * 26) * 2);
  ctx.fillStyle = "rgba(111, 247, 255, 0.9)";
  ctx.fillRect(Math.round(x - 4), Math.round(y + 20), 3, flame);
  ctx.fillStyle = "rgba(255, 122, 217, 0.9)";
  ctx.fillRect(Math.round(x + 1), Math.round(y + 20), 3, flame + 2);
  ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
  ctx.fillRect(Math.round(x - 1), Math.round(y + 19), 2, Math.max(2, flame - 2));
  drawSprite(ctx, "ship", x, y, SCALE);
  ctx.restore();
  if (shield > 0) {
    ctx.save();
    ctx.strokeStyle = "rgba(111, 247, 255, 0.85)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, 34 + Math.sin(t * 8) * 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255, 122, 217, 0.45)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, 40, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

export function drawDrone(ctx, drone, t) {
  drawSprite(ctx, "drone", drone.x, drone.y, 2);
  if (drone.firing > 0) {
    ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
    ctx.fillRect(Math.round(drone.x - 1), Math.round(drone.y + 6), 2, 6);
  }
}

export function drawBoss(ctx, boss, t) {
  const { x, y, w, h, hp, maxHp } = boss;
  const left = Math.round(x - w / 2);
  const top = Math.round(y - h / 2);
  const pulse = 0.5 + Math.sin(t * 4) * 0.5;
  // 阴影底
  ctx.fillStyle = "rgba(4, 5, 14, 0.55)";
  ctx.fillRect(left + 6, top + 8, w, h);
  // 主体
  ctx.fillStyle = "#3b2a6b";
  ctx.fillRect(left, top, w, h);
  ctx.fillStyle = "#5a3f9e";
  ctx.fillRect(left + 4, top + 4, w - 8, h - 8);
  ctx.fillStyle = "#2a1d4d";
  ctx.fillRect(left + 2, top + h * 0.55, w - 4, h * 0.3);
  // 侧翼吊舱
  ctx.fillStyle = "#7a5cd6";
  ctx.fillRect(left - 10, top + h * 0.32, 12, h * 0.4);
  ctx.fillRect(left + w - 2, top + h * 0.32, 12, h * 0.4);
  ctx.fillStyle = "#ff7ad9";
  ctx.fillRect(left - 8, top + h * 0.42, 6, h * 0.18);
  ctx.fillRect(left + w + 2, top + h * 0.42, 6, h * 0.18);
  // 猫脸舰桥
  ctx.fillStyle = "#ffb6ec";
  ctx.fillRect(left + w * 0.42, top + 8, 8, 10);
  ctx.fillRect(left + w * 0.56, top + 8, 8, 10);
  ctx.fillStyle = "#120820";
  ctx.fillRect(left + w * 0.44, top + 12, 4, 4);
  ctx.fillRect(left + w * 0.58, top + 12, 4, 4);
  // 核心
  ctx.fillStyle = "rgba(111, 247, 255, " + (0.55 + pulse * 0.45) + ")";
  ctx.fillRect(left + w / 2 - 6, top + h * 0.52, 12, 12);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(left + w / 2 - 2, top + h * 0.52 + 4, 4, 4);
  // 血条
  const barW = w + 16;
  const barX = left - 8;
  const barY = top - 12;
  ctx.fillStyle = "rgba(6, 8, 20, 0.9)";
  ctx.fillRect(barX - 2, barY - 2, barW + 4, 10);
  ctx.fillStyle = "#ff6b8b";
  ctx.fillRect(barX, barY, barW * Math.max(0, hp / maxHp), 6);
  ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
  ctx.fillRect(barX, barY, barW * Math.max(0, hp / maxHp), 2);
}

export function drawStarfield(ctx, stars) {
  ctx.fillStyle = "#05060f";
  ctx.fillRect(0, 0, GAME_W, GAME_W * 1.5);
  stars.forEach((star) => {
    ctx.fillStyle = star.color;
    ctx.fillRect(Math.round(star.x), Math.round(star.y), star.size, star.size);
  });
}
