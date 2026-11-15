// 猫娘星海作战 —— 界面层：DOM 绑定、/runs 桥、主界面联动、存档与图鉴
import {
  PLUGIN_ID,
  RUNS_URL,
  STORAGE_KEY,
  WINGMAN_DEFAULT,
  DIFFICULTIES,
  DIFFICULTY_ORDER,
  ORDERS,
  QUICK_PHRASES,
  CAT_LINES,
  DOCTOR_FALLBACK,
} from "./config.js";
import { drawCatFace, drawHeartIcon } from "./pixel.js";

const RUNS_POLL_MS = 300;
const SYNC_INTERVAL_MS = 4000;
const HINT_DEFAULT = "拖动星舰 · 自动开火 · 1-4 战术指令 · P 暂停";
const LEGACY_STORAGE_KEY = "neko_star_battle:v1";

const RANKS = [
  [30000, "星海传奇"],
  [15000, "银河老兵"],
  [7000, "星际游骑"],
  [3000, "巡航舰员"],
  [0, "列兵"],
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 闲聊类战况节点的本地限流（毫秒）；不在表里的节点（开局/母舰/结束）一律放行。
const BANTER_MIN_GAP = {
  wave: 45000,
  combo: 60000,
  low_hull: 30000,
};

function formatNumber(value) {
  const number = Math.max(0, Math.round(Number(value) || 0));
  return String(number).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  return Math.floor(total / 60) + "分" + String(total % 60).padStart(2, "0") + "秒";
}

function rankForScore(score) {
  const value = Math.max(0, Math.round(Number(score) || 0));
  for (let i = 0; i < RANKS.length; i += 1) {
    if (value >= RANKS[i][0]) return RANKS[i][1];
  }
  return "列兵";
}

function pickLine(key) {
  const lines = CAT_LINES[key] || [];
  if (!lines.length) return "";
  return lines[Math.floor(Math.random() * lines.length)];
}

// ---------------------------------------------------------------------- /runs 桥

async function callEntry(entryId, args = {}, options = {}) {
  const timeoutMs = options.timeoutMs || 12000;
  const response = await fetch(RUNS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plugin_id: PLUGIN_ID, entry_id: entryId, args: args }),
  });
  if (!response.ok) throw new Error("调用 " + entryId + " 失败：HTTP " + response.status);
  const created = await response.json();
  const runId = created.run_id || created.id;
  if (!runId) throw new Error("调用 " + entryId + " 没有返回 run_id");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(RUNS_POLL_MS);
    const statusResponse = await fetch(RUNS_URL + "/" + encodeURIComponent(runId));
    if (!statusResponse.ok) continue;
    const record = await statusResponse.json();
    const status = String(record.status || record.state || "").toLowerCase();
    if (["succeeded", "success", "completed", "finished"].indexOf(status) >= 0) {
      let payload = null;
      try {
        const exported = await fetch(RUNS_URL + "/" + encodeURIComponent(runId) + "/export");
        if (exported.ok) {
          const data = await exported.json();
          const items = Array.isArray(data.items) ? data.items : [];
          const jsonItem = items.find((item) => item && item.type === "json" && item.json) || items[0];
          if (jsonItem) payload = jsonItem.json !== undefined ? jsonItem.json : jsonItem;
        }
      } catch (err) {
        payload = null;
      }
      if (!payload) payload = record.result || record.output || null;
      if (payload && payload.success === false && payload.error) throw new Error(String(payload.error));
      if (payload && payload.data !== undefined) return payload.data;
      return payload || {};
    }
    if (["failed", "error", "canceled", "cancelled", "timeout", "expired"].indexOf(status) >= 0) {
      const reason = record.error && (record.error.message || record.error);
      throw new Error(reason ? String(reason) : "调用 " + entryId + " 失败");
    }
  }
  throw new Error("调用 " + entryId + " 超时");
}

// ---------------------------------------------------------------------- 界面

export class GameUI {
  constructor(engine, audio) {
    this.engine = engine;
    this.audio = audio;
    this.online = false;
    this.busy = false;
    this.profilePayload = null;
    this.runtime = {};
    this.settings = {
      difficulty: "normal",
      auto_fire: true,
      sfx: true,
      music: true,
      battle_sync: true,
      llm_chat: true,
      llm_banter: true,
    };
    this.banterInFlight = false;
    this._banterAt = {};
    this.selectedDifficulty = "normal";
    this.lastState = null;
    this.syncTimer = null;
    this.syncInFlight = false;
    this.bubbleTimer = null;
    this._cacheDom();
    this._bindDom();
    this._renderOrders();
    this._renderDifficulty();
    this._renderQuick();
    this._renderSettings();
    this._setScreen("boot");
    engine.onState = (state) => this.onState(state);
    engine.onEvent = (kind, payload) => this.onEvent(kind, payload);
    engine.onLine = (line, key) => this.onLine(line, key);
    engine.onGameOver = (report, snapshot) => this.onGameOver(report, snapshot);
    engine.onOrderKey = (orderId) => this.triggerOrder(orderId);
    engine.onPauseKey = () => {
      if (this.engine.running && !this.engine.over) this.togglePause();
    };
  }

  _cacheDom() {
    const byId = (id) => document.getElementById(id);
    this.dom = {
      app: byId("app"),
      statusLine: byId("status-line"),
      brandFace: byId("brand-face"),
      logoFace: byId("logo-face"),
      btnCodex: byId("btn-codex"),
      btnSettings: byId("btn-settings"),
      stage: byId("stage"),
      game: byId("game"),
      hud: byId("hud"),
      hudScore: byId("hud-score"),
      hudWave: byId("hud-wave"),
      hudHull: byId("hud-hull"),
      hudBond: byId("hud-bond"),
      hudBondFill: byId("hud-bond-fill"),
      hudCombo: byId("hud-combo"),
      catBubble: byId("cat-bubble"),
      catName: byId("cat-name"),
      catLine: byId("cat-line"),
      orders: byId("orders"),
      stageHint: byId("stage-hint"),
      commLog: byId("comm-log"),
      commQuick: byId("comm-quick"),
      commForm: byId("comm-form"),
      commText: byId("comm-text"),
      commHint: byId("comm-hint"),
      screenBoot: byId("screen-boot"),
      bootSub: byId("boot-sub"),
      screenStart: byId("screen-start"),
      startCatName: byId("start-cat-name"),
      startLine: byId("start-line"),
      startStats: byId("start-stats"),
      startDifficulty: byId("start-difficulty"),
      btnStart: byId("btn-start"),
      btnStartCodex: byId("btn-start-codex"),
      screenPause: byId("screen-pause"),
      btnResume: byId("btn-resume"),
      btnRestart: byId("btn-restart"),
      btnQuit: byId("btn-quit"),
      pauseLine: byId("pause-line"),
      screenResult: byId("screen-result"),
      resultTitle: byId("result-title"),
      resultGrid: byId("result-grid"),
      resultBadges: byId("result-badges"),
      resultLine: byId("result-line"),
      resultFeed: byId("result-feed"),
      btnAgain: byId("btn-again"),
      btnHangar: byId("btn-hangar"),
      modalCodex: byId("modal-codex"),
      codexBody: byId("codex-body"),
      btnCodexClose: byId("btn-codex-close"),
      modalSettings: byId("modal-settings"),
      settingsBody: byId("settings-body"),
      btnSettingsClose: byId("btn-settings-close"),
      bootError: byId("boot-error"),
    };
  }

  _bindDom() {
    const dom = this.dom;
    drawCatFace(dom.brandFace);
    drawCatFace(dom.logoFace);
    dom.btnStart.addEventListener("click", () => this.startGame());
    dom.btnStartCodex.addEventListener("click", () => this.openCodex());
    dom.btnCodex.addEventListener("click", () => this.openCodex());
    dom.btnSettings.addEventListener("click", () => this.openSettings());
    dom.btnCodexClose.addEventListener("click", () => this.closeModals());
    dom.btnSettingsClose.addEventListener("click", () => this.closeModals());
    dom.modalCodex.addEventListener("click", (event) => {
      if (event.target === dom.modalCodex) this.closeModals();
    });
    dom.modalSettings.addEventListener("click", (event) => {
      if (event.target === dom.modalSettings) this.closeModals();
    });
    dom.btnResume.addEventListener("click", () => this.togglePause());
    dom.btnRestart.addEventListener("click", () => this.startGame());
    dom.btnQuit.addEventListener("click", () => this.quitToHangar());
    dom.btnAgain.addEventListener("click", () => this.startGame());
    dom.btnHangar.addEventListener("click", () => this.quitToHangar());
    dom.commForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const text = dom.commText.value.trim();
      if (!text) return;
      dom.commText.value = "";
      this._addComm("player", "你", text);
      this.sendChat(text);
    });
    dom.orders.addEventListener("click", (event) => {
      const button = event.target.closest(".order-btn");
      if (!button) return;
      this.triggerOrder(button.dataset.order);
    });
    const unlock = () => {
      this.audio.unlock();
      this.audio.setSfx(this.settings.sfx);
      this.audio.setMusic(this.settings.music);
      document.removeEventListener("pointerdown", unlock, true);
      document.removeEventListener("keydown", unlock, true);
    };
    document.addEventListener("pointerdown", unlock, true);
    document.addEventListener("keydown", unlock, true);
  }

  // ------------------------------------------------------------------ 启动

  async boot() {
    this.dom.bootSub.textContent = "正在读取战机档案";
    this._loadLocal();
    this._renderStart();
    this._logSystem("正在连线猫娘…");
    try {
      const payload = await callEntry("battle_get_profile", {}, { timeoutMs: 10000 });
      this._applyProfilePayload(payload);
      this._markOnline();
    } catch (err) {
      this._markOffline();
      this.dom.bootSub.textContent = "离线模式";
      this._logSystem("没能连上插件后端，先离线作战；战绩会暂存在本机。");
    }
    this._applySettings();
    this._renderStart();
    this._setScreen("start");
    this._startSyncLoop();
  }

  _markOnline() {
    this.online = true;
    this.dom.statusLine.textContent = "猫娘已连线 · 你说的每句话都会送到她那儿";
    this.dom.commHint.textContent = "直接跟她说话，她会看到并回你；回话会出现在这里";
  }

  _markOffline() {
    this.online = false;
    this.dom.statusLine.textContent = "离线模式 · 战绩暂存本机（启动插件后自动同步）";
    this.dom.commHint.textContent = "插件离线，先记在本地；连上后她会回你";
  }

  _applyProfilePayload(payload) {
    if (!payload || typeof payload !== "object") return;
    this.profilePayload = payload;
    this.runtime = payload.runtime || this.runtime;
    this._saveLocal();
  }

  _applySettings() {
    const profile = this.profilePayload && this.profilePayload.profile;
    const settings = (profile && profile.settings) || {};
    this.settings = Object.assign(
      {
        difficulty: "normal",
        auto_fire: true,
        sfx: true,
        music: true,
        battle_sync: true,
        llm_chat: true,
        llm_banter: true,
      },
      settings
    );
    if (this.runtime && this.runtime.default_difficulty && !settings.difficulty) {
      this.settings.difficulty = this.runtime.default_difficulty;
    }
    this.selectedDifficulty = DIFFICULTIES[this.settings.difficulty] ? this.settings.difficulty : "normal";
    const wingman = (this.runtime && this.runtime.wingman_name) || WINGMAN_DEFAULT;
    this.engine.setWingman(wingman);
    this.dom.catName.textContent = wingman;
    this.dom.startCatName.textContent = wingman;
    this.engine.setSettings({
      autoFire: this.settings.auto_fire,
      sfx: this.settings.sfx,
      music: this.settings.music,
    });
    this.audio.setSfx(this.settings.sfx);
    this.audio.setMusic(this.settings.music);
    this._renderDifficulty();
    this._renderSettings();
  }

  // ------------------------------------------------------------------ 屏幕切换

  _setScreen(name) {
    const screens = {
      boot: this.dom.screenBoot,
      start: this.dom.screenStart,
      pause: this.dom.screenPause,
      result: this.dom.screenResult,
    };
    Object.keys(screens).forEach((key) => {
      screens[key].classList.toggle("hidden", key !== name);
    });
    const stageActive = name === "game" || name === "pause" || name === "result";
    const hudActive = name === "game" || name === "pause";
    this.dom.hud.classList.toggle("hidden", !hudActive);
    this.dom.orders.classList.toggle("hidden", !(name === "game" || name === "pause"));
    this.dom.stageHint.classList.toggle("hidden", stageActive);
    if (name === "pause") {
      this.dom.pauseLine.textContent = pickLine("idle");
    }
  }

  startGame() {
    if (this.busy) return;
    this.closeModals();
    this.audio.unlock();
    this.busy = true;
    this.dom.stageHint.textContent = HINT_DEFAULT;
    this._setScreen("game");
    this._clearBubble();
    this.engine.setWingman((this.runtime && this.runtime.wingman_name) || WINGMAN_DEFAULT);
    this.engine.start(this.selectedDifficulty);
    this._logSystem("第 1 波开始 · " + (DIFFICULTIES[this.selectedDifficulty] || DIFFICULTIES.normal).label + "难度");
    this.busy = false;
  }

  togglePause() {
    if (!this.engine.running || this.engine.over) return;
    if (this.engine.paused) {
      this.engine.resume();
      this._setScreen("game");
    } else {
      this.engine.pause();
      this._setScreen("pause");
    }
  }

  quitToHangar() {
    this.engine.quit();
    this._setScreen("start");
    this._renderStart();
    this._renderOrders();
  }

  // ------------------------------------------------------------------ 战术指令

  _renderOrders() {
    this.dom.orders.innerHTML = ORDERS.map((order) => {
      const classes = ["order-btn"];
      if (order.id === "ultimate") classes.push("ult");
      return (
        '<button class="' + classes.join(" ") + '" type="button" data-order="' + order.id + '">' +
        '<span class="order-key">' + order.key + "</span>" +
        '<span class="order-name">' + order.label + "</span>" +
        '<span class="order-meta">' + order.cost + " 羁绊 · " + order.cooldown + "s</span>" +
        '<span class="order-cd hidden"></span>' +
        "</button>"
      );
    }).join("");
    this.orderButtons = Array.from(this.dom.orders.querySelectorAll(".order-btn"));
  }

  _updateOrders(state) {
    if (!this.orderButtons) return;
    const orderState = state.order_state || [];
    this.orderButtons.forEach((button) => {
      const info = orderState.find((item) => item.id === button.dataset.order);
      const cooldown = info ? info.cooldown : 0;
      const ready = Boolean(info && info.ready);
      button.disabled = !ready;
      button.classList.toggle("ready", ready);
      button.classList.toggle("cooling", cooldown > 0.05);
      const cd = button.querySelector(".order-cd");
      if (cooldown > 0.05) {
        cd.classList.remove("hidden");
        cd.textContent = Math.ceil(cooldown) + "s";
      } else {
        cd.classList.add("hidden");
      }
    });
  }

  triggerOrder(orderId) {
    if (!this.engine.running || this.engine.over) {
      this._logSystem("现在不在战斗中，战术指令先记着。");
      return;
    }
    const result = this.engine.command(orderId);
    if (result.ok) {
      this._logSystem("你下达了「" + result.message + "」");
    } else {
      this._logSystem(result.message || "指令没能执行。");
      this.audio.deny();
    }
  }

  // ------------------------------------------------------------------ 难度 / 快捷短语

  _renderDifficulty() {
    this.dom.startDifficulty.innerHTML = DIFFICULTY_ORDER.map((key) => {
      const diff = DIFFICULTIES[key];
      const active = key === this.selectedDifficulty ? " active" : "";
      return (
        '<button class="diff-btn' + active + '" type="button" data-difficulty="' + key + '">' +
        diff.label + "<small>" + diff.sub + "</small></button>"
      );
    }).join("");
    Array.from(this.dom.startDifficulty.querySelectorAll(".diff-btn")).forEach((button) => {
      button.addEventListener("click", () => {
        this.selectedDifficulty = button.dataset.difficulty;
        this.settings.difficulty = this.selectedDifficulty;
        this._renderDifficulty();
        this._renderSettings();
        this._saveSettings();
        this.audio.ui();
      });
    });
  }

  _renderQuick() {
    this.dom.commQuick.innerHTML = QUICK_PHRASES.map(
      (item) => '<button class="quick-btn" type="button" data-phrase="' + item.id + '">' + item.text + "</button>"
    ).join("");
    Array.from(this.dom.commQuick.querySelectorAll(".quick-btn")).forEach((button) => {
      button.addEventListener("click", () => this.useQuickPhrase(button.dataset.phrase));
    });
  }

  useQuickPhrase(id) {
    const phrase = QUICK_PHRASES.find((item) => item.id === id);
    if (!phrase) return;
    if (id === "cheer") {
      if (!this.engine.running || this.engine.over) {
        this._logSystem("战斗开始后，打气才收得到哦。");
        return;
      }
      const result = this.engine.cheer();
      if (result && result.ok === false) {
        this._logSystem(result.message || "现在还打不了气。");
        return;
      }
      this._addComm("player", "你", phrase.text);
      this._sendCheerToHost();
      return;
    }
    this._addComm("player", "你", phrase.text);
    this.sendChat(phrase.text);
  }

  // ------------------------------------------------------------------ 通讯

  _addComm(kind, who, text) {
    const item = document.createElement("div");
    item.className = "msg " + kind;
    if (kind === "system") {
      item.textContent = text;
    } else {
      const label = document.createElement("span");
      label.className = "who";
      label.textContent = who;
      const body = document.createElement("span");
      body.className = "body";
      body.textContent = text;
      item.appendChild(label);
      item.appendChild(body);
    }
    this.dom.commLog.appendChild(item);
    while (this.dom.commLog.children.length > 60) {
      this.dom.commLog.removeChild(this.dom.commLog.firstChild);
    }
    this.dom.commLog.scrollTop = this.dom.commLog.scrollHeight;
    return item;
  }

  _logSystem(text) {
    this._addComm("system", "", text);
  }

  _sayName() {
    return (this.runtime && this.runtime.wingman_name) || WINGMAN_DEFAULT;
  }

  _onCatSay(text, options = {}) {
    const line = String(text || "").trim();
    if (!line) return;
    this._showBubble(line);
    this._addComm("cat", this._sayName(), line);
    if (options.hint) this.dom.stageHint.textContent = line;
  }

  onLine(line, key) {
    if (!line) return;
    const hint = key === "start" || key === "boss" || key === "bossDown";
    this._onCatSay(line, { hint: hint });
  }

  _showBubble(text) {
    const bubble = this.dom.catBubble;
    this.dom.catLine.textContent = text;
    this.dom.catName.textContent = (this.runtime && this.runtime.wingman_name) || WINGMAN_DEFAULT;
    bubble.classList.remove("hidden");
    if (this.bubbleTimer) clearTimeout(this.bubbleTimer);
    this.bubbleTimer = setTimeout(() => bubble.classList.add("hidden"), 5200);
  }

  _clearBubble() {
    if (this.bubbleTimer) clearTimeout(this.bubbleTimer);
    this.dom.catBubble.classList.add("hidden");
  }

  async sendChat(text) {
    const said = String(text || "").trim();
    if (!said) return;
    if (!this.online) {
      this._logSystem("离线模式：这句话先记在本地，插件连上后可以再发一次。");
      return;
    }
    const pending = this._addComm("system", "", "（等" + this._sayName() + "回话…）");
    try {
      // 回话不由这里返回：她本人思考完会调用 spacewar_say，下一次轮询时台词才到达。
      const data = await callEntry(
        "battle_chat",
        { message: said, state: this.engine.snapshot() },
        { timeoutMs: 22000 }
      );
      if (pending && pending.parentNode) pending.parentNode.removeChild(pending);
      if (data && data.success) {
        this._logSystem("已经告诉她了，等她回话…");
      } else {
        this._logSystem((data && data.summary) || "她没接上话，稍后再试。");
      }
    } catch (err) {
      if (pending && pending.parentNode) pending.parentNode.removeChild(pending);
      this._logSystem("通讯失败：" + err.message);
    }
  }

  // ------------------------------------------------------------------ 战斗状态

  onState(state) {
    this.lastState = state;
    if (!state || state.over) {
      this._updateOrders(state || {});
      return;
    }
    const dom = this.dom;
    dom.hudScore.textContent = formatNumber(state.score);
    dom.hudWave.textContent = String(state.wave);
    dom.hudBond.textContent = String(state.bond);
    dom.hudBondFill.style.width = Math.max(0, Math.min(100, state.bond)) + "%";
    this._renderHull(state);
    const multiplier = 1 + Math.min(state.combo || 0, 100) * 0.02;
    if ((state.combo || 0) >= 2) {
      dom.hudCombo.classList.remove("hidden");
      dom.hudCombo.textContent = "x" + multiplier.toFixed(1) + " · " + state.combo + " 连击";
    } else {
      dom.hudCombo.classList.add("hidden");
    }
    if (state.paused) {
      dom.stageHint.textContent = HINT_DEFAULT;
    } else if (state.boss_active) {
      dom.stageHint.textContent = "母舰战 · 第 " + state.wave + " 波 · 小心弹幕";
    } else if (state.running) {
      dom.stageHint.textContent = "第 " + state.wave + " 波 · 羁绊 " + state.bond + " · 得分 " + formatNumber(state.score);
    }
    this._updateOrders(state);
  }

  _renderHull(state) {
    const max = state.max_hull || 3;
    const hull = state.hull_integrity || 0;
    const container = this.dom.hudHull;
    if (container.children.length !== max || container.dataset.max !== String(max)) {
      container.innerHTML = "";
      container.dataset.max = String(max);
      for (let i = 0; i < max; i += 1) {
        const canvas = document.createElement("canvas");
        canvas.className = "hull-heart";
        canvas.width = 14;
        canvas.height = 12;
        container.appendChild(canvas);
      }
    }
    Array.from(container.children).forEach((canvas, index) => {
      drawHeartIcon(canvas, index >= hull);
    });
  }

  onEvent(kind, payload) {
    if (kind === "start") {
      this._logSystem("战斗开始 · " + ((DIFFICULTIES[this.selectedDifficulty] || DIFFICULTIES.normal).label) + "难度");
      this._postEvent("start", payload);
      this._requestBanter("start", payload);
    } else if (kind === "boss_spawn") {
      this.dom.stageHint.textContent = "母舰来袭！";
      this._postEvent("boss_spawn", payload);
      this._requestBanter("boss_spawn", payload);
    } else if (kind === "boss_down") {
      this._logSystem("击破母舰！");
      this._postEvent("boss_down", payload);
      this._requestBanter("boss_down", payload);
    } else if (kind === "wave") {
      // 新一波开始：让她先开口，而不是等玩家说话。
      this._requestBanter("wave", payload);
    } else if (kind === "hull_low") {
      this.dom.stageHint.textContent = "装甲告急！";
      this._requestBanter("low_hull", payload);
    } else if (kind === "combo") {
      this._requestBanter("combo", payload);
    } else if (kind === "over") {
      // 默认由随后的战报点评负责收尾（战报本身带数据，说得更准）；
      // 玩家关掉战报同步时，用这条兜底，保证结束一定有人应声。
      if (!this.settings.battle_sync) this._requestBanter("run_over", payload);
    } else if (kind === "wave_clear") {
      this._logSystem("第 " + (payload && payload.wave) + " 波清空 · 羁绊 +8");
    }
  }

  async _requestBanter(kind, payload) {
    if (!this.online || !this.settings.llm_banter || this.banterInFlight) return;
    // 闲聊类节点在本地先限流，免得一波连击把她刷成弹幕机；
    // 关键节点（开局 / 母舰 / 结束）不拦，宁可让她说。
    const gap = BANTER_MIN_GAP[kind] || 0;
    if (gap > 0) {
      const now = performance.now();
      const last = this._banterAt[kind] || 0;
      if (now - last < gap) return;
      this._banterAt[kind] = now;
    }
    this.banterInFlight = true;
    try {
      // 她主动开口后会用 spacewar_say 把台词送进来，这里只负责触发。
      await callEntry(
        "battle_banter",
        { kind: kind, state: this.engine.snapshot(), payload: payload || {} },
        { timeoutMs: 16000 }
      );
    } catch (err) {
      /* 主动搭话失败不影响战斗 */
    } finally {
      this.banterInFlight = false;
    }
  }

  async _postEvent(event, payload) {
    if (!this.online) return;
    try {
      await callEntry("battle_event", { event: event, payload: payload || {} }, { timeoutMs: 8000 });
    } catch (err) {
      /* 事件推送失败不影响游戏 */
    }
  }

  async _sendCheerToHost() {
    if (!this.online) return;
    try {
      // 玩家点了「打气」：这句话同样转给她本人，她的回应走 spacewar_say 回来。
      await callEntry(
        "battle_chat",
        { message: "加油！", state: this.engine.snapshot() },
        { timeoutMs: 12000 }
      );
    } catch (err) {
      /* 忽略 */
    }
  }

  // ------------------------------------------------------------------ 战报结算

  async onGameOver(report, snapshot) {
    this._setScreen("result");
    this.dom.resultTitle.textContent = "星舰返航";
    this.dom.resultBadges.innerHTML = "";
    this.dom.resultFeed.textContent = "正在结算战报…";
    this._fillResultGrid(report, null);
    this.dom.resultLine.textContent = pickLine("gameOver");
    this._logSystem("本局结束 · 得分 " + formatNumber(report.score) + " · 第 " + report.wave + " 波");
    if (!this.online) {
      const local = this._settleLocal(report);
      this._fillResultGrid(report, local);
      this.dom.resultFeed.textContent = "离线模式：战绩已存到本机，插件连上后还可以继续同步。";
      this._renderStart();
      return;
    }
    try {
      const data = await callEntry("battle_report", { report: report }, { timeoutMs: 20000 });
      if (data && data.success) {
        this._fillResultGrid(report, data);
        this._renderResultBadges(data.new_achievements || []);
        let feed = data.summary || "本局结算完成。";
        if (data.pushed) {
          feed += " 战报已经送到主界面，她会看到这一局。";
        } else if (data.push_reason === "cooldown") {
          const cooldown = (this.runtime && this.runtime.report_cooldown) || 20;
          feed += " 战报推送在冷却中（每 " + cooldown + " 秒一条），主界面暂时不会收到。";
        }
        this.dom.resultFeed.textContent = feed;
        if (data.new_record) this.dom.resultTitle.textContent = "新纪录！";
        this._refreshProfileQuietly();
      } else {
        this.dom.resultFeed.textContent = "结算没有成功：本地战绩仍然可用。";
      }
    } catch (err) {
      this._markOffline();
      this._settleLocal(report);
      this.dom.resultFeed.textContent = "战报没能送到插件后端（" + err.message + "），已先存在本机。";
    }
    this._renderStart();
  }

  _fillResultGrid(report, settled) {
    const cells = [
      ["得分", formatNumber(report.score)],
      ["波次", String(report.wave)],
      ["击毁", String(report.kills)],
      ["母舰", String(report.boss_kills)],
      ["最高连击", String(report.max_combo)],
      ["用时", formatDuration(report.duration_seconds)],
      ["被击中", String(report.hits_taken)],
      ["羁绊峰值", report.bond_peak + "/100"],
      ["猫猫星爆", String(report.ultimates_used)],
    ];
    if (settled) {
      cells.push(["军衔", settled.rank || rankForScore(report.score)]);
      cells.push(["亲密度", "+" + (settled.affinity_gain || 0) + " · Lv." + (settled.affinity_level || 1)]);
      cells.push(["历史最高", formatNumber(settled.best_score || report.score)]);
    }
    this.dom.resultGrid.innerHTML = cells
      .map(
        (cell) =>
          '<div class="stat-cell"><span class="stat-label">' + cell[0] +
          '</span><span class="stat-value">' + cell[1] + "</span></div>"
      )
      .join("");
  }

  _renderResultBadges(list) {
    const badges = (list || []).map(
      (item) => '<span class="badge-pill">' + (item.name || item.id) + "</span>"
    );
    this.dom.resultBadges.innerHTML = badges.join("");
  }

  _settleLocal(report) {
    const payload = this.profilePayload || {};
    const profile = payload.profile || (payload.profile = {});
    const previousBest = Number(profile.best_score) || 0;
    const newRecord = report.score > previousBest;
    profile.best_score = Math.max(previousBest, report.score);
    profile.best_wave = Math.max(Number(profile.best_wave) || 0, report.wave);
    profile.best_combo = Math.max(Number(profile.best_combo) || 0, report.max_combo);
    profile.total_sorties = (Number(profile.total_sorties) || 0) + 1;
    profile.total_kills = (Number(profile.total_kills) || 0) + report.kills;
    profile.boss_kills = (Number(profile.boss_kills) || 0) + report.boss_kills;
    profile.total_duration_seconds = (Number(profile.total_duration_seconds) || 0) + report.duration_seconds;
    profile.affinity = (Number(profile.affinity) || 0) + 3;
    payload.rank = rankForScore(profile.best_score);
    payload.affinity_level = 1 + Math.floor(profile.affinity / 100);
    this.profilePayload = payload;
    this._saveLocal();
    return {
      rank: payload.rank,
      affinity_gain: 3,
      affinity_level: payload.affinity_level,
      best_score: profile.best_score,
      new_record: newRecord,
    };
  }

  async _refreshProfileQuietly() {
    try {
      const payload = await callEntry("battle_get_profile", {}, { timeoutMs: 8000 });
      this._applyProfilePayload(payload);
      this._renderStart();
    } catch (err) {
      /* 忽略 */
    }
  }

  // ------------------------------------------------------------------ 同步循环

  _startSyncLoop() {
    if (this.syncTimer) clearInterval(this.syncTimer);
    this.syncTimer = setInterval(() => this._syncTick(), SYNC_INTERVAL_MS);
    this._syncTick();
  }

  async _syncTick() {
    if (!this.online || this.syncInFlight) return;
    this.syncInFlight = true;
    const snapshot = this.engine.snapshot();
    const wasRunning = snapshot.running;
    try {
      const data = await callEntry(
        "battle_sync_state",
        { state: snapshot, ui_open: !wasRunning },
        { timeoutMs: 9000 }
      );
      this.syncInFlight = false;
      if (!data) return;
      if (data.runtime && data.runtime.wingman_name && data.runtime.wingman_name !== this.runtime.wingman_name) {
        this.runtime = data.runtime;
        this.engine.setWingman(this.runtime.wingman_name);
        this.dom.catName.textContent = this.runtime.wingman_name;
        this.dom.startCatName.textContent = this.runtime.wingman_name;
      }
      const poll = data.poll || {};
      (poll.says || []).forEach((item) => {
        const text = typeof item === "string" ? item : item && item.text;
        if (text) this._onCatSay(String(text));
      });
      if (poll.start_request && !this.engine.running) {
        const requested = DIFFICULTIES[poll.start_request.difficulty] ? poll.start_request.difficulty : "normal";
        this.selectedDifficulty = requested;
        this._renderDifficulty();
        this._logSystem("主界面的猫娘替你预约了一局（" + DIFFICULTIES[requested].label + "难度）");
        this.startGame();
        return;
      }
      (poll.orders || []).forEach((item) => {
        const orderId = item.order || item.id;
        const result = this.engine.command(orderId);
        if (result.ok) {
          this._logSystem("主界面的猫娘下达了「" + result.message + "」");
        } else {
          this._logSystem("主界面下达的「" + (item.label || orderId) + "」没能执行：" + (result.message || ""));
        }
      });
      if (poll.cheer > 0) {
        let count = Math.min(3, poll.cheer);
        let gained = 0;
        while (count > 0) {
          const result = this.engine.cheer();
          if (result && result.ok !== false) gained += 1;
          count -= 1;
        }
        if (gained > 0) this._logSystem("主界面的猫娘给你打气了！羁绊 +" + gained * 2);
        else this._logSystem("她的打气还在冷却，等一下下～");
      }
    } catch (err) {
      this.syncInFlight = false;
      this._markOffline();
    }
  }

  // ------------------------------------------------------------------ 设置面板

  _renderSettings() {
    const rows = [
      ["auto_fire", "自动开火", "不按也自动射击，专心躲弹幕"],
      ["sfx", "战斗音效", "射击、爆炸与指令提示音"],
      ["music", "背景音乐", "低音量合成星海氛围"],
      ["battle_sync", "战报送主界面", "每局结束让猫娘点评这一局"],
      ["llm_chat", "机内通讯", "你在游戏里说话时，转给主界面的猫娘本人"],
      ["llm_banter", "主动搭话", "开局、母舰出现时会主动喊你"],
    ];
    const switches = rows
      .map(
        (row) =>
          '<div class="setting-row"><div><span class="setting-label">' + row[1] +
          '</span><span class="setting-desc">' + row[2] + "</span></div>" +
          '<button class="switch' + (this.settings[row[0]] ? " on" : "") + '" type="button" role="switch" ' +
          'data-setting="' + row[0] + '" aria-checked="' + (this.settings[row[0]] ? "true" : "false") + '"></button></div>'
      )
      .join("");
    const difficulty = DIFFICULTY_ORDER.map((key) => {
      const active = key === this.selectedDifficulty ? " active" : "";
      return (
        '<button class="diff-btn' + active + '" type="button" data-setting-difficulty="' + key + '">' +
        DIFFICULTIES[key].label + "</button>"
      );
    }).join("");
    this.dom.settingsBody.innerHTML =
      '<p class="section-title">战斗偏好</p>' + switches +
      '<p class="section-title">默认难度</p><div class="difficulty compact">' + difficulty + "</div>";
    Array.from(this.dom.settingsBody.querySelectorAll(".switch")).forEach((button) => {
      button.addEventListener("click", () => this._toggleSetting(button.dataset.setting));
    });
    Array.from(this.dom.settingsBody.querySelectorAll("[data-setting-difficulty]")).forEach((button) => {
      button.addEventListener("click", () => {
        this.selectedDifficulty = button.dataset.settingDifficulty;
        this.settings.difficulty = this.selectedDifficulty;
        this._renderDifficulty();
        this._renderSettings();
        this._saveSettings();
      });
    });
  }

  _toggleSetting(key) {
    const value = !this.settings[key];
    this.settings[key] = value;
    if (key === "auto_fire") this.engine.setSettings({ autoFire: value });
    if (key === "sfx") {
      this.engine.setSettings({ sfx: value });
      this.audio.setSfx(value);
    }
    if (key === "music") {
      this.engine.setSettings({ music: value });
      this.audio.setMusic(value);
    }
    this._renderSettings();
    this._saveSettings();
    this.audio.ui();
  }

  async _saveSettings() {
    this._saveLocal();
    if (!this.online) return;
    const payload = {
      difficulty: this.settings.difficulty,
      auto_fire: this.settings.auto_fire,
      sfx: this.settings.sfx,
      music: this.settings.music,
      battle_sync: this.settings.battle_sync,
      llm_chat: this.settings.llm_chat,
      llm_banter: this.settings.llm_banter,
    };
    try {
      const data = await callEntry("battle_set_settings", { settings: payload }, { timeoutMs: 8000 });
      if (data) this._applyProfilePayload(data);
    } catch (err) {
      /* 设置保存失败不打扰玩家 */
    }
  }

  openSettings() {
    this._renderSettings();
    this.dom.modalSettings.classList.remove("hidden");
  }

  // ------------------------------------------------------------------ 图鉴

  openCodex() {
    this.dom.modalCodex.classList.remove("hidden");
    this._renderCodex();
    if (this.online) this._refreshProfileQuietly().then(() => this._renderCodex());
  }

  closeModals() {
    this.dom.modalCodex.classList.add("hidden");
    this.dom.modalSettings.classList.add("hidden");
  }

  _renderCodex() {
    const payload = this.profilePayload || {};
    const profile = payload.profile || {};
    const title = (text) => '<p class="section-title">' + text + "</p>";
    const stat = (label, value) =>
      '<div class="stat-cell"><span class="stat-label">' + label +
      '</span><span class="stat-value">' + value + "</span></div>";
    const stats = [
      stat("最高分", formatNumber(profile.best_score)),
      stat("最高波次", String(profile.best_wave || 0)),
      stat("总出击", String(profile.total_sorties || 0)),
      stat("总击毁", String(profile.total_kills || 0)),
      stat("母舰击毁", String(profile.boss_kills || 0)),
      stat("最高连击", String(profile.best_combo || 0)),
      stat("亲密度", "Lv." + (payload.affinity_level || 1)),
      stat("军衔", payload.rank || rankForScore(profile.best_score)),
      stat("累计时长", formatDuration(profile.total_duration_seconds)),
    ].join("");
    let achievements = payload.achievements || [];
    if (typeof achievements === "string") achievements = [];
    const badgeList = Array.isArray(achievements) ? achievements : [];
    const badgeHtml = badgeList.length
      ? badgeList
          .map(
            (item) =>
              '<div class="ach' + (item.unlocked ? " on" : "") + '"><span class="ach-name">' +
              (item.unlocked ? "★ " : "☆ ") + item.name + '</span><span class="ach-desc">' +
              item.description + "</span></div>"
          )
          .join("")
      : '<p class="docs-text">连上插件后这里会显示徽章。</p>';
    const docs = DOCTOR_FALLBACK.map(
      (section) =>
        '<details class="docs-item"><summary>' + section.title +
        '</summary><p class="docs-text">' + section.text + "</p></details>"
    ).join("");
    this.dom.codexBody.innerHTML =
      title("战机档案") + '<div class="profile-grid">' + stats + "</div>" +
      title("徽章收藏") + '<div class="ach-grid">' + badgeHtml + "</div>" +
      title("玩法手册") + docs +
      '<p class="section-title">危险区</p>' +
      '<button class="btn btn-ghost btn-sm" type="button" id="btn-reset-profile">清空战绩与徽章</button>' +
      '<p class="docs-text">只清空战绩和徽章，设置会保留。这个操作不能撤销。</p>';
    const reset = document.getElementById("btn-reset-profile");
    if (reset) reset.addEventListener("click", () => this.resetProfile());
  }

  async resetProfile() {
    if (!window.confirm("确定要清空全部战绩与徽章吗？")) return;
    if (!this.online) {
      this.profilePayload = null;
      this._saveLocal();
      this._renderCodex();
      this._renderStart();
      this._logSystem("离线模式：本地战绩已清空。");
      return;
    }
    try {
      const data = await callEntry("battle_reset_profile", {}, { timeoutMs: 10000 });
      this._applyProfilePayload(data);
      this._renderCodex();
      this._renderStart();
      this._logSystem("战绩与徽章已清空。");
    } catch (err) {
      this._logSystem("清空失败：" + err.message);
    }
  }

  // ------------------------------------------------------------------ 开始界面

  _renderStart() {
    const payload = this.profilePayload || {};
    const profile = payload.profile || {};
    const cells = [
      ["最高分", formatNumber(profile.best_score)],
      ["军衔", payload.rank || rankForScore(profile.best_score)],
      ["亲密度", "Lv." + (payload.affinity_level || 1)],
    ];
    this.dom.startStats.innerHTML = cells
      .map(
        (cell) =>
          '<div class="stat-cell"><span class="stat-label">' + cell[0] +
          '</span><span class="stat-value">' + cell[1] + "</span></div>"
      )
      .join("");
    this.dom.startLine.textContent = pickLine("start");
    this.dom.resultLine.textContent = pickLine("gameOver");
  }

  // ------------------------------------------------------------------ 本地存储

  _saveLocal() {
    try {
      const data = { profile: this.profilePayload, settings: this.settings, saved_at: Date.now() };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (err) {
      /* localStorage 不可用时忽略 */
    }
  }

  _loadLocal() {
    try {
      let raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
        if (!legacy) return;
        raw = legacy;
        try {
          localStorage.setItem(STORAGE_KEY, legacy);
        } catch (err) {
          /* 迁移失败就用内存里的数据 */
        }
      }
      const data = JSON.parse(raw);
      if (data && data.profile && data.profile.profile) this.profilePayload = data.profile;
      if (data && data.settings) {
        this.settings = Object.assign(this.settings, data.settings);
        this.selectedDifficulty = DIFFICULTIES[this.settings.difficulty] ? this.settings.difficulty : "normal";
      }
    } catch (err) {
      /* 损坏的本地数据直接忽略 */
    }
  }

  // ------------------------------------------------------------------ 其他

  setBootError(message) {
    this.dom.bootError.classList.remove("hidden");
    this.dom.bootError.textContent = message;
    this.dom.bootSub.textContent = "界面启动失败";
  }

  destroy() {
    if (this.syncTimer) clearInterval(this.syncTimer);
    if (this.bubbleTimer) clearTimeout(this.bubbleTimer);
  }
}
