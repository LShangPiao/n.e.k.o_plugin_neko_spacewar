// 猫娘星海作战 —— 战斗核心（波次、敌机、母舰、战术指令、羁绊、战报采集）
import { GAME_W, GAME_H, DIFFICULTIES, ORDERS, ORDER_MAP, CAT_LINES, WINGMAN_DEFAULT, BALANCE } from "./config.js";
import { drawStarfield, drawPlayer, drawDrone, drawBoss, drawSprite, drawPowerup } from "./pixel.js";

const clamp = (value, low, high) => Math.min(Math.max(value, low), high);
const rand = (low, high) => low + Math.random() * (high - low);
const pickOne = (list) => list[Math.floor(Math.random() * list.length)];
const distance = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

const ENEMY_TYPES = {
  wanderer: { hp: 2, speed: 74, score: 80, radius: 15, sprite: "wanderer", color: "#ff6b8b" },
  rusher: { hp: 2, speed: 190, score: 120, radius: 14, sprite: "rusher", color: "#ff9f43" },
  gunner: { hp: 3, speed: 62, score: 170, radius: 15, sprite: "gunner", color: "#9d7bff" },
  tank: { hp: 11, speed: 40, score: 430, radius: 22, sprite: "tank", color: "#5ee6a8" },
};

const PLAYER_SPEED = 340;
const FIRE_GAP = 0.155;
const DRONE_GAP = BALANCE.droneGap;
const FOCUS_DPS = BALANCE.focusDps;
const ULT_DPS = BALANCE.ultDps;

export class BattleEngine {
  constructor(options = {}) {
    this.canvas = options.canvas;
    this.ctx = this.canvas ? this.canvas.getContext("2d") : null;
    this.audio = options.audio || null;
    this.wingman = options.wingman || WINGMAN_DEFAULT;
    this.onState = options.onState || null;
    this.onEvent = options.onEvent || null;
    this.onLine = options.onLine || null;
    this.onGameOver = options.onGameOver || null;
    this.settings = { autoFire: true, sfx: true, music: true };
    this.keys = Object.create(null);
    this.pointerDown = false;
    this.pointerTarget = null;
    this._lineAt = {};
    this._lineIndex = {};
    this._reset("normal");
    if (this.canvas) this._bindInput();
  }

  // ------------------------------------------------------------------ 生命周期

  _reset(difficultyKey) {
    const diff = DIFFICULTIES[difficultyKey] || DIFFICULTIES.normal;
    this.diff = diff;
    this.difficulty = diff.id;
    this.maxHull = diff.maxHull;
    this.hull = diff.startHull;
    this.score = 0;
    this.wave = 0;
    this.kills = 0;
    this.bossKills = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.comboTimer = 0;
    this.bond = 10;
    this.bondPeak = 10;
    this.ultimatesUsed = 0;
    this.hitsTaken = 0;
    this.elapsed = 0;
    this.activatedOrders = 0;
    this.usedOrders = { shield: 0, focus: 0, repair: 0, ultimate: 0 };
    this.cooldowns = { shield: 0, focus: 0, repair: 0, ultimate: 0 };
    this.cheerCd = 0;
    this.shieldTimer = 0;
    this.focusTimer = 0;
    this.ultTimer = 0;
    this.player = { x: GAME_W / 2, y: GAME_H - 110, invuln: 0, shield: 0, power: 1 };
    this.drones = [
      { x: GAME_W / 2 - 46, y: GAME_H - 76, firing: 0, fireTimer: 0, laser: null },
      { x: GAME_W / 2 + 46, y: GAME_H - 76, firing: 0, fireTimer: 0, laser: null },
    ];
    this.enemies = [];
    this.bullets = [];
    this.ebullets = [];
    this.pickups = [];
    this.particles = [];
    this.boss = null;
    this.spawnLeft = 0;
    this.spawnTimer = 0;
    this.spawnInterval = 0.9;
    this.waveGap = 0;
    this.shieldTimer = 0;
    this.focusTimer = 0;
    this.ultTimer = 0;
    this.fireTimer = 0;
    this.cooldowns = { shield: 0, focus: 0, repair: 0, ultimate: 0 };
    this.cheerCd = 0;
    this.shake = 0;
    this.flash = 0;
    this.visual = 0;
    this._stateTimer = 0;
    this._lowWarnedWave = 0;
    this.stars = this._makeStars();
    this.running = false;
    this.paused = false;
    this.over = false;
    this._active = false;
    this.last = 0;
  }

  setWingman(name) {
    if (name) this.wingman = name;
  }

  setSettings(settings = {}) {
    if (typeof settings.autoFire === "boolean") this.settings.autoFire = settings.autoFire;
    if (typeof settings.music === "boolean") this.settings.music = settings.music;
    if (typeof settings.sfx === "boolean") this.settings.sfx = settings.sfx;
    if (this.audio) this.audio.setSfx(this.settings.sfx);
  }

  start(difficultyKey) {
    this._reset(difficultyKey);
    this.running = true;
    this.paused = false;
    this.over = false;
    this._active = true;
    this.last = 0;
    this._stateTimer = 0;
    if (this.audio) {
      this.audio.unlock();
      this.audio.setSfx(this.settings.sfx);
      if (this.settings.music) this.audio.startMusic();
    }
    this._beginWave(1);
    this._say("start", 0);
    if (this.onEvent) this.onEvent("start", { difficulty: this.difficulty, wave: 1 });
    this._emitState();
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = requestAnimationFrame(this._tick);
  }

  pause() {
    if (!this.running || this.over) return false;
    this.paused = true;
    return true;
  }

  resume() {
    if (!this.running || this.over) return false;
    this.paused = false;
    this.last = 0;
    return true;
  }

  togglePause() {
    if (this.paused) return this.resume();
    return this.pause();
  }

  quit() {
    this._active = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    this.running = false;
    this.paused = false;
    this.over = false;
    if (this.audio) this.audio.stopMusic();
  }

  _tick = (stamp) => {
    if (!this._active) return;
    const now = stamp / 1000;
    if (!this.last) this.last = now;
    let dt = now - this.last;
    this.last = now;
    dt = clamp(dt, 0, 0.05);
    this.visual += dt;
    if (!this.paused && !this.over) this._update(dt);
    this._render();
    if (this.over) {
      this._active = false;
      return;
    }
    this._raf = requestAnimationFrame(this._tick);
  };

  // ------------------------------------------------------------------ 状态

  snapshot() {
    const orderState = ORDERS.map((order) => {
      const cooldown = this.cooldowns[order.id] || 0;
      return {
        id: order.id,
        cost: order.cost,
        cooldown,
        ready: this.running && !this.over && cooldown <= 0.05 && this.bond >= order.cost,
      };
    });
    return {
      running: this.running && !this.over,
      paused: this.paused,
      over: this.over,
      difficulty: this.difficulty,
      wave: this.wave,
      score: Math.round(this.score),
      kills: this.kills,
      boss_kills: this.bossKills,
      combo: this.combo,
      max_combo: this.maxCombo,
      hull_integrity: this.hull,
      max_hull: this.maxHull,
      bond: Math.round(this.bond),
      bond_peak: Math.round(this.bondPeak),
      ultimates_used: this.ultimatesUsed,
      hits_taken: this.hitsTaken,
      elapsed: Math.round(this.elapsed),
      boss_active: Boolean(this.boss),
      boss_hp: this.boss ? Math.max(0, Math.round(this.boss.hp)) : 0,
      boss_max_hp: this.boss ? Math.round(this.boss.maxHp) : 0,
      enemies: this.enemies.length,
      enemies_left: Math.max(0, this.spawnLeft),
      cheer_cd: Math.max(0, Math.ceil(this.cheerCd || 0)),
      activated_orders: this.activatedOrders,
      used_orders: Object.assign({}, this.usedOrders),
      power: this.player.power,
      shield: this.shieldTimer,
      focus: this.focusTimer,
      ultimate: this.ultTimer,
      order_state: orderState,
      client_ts: Math.floor(Date.now() / 1000),
    };
  }

  report() {
    return {
      score: Math.round(this.score),
      wave: Math.max(1, this.wave),
      kills: this.kills,
      boss_kills: this.bossKills,
      max_combo: this.maxCombo,
      duration_seconds: Math.round(this.elapsed),
      hits_taken: this.hitsTaken,
      ultimates_used: this.ultimatesUsed,
      bond_peak: Math.round(this.bondPeak),
      difficulty: this.difficulty,
      used_orders: Object.assign({}, this.usedOrders),
    };
  }

  _emitState() {
    if (this.onState) this.onState(this.snapshot());
  }

  // ------------------------------------------------------------------ 玩家输入

  _bindInput() {
    const canvas = this.canvas;
    const toGame = (event) => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return { x: GAME_W / 2, y: GAME_H / 2 };
      return {
        x: ((event.clientX - rect.left) / rect.width) * GAME_W,
        y: ((event.clientY - rect.top) / rect.height) * GAME_H,
      };
    };
    const moveTarget = (point) => {
      this.pointerTarget = {
        x: clamp(point.x, 26, GAME_W - 26),
        y: clamp(point.y - 34, 80, GAME_H - 40),
      };
    };
    this._onPointerDown = (event) => {
      if (!this.running || this.paused || this.over) return;
      this.pointerDown = true;
      moveTarget(toGame(event));
      if (canvas.setPointerCapture) {
        try {
          canvas.setPointerCapture(event.pointerId);
        } catch (err) {
          /* 忽略不支持指针捕获的环境 */
        }
      }
    };
    this._onPointerMove = (event) => {
      if (!this.pointerDown) return;
      moveTarget(toGame(event));
    };
    this._onPointerUp = () => {
      this.pointerDown = false;
    };
    this._onKeyDown = (event) => {
      const code = event.code;
      if (code === "Space" || code.startsWith("Arrow")) event.preventDefault();
      this.keys[code] = true;
      if (code === "KeyP" || code === "Escape") {
        if (this.onPauseKey) this.onPauseKey(code);
        return;
      }
      const digit = code.replace("Digit", "").replace("Numpad", "");
      if (["1", "2", "3", "4"].indexOf(digit) >= 0 && this.onOrderKey) {
        this.onOrderKey(ORDERS[Number(digit) - 1].id);
      }
    };
    this._onKeyUp = (event) => {
      this.keys[event.code] = false;
    };
    canvas.addEventListener("pointerdown", this._onPointerDown);
    canvas.addEventListener("pointermove", this._onPointerMove);
    window.addEventListener("pointerup", this._onPointerUp);
    window.addEventListener("pointercancel", this._onPointerUp);
    window.addEventListener("keydown", this._onKeyDown);
    window.addEventListener("keyup", this._onKeyUp);
  }

  destroy() {
    this.quit();
    const canvas = this.canvas;
    if (canvas && this._onPointerDown) {
      canvas.removeEventListener("pointerdown", this._onPointerDown);
      canvas.removeEventListener("pointermove", this._onPointerMove);
    }
    if (this._onPointerUp) {
      window.removeEventListener("pointerup", this._onPointerUp);
      window.removeEventListener("pointercancel", this._onPointerUp);
    }
    if (this._onKeyDown) window.removeEventListener("keydown", this._onKeyDown);
    if (this._onKeyUp) window.removeEventListener("keyup", this._onKeyUp);
  }

  // ------------------------------------------------------------------ 战术指令

  command(orderId) {
    const def = ORDER_MAP[orderId];
    if (!def) return { ok: false, reason: "unknown", message: "没有这个战术指令。" };
    if (!this.running || this.over) {
      return { ok: false, reason: "not_running", message: "现在不在战斗中，指令先记着。" };
    }
    if (this.paused) return { ok: false, reason: "paused", message: "先继续战斗再下指令。" };
    const cooldown = this.cooldowns[orderId] || 0;
    if (cooldown > 0.05) {
      return { ok: false, reason: "cooldown", remaining: cooldown, message: def.label + "还在冷却（" + Math.ceil(cooldown) + " 秒）。" };
    }
    if (this.bond < def.cost) {
      return { ok: false, reason: "bond", need: def.cost - Math.floor(this.bond), message: "羁绊不够（还差 " + Math.ceil(def.cost - this.bond) + " 点）。" };
    }
    if (orderId === "repair" && this.hull >= this.maxHull) {
      return { ok: false, reason: "hull_full", message: "装甲完好，维修先留着。" };
    }
    this.bond -= def.cost;
    this.cooldowns[orderId] = def.cooldown;
    this.activatedOrders += 1;
    this.usedOrders[orderId] = (this.usedOrders[orderId] || 0) + 1;
    if (orderId === "shield") {
      this.shieldTimer = BALANCE.shieldDuration;
      this.ebullets = this.ebullets.filter(
        (bullet) => distance(bullet.x, bullet.y, this.player.x, this.player.y) > BALANCE.shieldClearRadius
      );
      this._say("orderShield", 1.5);
    } else if (orderId === "focus") {
      this.focusTimer = BALANCE.focusDuration;
      this._say("orderFocus", 1.5);
    } else if (orderId === "repair") {
      const healed = this.hull < this.maxHull;
      this.hull = Math.min(this.maxHull, this.hull + 1);
      this._spawnExplosion(this.player.x, this.player.y, 12, "#6ff7ff");
      if (healed) this._say("orderRepair", 1.5);
    } else if (orderId === "ultimate") {
      this.ultTimer = BALANCE.ultDuration;
      this.ultimatesUsed += 1;
      this.flash = 0.6;
      this.shake = 1;
      this._say("orderUltimate", 1.5);
    }
    if (this.audio) this.audio.order();
    if (this.onEvent) this.onEvent("order", { order: orderId, label: def.label });
    this._emitState();
    return { ok: true, order: orderId, message: def.full || def.label };
  }

  cheer() {
    if ((this.cheerCd || 0) > 0.05) {
      return {
        ok: false,
        reason: "cooldown",
        remaining: Math.ceil(this.cheerCd),
        message: "刚打过气了，等 " + Math.ceil(this.cheerCd) + " 秒再来。",
      };
    }
    this.cheerCd = BALANCE.cheerCooldown;
    this.bond = Math.min(100, this.bond + BALANCE.cheerBond);
    this.bondPeak = Math.max(this.bondPeak, this.bond);
    this._say("cheer", 4);
    if (this.audio) this.audio.cheer();
    if (this.onEvent) this.onEvent("cheer", { bond: Math.round(this.bond) });
    this._emitState();
    return { ok: true, bond: Math.round(this.bond), cooldown: BALANCE.cheerCooldown };
  }

  // ------------------------------------------------------------------ 更新

  _update(dt) {
    this.elapsed += dt;
    this.visual += 0;
    Object.keys(this.cooldowns).forEach((key) => {
      this.cooldowns[key] = Math.max(0, (this.cooldowns[key] || 0) - dt);
    });
    this.player.invuln = Math.max(0, this.player.invuln - dt);
    this.shieldTimer = Math.max(0, this.shieldTimer - dt);
    this.focusTimer = Math.max(0, this.focusTimer - dt);
    this.ultTimer = Math.max(0, this.ultTimer - dt);
    this.cheerCd = Math.max(0, (this.cheerCd || 0) - dt);
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.combo = 0;
    }
    this.shake = Math.max(0, this.shake - dt * 3);
    this.flash = Math.max(0, this.flash - dt * 2);
    this._updateStars(dt);
    this._updatePlayer(dt);
    this._updateFiring(dt);
    this._updateDrones(dt);
    this._updateWave(dt);
    this._updateEnemies(dt);
    this._updateBoss(dt);
    this._updateBullets(dt);
    this._updateEnemyBullets(dt);
    this._updatePickups(dt);
    this._updateParticles(dt);
    this._checkBodyCollisions();
    if (this.ultTimer > 0) this.ebullets.length = 0;
    this._stateTimer -= dt;
    if (this._stateTimer <= 0) {
      this._stateTimer = 0.25;
      this._emitState();
    }
    if (this.hull <= 0 && !this.over) this._gameOver();
  }

  _makeStars() {
    const colors = ["#ffffff", "#ffd7f4", "#c9f7ff", "#ffe9a8", "#8f9bff"];
    const stars = [];
    for (let i = 0; i < 90; i += 1) {
      stars.push({
        x: rand(0, GAME_W),
        y: rand(0, GAME_H),
        z: rand(0.2, 1),
        size: Math.random() > 0.86 ? 3 : 2,
        color: colors[Math.floor(Math.random() * colors.length)],
      });
    }
    return stars;
  }

  _updateStars(dt) {
    const speed = 26 + this.wave * 3;
    this.stars.forEach((star) => {
      star.y += speed * star.z * dt;
      if (star.y > GAME_H + 4) {
        star.y = -4;
        star.x = rand(0, GAME_W);
      }
    });
  }

  _updatePlayer(dt) {
    const player = this.player;
    let vx = 0;
    let vy = 0;
    if (this.keys.ArrowLeft || this.keys.KeyA) vx -= 1;
    if (this.keys.ArrowRight || this.keys.KeyD) vx += 1;
    if (this.keys.ArrowUp || this.keys.KeyW) vy -= 1;
    if (this.keys.ArrowDown || this.keys.KeyS) vy += 1;
    if (vx || vy) {
      const length = Math.hypot(vx, vy) || 1;
      player.x += (vx / length) * PLAYER_SPEED * dt;
      player.y += (vy / length) * PLAYER_SPEED * dt;
    } else if (this.pointerDown && this.pointerTarget) {
      const k = 1 - Math.exp(-18 * dt);
      player.x += (this.pointerTarget.x - player.x) * k;
      player.y += (this.pointerTarget.y - player.y) * k;
    }
    player.x = clamp(player.x, 24, GAME_W - 24);
    player.y = clamp(player.y, 96, GAME_H - 34);
    if (this.hull <= 1 && this.wave !== this._lowWarnedWave) {
      this._lowWarnedWave = this.wave;
      this._say("lowHull", 12);
      if (this.onEvent) this.onEvent("hull_low", { wave: this.wave, hull: this.hull });
    }
  }

  _updateFiring(dt) {
    this.fireTimer -= dt;
    const wantFire = this.settings.autoFire || this.keys.Space || this.pointerDown;
    if (wantFire && this.fireTimer <= 0) {
      this._playerFire();
      this.fireTimer = FIRE_GAP;
    }
  }

  _playerFire() {
    const player = this.player;
    const power = player.power;
    if (power <= 1) {
      this.bullets.push({ x: player.x, y: player.y - 24, vx: 0, vy: -660, dmg: 1, r: 4 });
    } else if (power === 2) {
      this.bullets.push({ x: player.x - 8, y: player.y - 22, vx: 0, vy: -680, dmg: 1, r: 4 });
      this.bullets.push({ x: player.x + 8, y: player.y - 22, vx: 0, vy: -680, dmg: 1, r: 4 });
    } else {
      this.bullets.push({ x: player.x, y: player.y - 26, vx: 0, vy: -720, dmg: 2, r: 5 });
      this.bullets.push({ x: player.x - 10, y: player.y - 18, vx: -120, vy: -670, dmg: 1, r: 4 });
      this.bullets.push({ x: player.x + 10, y: player.y - 18, vx: 120, vy: -670, dmg: 1, r: 4 });
    }
    if (this.audio) this.audio.shoot();
  }

  _updateDrones(dt) {
    const player = this.player;
    const offsets = [
      [-46, 36],
      [46, 36],
    ];
    this.drones.forEach((drone, index) => {
      const targetX = player.x + offsets[index][0];
      const targetY = player.y + offsets[index][1];
      const k = 1 - Math.exp(-7 * dt);
      drone.x += (targetX - drone.x) * k;
      drone.y += (targetY - drone.y) * k;
      if (this.focusTimer > 0) {
        drone.firing = 1;
        const target = this._focusTarget();
        if (target) {
          drone.laser = { x: target.x, y: target.y };
          target.hp -= FOCUS_DPS * dt;
          target.flash = 0.1;
          this._spawnSpark(target.x + rand(-8, 8), target.y + rand(-8, 8), "#6ff7ff", 1);
          if (target.hp <= 0) this._killDecayed();
        } else {
          drone.laser = null;
        }
      } else {
        drone.firing = 0;
        drone.laser = null;
        drone.fireTimer -= dt;
        if (drone.fireTimer <= 0) {
          drone.fireTimer = DRONE_GAP;
          if (this.enemies.length || this.boss) {
            this.bullets.push({ x: drone.x, y: drone.y - 8, vx: 0, vy: -620, dmg: 1, r: 3 });
          }
        }
      }
    });
  }

  _focusTarget() {
    if (this.boss && !this.boss.entering) return this.boss;
    if (!this.enemies.length) return null;
    const player = this.player;
    let best = null;
    let bestScore = -Infinity;
    this.enemies.forEach((enemy) => {
      const score = -enemy.hp * 20 - distance(enemy.x, enemy.y, player.x, player.y) * 0.2 + enemy.y * 0.1;
      if (score > bestScore) {
        bestScore = score;
        best = enemy;
      }
    });
    return best;
  }

  // ------------------------------------------------------- 难度随波数递增
  // 三个尺度同源：血量线性涨、弹幕越来越密、弹速越来越快（都有上限，避免到后期无解）
  _waveHpScale() {
    return 1 + (Math.max(1, this.wave) - 1) * BALANCE.waveHpGrowth;
  }

  _waveFireScale() {
    return Math.min(BALANCE.waveFireCap, 1 + (Math.max(1, this.wave) - 1) * BALANCE.waveFireGrowth);
  }

  _waveBulletScale() {
    return Math.min(BALANCE.waveBulletCap, 1 + (Math.max(1, this.wave) - 1) * BALANCE.waveBulletGrowth);
  }

  _updateWave(dt) {
    if (this.waveGap > 0) {
      this.waveGap -= dt;
      if (this.waveGap <= 0) this._beginWave(this.wave + 1);
      return;
    }
    if (this.spawnLeft > 0) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this._spawnEnemy();
        this.spawnLeft -= 1;
        this.spawnTimer = this.spawnInterval;
      }
      return;
    }
    if (!this.boss && !this.enemies.length) this._waveCleared();
  }

  _beginWave(wave) {
    this.wave = wave;
    this._emitState();
    if (wave % 5 === 0) {
      this.spawnLeft = 0;
      this._spawnBoss();
      return;
    }
    this.spawnLeft = Math.min(
      BALANCE.waveCountBase + Math.floor(wave * BALANCE.waveCountPerWave),
      BALANCE.waveCountCap
    );
    this.spawnInterval = Math.max(BALANCE.spawnGapFloor, 0.95 - wave * 0.045) * (this.diff.spawnGap / 0.62);
    this.spawnTimer = 0.4;
    if (this.onEvent) this.onEvent("wave", { wave: wave });
  }

  _waveCleared() {
    this.bond = Math.min(100, this.bond + BALANCE.bondPerWaveClear);
    this.bondPeak = Math.max(this.bondPeak, this.bond);
    this.score += 120 + this.wave * 60;
    this.waveGap = 1.5;
    this._say("wave", 8);
    if (this.onEvent) this.onEvent("wave_clear", { wave: this.wave, bond: Math.round(this.bond) });
    this._emitState();
  }

  _spawnEnemy() {
    const wave = this.wave;
    const roll = Math.random();
    let type = "wanderer";
    if (wave >= 2 && roll > 0.6) type = "rusher";
    if (wave >= 3 && roll > 0.84) type = "gunner";
    if (wave >= 4 && roll > 0.95) type = "tank";
    const def = ENEMY_TYPES[type];
    const hpScale = this._waveHpScale() * this.diff.enemyHp;
    const hp = Math.max(1, Math.round(def.hp * hpScale));
    this.enemies.push({
      type: type,
      sprite: def.sprite,
      color: def.color,
      radius: def.radius,
      x: rand(44, GAME_W - 44),
      baseX: 0,
      y: -34,
      t: 0,
      phase: rand(0, Math.PI * 2),
      hp: hp,
      maxHp: hp,
      speed: def.speed * this.diff.enemySpeed * Math.min(1.35, this._waveFireScale()),
      score: def.score,
      fireTimer: rand(1.2, 2.4) / this._waveFireScale(),
      targetY: type === "gunner" ? rand(90, 230) : rand(110, 260),
      flash: 0,
    });
    const enemy = this.enemies[this.enemies.length - 1];
    enemy.baseX = enemy.x;
  }

  _spawnBoss() {
    const wave = this.wave;
    const hp = Math.round((80 + wave * 34) * this.diff.enemyHp);
    this.boss = {
      x: GAME_W / 2,
      y: -120,
      w: 190,
      h: 108,
      hp: hp,
      maxHp: hp,
      t: 0,
      entering: true,
      fireTimer: 1.6 / this._waveFireScale(),
      ringTimer: 3.2 / this._waveFireScale(),
      summonTimer: Math.max(4.5, 6 - wave * 0.06),
      flash: 0,
    };
    this._say("boss", 0);
    if (this.audio) this.audio.bossAlarm();
    if (this.onEvent) this.onEvent("boss_spawn", { wave: wave });
    this._emitState();
  }

  _killBoss() {
    const boss = this.boss;
    if (!boss) return;
    this.boss = null;
    this.bossKills += 1;
    this.bond = Math.min(100, this.bond + BALANCE.bondPerBoss);
    this.bondPeak = Math.max(this.bondPeak, this.bond);
    this._addScore(2000 + this.wave * 220);
    this._spawnExplosion(boss.x, boss.y, 46, "#ffd166");
    this._spawnExplosion(boss.x, boss.y, 26, "#ff7ad9");
    this._dropPickup(boss.x, boss.y, "p");
    this._dropPickup(boss.x - 34, boss.y + 10, Math.random() > 0.5 ? "a" : "b");
    this._dropPickup(boss.x + 34, boss.y + 10, Math.random() > 0.5 ? "b" : "a");
    this.flash = 0.8;
    this.shake = 1;
    this.spawnLeft = 0;
    if (this.audio) this.audio.explode(true);
    this._say("bossDown", 0);
    if (this.onEvent) this.onEvent("boss_down", { wave: this.wave });
    this._emitState();
  }

  _killDecayed() {
    // 僚机激光造成的击杀：附近敌人/母舰 hp 归零
    if (this.boss && this.boss.hp <= 0) {
      this._killBoss();
      return;
    }
    for (let i = this.enemies.length - 1; i >= 0; i -= 1) {
      if (this.enemies[i].hp <= 0) this._killEnemy(i);
    }
  }

  _killEnemy(index) {
    const enemy = this.enemies[index];
    if (!enemy) return;
    this.enemies.splice(index, 1);
    this.kills += 1;
    this.combo += 1;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.comboTimer = 2.5;
    this.bond = Math.min(100, this.bond + BALANCE.bondPerKill);
    this.bondPeak = Math.max(this.bondPeak, this.bond);
    this._addScore(enemy.score);
    this._spawnExplosion(enemy.x, enemy.y, 14, enemy.color);
    if (this.audio) this.audio.explode(false);
    if (this.combo === 20 || this.combo === 50) {
      this._say("combo", 10);
      if (this.onEvent) this.onEvent("combo", { combo: this.combo, wave: this.wave });
    }
    if (this.combo % 7 === 0) this._say("kill", 9);
    const chance =
      enemy.type === "tank" ? BALANCE.dropTank : enemy.type === "gunner" ? BALANCE.dropGunner : BALANCE.dropOther;
    if (Math.random() < chance) {
      const roll = Math.random();
      const kind = roll < 0.4 ? "p" : roll < 0.7 ? "b" : "a";
      this._dropPickup(enemy.x, enemy.y, kind);
    }
  }

  _addScore(base) {
    const multiplier = 1 + Math.min(this.combo, 100) * 0.02;
    this.score += base * multiplier * this.diff.scoreScale;
  }

  _dropPickup(x, y, kind) {
    this.pickups.push({ x: x, y: y, kind: kind, t: rand(0, 6), vy: 72 });
  }

  _updateEnemies(dt) {
    const player = this.player;
    for (let i = this.enemies.length - 1; i >= 0; i -= 1) {
      const enemy = this.enemies[i];
      enemy.t += dt;
      enemy.flash = Math.max(0, enemy.flash - dt);
      if (this.ultTimer > 0) {
        enemy.hp -= ULT_DPS * dt;
        if (enemy.hp <= 0) {
          this._killEnemy(i);
          continue;
        }
      }
      if (enemy.type === "wanderer") {
        enemy.y += enemy.speed * dt;
        enemy.x = enemy.baseX + Math.sin(enemy.t * 1.4 + enemy.phase) * 46;
      } else if (enemy.type === "rusher") {
        enemy.y += enemy.speed * dt;
        enemy.x += clamp(player.x - enemy.x, -110, 110) * dt * 1.5;
      } else if (enemy.type === "gunner") {
        if (enemy.y < enemy.targetY) {
          enemy.y += enemy.speed * dt;
        } else {
          enemy.x += Math.sin(enemy.t * 0.9 + enemy.phase) * 26 * dt;
          enemy.fireTimer -= dt;
          if (enemy.fireTimer <= 0) {
            enemy.fireTimer = 2.4 / (this.diff.enemyFire * this._waveFireScale());
            this._enemyAimShot(enemy, this.wave >= 12 ? 2 : 1, 190);
          }
        }
      } else if (enemy.type === "tank") {
        if (enemy.y < enemy.targetY) {
          enemy.y += enemy.speed * dt;
        } else {
          enemy.x += Math.sin(enemy.t * 0.5 + enemy.phase) * 20 * dt;
          enemy.fireTimer -= dt;
          if (enemy.fireTimer <= 0) {
            enemy.fireTimer = 3.1 / (this.diff.enemyFire * this._waveFireScale());
            this._enemyRing(enemy, Math.min(14, 8 + Math.floor(this.wave / 8)), 150);
          }
        }
      }
      if (enemy.y > GAME_H + 60) this.enemies.splice(i, 1);
    }
  }

  _updateBoss(dt) {
    const boss = this.boss;
    if (!boss) return;
    boss.t += dt;
    boss.flash = Math.max(0, boss.flash - dt);
    if (boss.entering) {
      boss.y += 78 * dt;
      if (boss.y >= 160) {
        boss.y = 160;
        boss.entering = false;
      }
      return;
    }
    boss.x = GAME_W / 2 + Math.sin(boss.t * 0.62) * (GAME_W * 0.29);
    boss.fireTimer -= dt;
    if (boss.fireTimer <= 0) {
      boss.fireTimer = Math.max(1.1, 1.9 - this.wave * 0.03) / (this.diff.enemyFire * this._waveFireScale());
      this._enemyAimShot(boss, this.wave >= 15 ? 4 : 3, 210);
    }
    boss.ringTimer -= dt;
    if (boss.ringTimer <= 0) {
      boss.ringTimer = Math.max(1.9, 3.4 - this.wave * 0.02) / this._waveFireScale();
      this._enemyRing(boss, Math.min(22, 14 + Math.floor(this.wave / 6)), 165);
    }
    boss.summonTimer -= dt;
    if (boss.summonTimer <= 0 && this.enemies.length < Math.min(12, 6 + Math.floor(this.wave / 8))) {
      boss.summonTimer = Math.max(4.5, 8 - this.wave * 0.06);
      this._spawnMinionAt(boss.x - 70, boss.y + 20);
      this._spawnMinionAt(boss.x + 70, boss.y + 20);
    }
    if (this.ultTimer > 0) {
      boss.hp -= BALANCE.ultBossDps * dt;
      if (boss.hp <= 0) this._killBoss();
    }
  }

  _spawnMinionAt(x, y) {
    this.enemies.push({
      type: "wanderer",
      sprite: "wanderer",
      color: "#ff6b8b",
      radius: 15,
      x: clamp(x, 30, GAME_W - 30),
      baseX: clamp(x, 30, GAME_W - 30),
      y: y,
      t: 0,
      phase: rand(0, Math.PI * 2),
      hp: 2,
      maxHp: 2,
      speed: 88 * this.diff.enemySpeed,
      score: 80,
      fireTimer: 2,
      targetY: 200,
      flash: 0,
    });
  }

  _enemyAimShot(source, count, speed) {
    const player = this.player;
    const base = Math.atan2(player.y - source.y, player.x - source.x);
    const bulletSpeed = speed * this.diff.enemyFire * this._waveBulletScale();
    for (let i = 0; i < count; i += 1) {
      const angle = base + (i - (count - 1) / 2) * 0.18;
      this.ebullets.push({
        x: source.x,
        y: source.y + 20,
        vx: Math.cos(angle) * bulletSpeed,
        vy: Math.sin(angle) * bulletSpeed,
        r: 4,
      });
    }
    if (this.audio) this.audio.enemyShoot();
  }

  _enemyRing(source, count, speed) {
    const offset = rand(0, Math.PI * 2);
    const bulletSpeed = speed * this.diff.enemyFire * this._waveBulletScale();
    for (let i = 0; i < count; i += 1) {
      const angle = offset + (i / count) * Math.PI * 2;
      this.ebullets.push({
        x: source.x,
        y: source.y,
        vx: Math.cos(angle) * bulletSpeed,
        vy: Math.sin(angle) * bulletSpeed,
        r: 4,
      });
    }
    if (this.audio) this.audio.enemyShoot();
  }

  _updateBullets(dt) {
    for (let i = this.bullets.length - 1; i >= 0; i -= 1) {
      const bullet = this.bullets[i];
      bullet.x += bullet.vx * dt;
      bullet.y += bullet.vy * dt;
      if (bullet.y < -24 || bullet.x < -24 || bullet.x > GAME_W + 24) {
        this.bullets.splice(i, 1);
        continue;
      }
      let hit = false;
      for (let j = this.enemies.length - 1; j >= 0; j -= 1) {
        const enemy = this.enemies[j];
        if (Math.abs(bullet.x - enemy.x) < enemy.radius && Math.abs(bullet.y - enemy.y) < enemy.radius) {
          enemy.hp -= bullet.dmg;
          enemy.flash = 0.1;
          hit = true;
          this._spawnSpark(bullet.x, bullet.y, "#c9f7ff", 2);
          if (enemy.hp <= 0) this._killEnemy(j);
          break;
        }
      }
      if (!hit && this.boss && !this.boss.entering) {
        const boss = this.boss;
        if (Math.abs(bullet.x - boss.x) < boss.w / 2 && Math.abs(bullet.y - boss.y) < boss.h / 2) {
          boss.hp -= bullet.dmg;
          boss.flash = 0.1;
          hit = true;
          this._spawnSpark(bullet.x, bullet.y, "#ffd166", 2);
          if (boss.hp <= 0) this._killBoss();
        }
      }
      if (hit) this.bullets.splice(i, 1);
    }
  }

  _updateEnemyBullets(dt) {
    const player = this.player;
    for (let i = this.ebullets.length - 1; i >= 0; i -= 1) {
      const bullet = this.ebullets[i];
      bullet.x += bullet.vx * dt;
      bullet.y += bullet.vy * dt;
      if (bullet.y > GAME_H + 30 || bullet.y < -40 || bullet.x < -40 || bullet.x > GAME_W + 40) {
        this.ebullets.splice(i, 1);
        continue;
      }
      if (this.shieldTimer > 0 && distance(bullet.x, bullet.y, player.x, player.y) < BALANCE.shieldClearRadius) {
        this.ebullets.splice(i, 1);
        continue;
      }
      if (distance(bullet.x, bullet.y, player.x, player.y) < 13 + bullet.r) {
        this.ebullets.splice(i, 1);
        this._damagePlayer();
      }
    }
  }

  _updatePickups(dt) {
    const player = this.player;
    for (let i = this.pickups.length - 1; i >= 0; i -= 1) {
      const item = this.pickups[i];
      item.t += dt;
      item.y += item.vy * dt;
      item.x += Math.sin(item.t * 3) * 22 * dt;
      if (item.y > GAME_H + 24) {
        this.pickups.splice(i, 1);
        continue;
      }
      if (distance(item.x, item.y, player.x, player.y) < 28) {
        this._collectPickup(item.kind);
        this.pickups.splice(i, 1);
      }
    }
  }

  _collectPickup(kind) {
    if (kind === "p") {
      if (this.player.power < 3) this.player.power += 1;
      else this._addScore(300);
      this._spawnSpark(this.player.x, this.player.y, "#ffd166", 8);
    } else if (kind === "a") {
      if (this.hull < this.maxHull) this.hull += 1;
      else this._addScore(300);
      this._spawnSpark(this.player.x, this.player.y, "#ff7ad9", 8);
    } else {
      this.bond = Math.min(100, this.bond + BALANCE.bondPerPickup);
      this.bondPeak = Math.max(this.bondPeak, this.bond);
      this._spawnSpark(this.player.x, this.player.y, "#6ff7ff", 8);
    }
    if (this.audio) this.audio.pickup();
    this._emitState();
  }

  _checkBodyCollisions() {
    const player = this.player;
    if (this.player.invuln > 0 || this.shieldTimer > 0) return;
    for (let i = this.enemies.length - 1; i >= 0; i -= 1) {
      const enemy = this.enemies[i];
      if (distance(enemy.x, enemy.y, player.x, player.y) < enemy.radius + 12) {
        this.enemies.splice(i, 1);
        this._spawnExplosion(enemy.x, enemy.y, 12, enemy.color);
        this._damagePlayer();
        return;
      }
    }
    if (this.boss) {
      const boss = this.boss;
      if (Math.abs(player.x - boss.x) < boss.w / 2 + 8 && Math.abs(player.y - boss.y) < boss.h / 2 + 8) {
        this._damagePlayer();
      }
    }
  }

  _damagePlayer() {
    if (this.player.invuln > 0 || this.shieldTimer > 0 || this.over) return;
    this.hull -= 1;
    this.hitsTaken += 1;
    this.combo = 0;
    this.comboTimer = 0;
    this.bond = Math.max(0, this.bond - 12);
    this.player.invuln = 1.6;
    this.shake = 1;
    this.flash = 0.35;
    if (this.audio) this.audio.hit();
    this._spawnExplosion(this.player.x, this.player.y + 8, 12, "#ff7ad9");
    this._say("hit", 9);
    if (this.hull <= 0) {
      this.hull = 0;
      this._gameOver();
    }
    this._emitState();
  }

  _gameOver() {
    if (this.over) return;
    this.over = true;
    this.running = false;
    this.paused = false;
    this.player.invuln = 0;
    this._spawnExplosion(this.player.x, this.player.y, 30, "#ff7ad9");
    this.flash = 0.9;
    this.shake = 1;
    if (this.audio) {
      this.audio.explode(true);
      this.audio.over();
      this.audio.stopMusic();
    }
    this._say("gameOver", 0);
    if (this.onEvent) {
      this.onEvent("over", { wave: this.wave, score: Math.round(this.score), kills: this.kills });
    }
    this._emitState();
    if (this.onGameOver) this.onGameOver(this.report(), this.snapshot());
  }

  // ------------------------------------------------------------------ 粒子

  _spawnExplosion(x, y, count, color) {
    for (let i = 0; i < count; i += 1) {
      const angle = rand(0, Math.PI * 2);
      const speed = rand(40, 240);
      this.particles.push({
        x: x,
        y: y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: rand(0.25, 0.75),
        max: 0.75,
        color: color,
        size: rand(2, 5),
      });
    }
  }

  _spawnSpark(x, y, color, count) {
    for (let i = 0; i < count; i += 1) {
      this.particles.push({
        x: x,
        y: y,
        vx: rand(-90, 90),
        vy: rand(-120, 40),
        life: rand(0.12, 0.3),
        max: 0.3,
        color: color,
        size: 2,
      });
    }
  }

  _updateParticles(dt) {
    for (let i = this.particles.length - 1; i >= 0; i -= 1) {
      const particle = this.particles[i];
      particle.life -= dt;
      if (particle.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vx *= 0.97;
      particle.vy *= 0.97;
    }
  }

  // ------------------------------------------------------------------ 本地台词（保底，不联网也能应声）

  _say(key, gap = 6) {
    const lines = CAT_LINES[key];
    if (!lines || !lines.length) return;
    const stamp = performance.now() / 1000;
    const last = this._lineAt[key] || 0;
    if (stamp - last < gap) return;
    this._lineAt[key] = stamp;
    let index = this._lineIndex[key] || 0;
    index = index % lines.length;
    this._lineIndex[key] = index + 1;
    if (this.onLine) this.onLine(lines[index], key);
  }

  // ------------------------------------------------------------------ 渲染

  _render() {
    const ctx = this.ctx;
    if (!ctx) return;
    const shake = this.shake > 0 ? this.shake * 5 : 0;
    ctx.save();
    if (shake) ctx.translate(rand(-shake, shake), rand(-shake, shake));
    drawStarfield(ctx, this.stars);
    this.pickups.forEach((item) => drawPowerup(ctx, item.kind, item.x, item.y, 2));
    this.enemies.forEach((enemy) => {
      if (enemy.flash > 0) {
        ctx.save();
        ctx.globalAlpha = 0.6;
        drawSprite(ctx, enemy.sprite, enemy.x, enemy.y, 3);
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(Math.round(enemy.x - 14), Math.round(enemy.y - 14), 28, 28);
        ctx.restore();
      } else {
        drawSprite(ctx, enemy.sprite, enemy.x, enemy.y, 3);
      }
    });
    if (this.boss) drawBoss(ctx, this.boss, this.visual);
    this.bullets.forEach((bullet) => {
      ctx.fillStyle = "#c9f7ff";
      ctx.fillRect(Math.round(bullet.x - 1.5), Math.round(bullet.y - 7), 3, 10);
      ctx.fillStyle = "#6ff7ff";
      ctx.fillRect(Math.round(bullet.x - 1), Math.round(bullet.y - 4), 2, 8);
    });
    this.ebullets.forEach((bullet) => {
      drawSprite(ctx, "orb", bullet.x, bullet.y, 2);
    });
    this.drones.forEach((drone) => {
      if (drone.laser) {
        ctx.save();
        ctx.strokeStyle = "rgba(111, 247, 255, 0.85)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(drone.x, drone.y - 4);
        ctx.lineTo(drone.laser.x, drone.laser.y);
        ctx.stroke();
        ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(drone.x, drone.y - 4);
        ctx.lineTo(drone.laser.x, drone.laser.y);
        ctx.stroke();
        ctx.restore();
      }
      drawDrone(ctx, drone, this.visual);
    });
    drawPlayer(ctx, { x: this.player.x, y: this.player.y, invuln: this.player.invuln, shield: this.shieldTimer }, this.visual);
    this.particles.forEach((particle) => {
      const alpha = clamp(particle.life / particle.max, 0, 1);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = particle.color;
      ctx.fillRect(Math.round(particle.x), Math.round(particle.y), particle.size, particle.size);
    });
    ctx.globalAlpha = 1;
    if (this.ultTimer > 0) {
      const alpha = Math.min(0.75, this.ultTimer);
      ctx.fillStyle = "rgba(255, 240, 210, " + (0.16 * alpha) + ")";
      ctx.fillRect(0, 0, GAME_W, GAME_H);
      for (let i = 0; i < 5; i += 1) {
        const x = ((i * 97 + this.visual * 260) % (GAME_W + 80)) - 40;
        ctx.fillStyle = "rgba(255, 255, 255, " + (0.18 * alpha) + ")";
        ctx.fillRect(Math.round(x), 0, 14, GAME_H);
        ctx.fillStyle = "rgba(255, 209, 102, " + (0.25 * alpha) + ")";
        ctx.fillRect(Math.round(x) + 14, 0, 4, GAME_H);
      }
    }
    ctx.restore();
    if (this.flash > 0) {
      ctx.fillStyle = "rgba(255, 240, 255, " + Math.min(0.5, this.flash * 0.45) + ")";
      ctx.fillRect(0, 0, GAME_W, GAME_H);
    }
    if (this.hull <= 1 && this.running && !this.over) {
      const gradient = ctx.createLinearGradient(0, 0, 0, GAME_H);
      gradient.addColorStop(0, "rgba(255, 60, 110, 0.34)");
      gradient.addColorStop(0.35, "rgba(255, 60, 110, 0)");
      gradient.addColorStop(0.65, "rgba(255, 60, 110, 0)");
      gradient.addColorStop(1, "rgba(255, 60, 110, 0.34)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, GAME_W, GAME_H);
    }
    if (this.paused && !this.over) {
      ctx.fillStyle = "rgba(4, 5, 14, 0.45)";
      ctx.fillRect(0, 0, GAME_W, GAME_H);
    }
  }
}
