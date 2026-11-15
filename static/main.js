// 猫娘星海作战 —— 组合根：装配音频、战斗引擎与界面
import { AudioBus } from "./audio.js";
import { BattleEngine } from "./engine.js";
import { GameUI } from "./ui.js";
import { GAME_H, GAME_W, WINGMAN_DEFAULT } from "./config.js";

let fatalShown = false;

function reportFatal(message) {
  if (fatalShown) return;
  fatalShown = true;
  const box = document.getElementById("boot-error");
  if (box) {
    box.classList.remove("hidden");
    box.textContent = "启动失败：" + message;
  }
  const sub = document.getElementById("boot-sub");
  if (sub) sub.textContent = "界面启动失败";
  console.error("[neko_spacewar]", message);
}

async function main() {
  const canvas = document.getElementById("game");
  if (!canvas) throw new Error("找不到战斗画布 #game");
  canvas.width = GAME_W;
  canvas.height = GAME_H;
  const audio = new AudioBus();
  const engine = new BattleEngine({ canvas: canvas, audio: audio, wingman: WINGMAN_DEFAULT });
  const ui = new GameUI(engine, audio);
  window.__nekoSpaceWar = { engine: engine, ui: ui, audio: audio };
  await ui.boot();
  window.addEventListener("beforeunload", () => {
    try {
      ui.destroy();
      engine.destroy();
    } catch (err) {
      /* 卸载阶段忽略 */
    }
  });
}

window.addEventListener("error", (event) => {
  const message = event && event.message ? event.message : "未知脚本错误";
  reportFatal(message);
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event && event.reason ? event.reason : "未知异步错误";
  reportFatal(String((reason && reason.message) || reason));
});

main().catch((err) => reportFatal((err && err.message) || String(err)));
