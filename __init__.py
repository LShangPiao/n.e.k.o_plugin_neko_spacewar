"""猫娘星海作战：像素风太空射击小游戏，主界面的猫娘陪你一起打。

插件只做三件事：

1. 提供静态界面（static/）——战斗本身完全在浏览器里跑，不依赖插件进程；
2. 保存战绩、设置与亲密度（data/profile.json），供界面和主界面读取；
3. 把战报、机内通讯、主界面下达的战术指令连起来。

静态界面通过宿主 /runs 接口调用这里的 plugin_entry；主界面的角色通过 llm_tool 调用。
"""

from __future__ import annotations

import json
import threading
import time
from pathlib import Path
from typing import Any

from plugin.sdk.plugin import NekoPluginBase, Ok, lifecycle, llm_tool, neko_plugin, plugin_entry

from . import logic

_STATE_FRESH_SECONDS = 15
_MAX_PENDING_ORDERS = logic.MAX_QUEUE_ORDERS
_MAX_PENDING_CHEERS = 5
_MAX_PENDING_SAYS = 8


def _flag(value: Any, default: bool) -> bool:
    """宽松布尔解析，兼容前端传来的 1/0、"true"/"false"。"""

    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        text = value.strip().lower()
        if text in {"1", "true", "yes", "on", "enabled", "是", "开"}:
            return True
        if text in {"0", "false", "no", "off", "disabled", "否", "关"}:
            return False
    return default


def _int(value: Any, default: int, *, low: int, high: int) -> int:
    """把配置值收敛到 [low, high] 区间。"""

    try:
        number = int(value)
    except (TypeError, ValueError):
        return default
    return min(max(number, low), high)


def _runtime_settings(section: Any) -> dict[str, Any]:
    """把 plugin.toml 的 [neko_spacewar] 段解析成运行时设置。"""

    data = section if isinstance(section, dict) else {}
    name = str(data.get("wingman_name") or "").strip()[:24] or logic.DEFAULT_WINGMAN_NAME
    return {
        "wingman_name": name,
        "default_difficulty": logic.clamp_difficulty(data.get("difficulty")),
        "default_auto_fire": _flag(data.get("auto_fire"), True),
        "default_sfx": _flag(data.get("sfx_enabled"), True),
        "default_music": _flag(data.get("music_enabled"), True),
        "battle_sync": _flag(data.get("battle_sync_enabled"), True),
        "boss_comment": _flag(data.get("boss_comment_enabled"), True),
        "report_cooldown": _int(data.get("report_cooldown_seconds"), 20, low=0, high=600),
        "enable_llm_orders": _flag(data.get("enable_llm_orders"), True),
        "llm_chat": _flag(data.get("llm_chat_enabled"), True),
        "llm_banter": _flag(data.get("llm_banter_enabled"), True),
        "banter_cooldown": _int(data.get("banter_cooldown_seconds"), 25, low=0, high=600),
    }


@neko_plugin
class NekoSpaceWarPlugin(NekoPluginBase):
    """猫娘星海作战插件：存档、战报推送与主界面联动。"""

    def __init__(self, ctx):
        super().__init__(ctx)
        self._lock = threading.RLock()
        self._runtime = _runtime_settings(None)
        self._state: dict[str, Any] = {}
        self._state_ts = 0.0
        self._orders: list[dict[str, Any]] = []
        self._start_request: dict[str, Any] | None = None
        self._cheer_pending = 0
        self._order_seq = 0
        self._says: list[dict[str, Any]] = []
        self._say_seq = 0
        self._banter_ts = 0.0
        try:
            self.file_logger = self.enable_file_logging(log_level="INFO")
            self.logger = self.file_logger
        except Exception:  # noqa: BLE001 - 日志不可用时不能影响插件启动
            pass

    # ------------------------------------------------------------------ 生命周期

    @lifecycle(id="startup")
    async def on_startup(self, **_):
        """读取配置、注册静态界面、确保存档文件存在。"""

        try:
            cfg = await self.config.dump(timeout=5.0)
        except Exception as exc:  # noqa: BLE001 - 配置读不到就用默认值
            self._log("读取配置失败，使用默认设置: %s", exc)
            cfg = {}
        section = cfg.get(logic.PLUGIN_ID) if isinstance(cfg, dict) else None
        self._runtime = _runtime_settings(section)
        try:
            registered = self.register_static_ui("static")
            self._log("静态界面注册结果: %s", registered)
        except Exception as exc:  # noqa: BLE001
            self._log("静态界面注册失败: %s", exc)
        profile = self._load_profile()
        self._save_profile(profile)
        self._log("猫娘星海作战就绪：已累计 %s 局", profile["total_sorties"])

    @lifecycle(id="shutdown")
    async def on_shutdown(self, **_):
        """插件卸载前落盘档案，保证最后一次战绩不丢。"""

        try:
            self._save_profile(self._load_profile())
        finally:
            self._log("猫娘星海作战已卸载")

    # ------------------------------------------------------------------ 工具方法

    def _log(self, message: str, *args: Any) -> None:
        """安全日志：logger 不可用或格式串异常都不抛。"""

        logger = getattr(self, "logger", None)
        if logger is None:
            return
        try:
            logger.info(message % args if args else message)
        except Exception:  # noqa: BLE001
            pass

    def _profile_path(self) -> Path:
        return Path(self.data_path("profile.json"))

    def _load_profile(self) -> dict[str, Any]:
        """读档案；文件缺失或损坏时返回默认档案。"""

        with self._lock:
            try:
                raw = json.loads(self._profile_path().read_text(encoding="utf-8"))
            except (OSError, ValueError):
                raw = {}
            return logic.merge_profile(raw)

    def _save_profile(self, profile: dict[str, Any]) -> None:
        """原子写档案：先写临时文件再替换，避免写一半损坏。"""

        with self._lock:
            path = self._profile_path()
            try:
                path.parent.mkdir(parents=True, exist_ok=True)
                tmp = path.with_name(path.name + ".tmp")
                tmp.write_text(json.dumps(profile, ensure_ascii=False, indent=2), encoding="utf-8")
                tmp.replace(path)
            except OSError as exc:
                self._log("写入档案失败: %s", exc)

    def _profile_payload(self, profile: dict[str, Any]) -> dict[str, Any]:
        """档案 + 运行时设置，前端刷新一次就能拿到全部信息。"""

        payload = logic.profile_public(profile)
        payload["runtime"] = dict(self._runtime)
        payload["server_time"] = int(time.time())
        return payload

    def _store_state(self, state: Any) -> dict[str, Any]:
        """记录界面同步上来的战斗状态。"""

        raw = state if isinstance(state, dict) else {}
        summary = logic.state_summary(raw)
        summary["client_ts"] = logic.parse_timestamp(raw.get("client_ts")) or int(time.time())
        with self._lock:
            self._state = summary
            self._state_ts = time.time()
        return summary

    def _current_state(self) -> dict[str, Any]:
        """当前状态；超过 15 秒没同步就认为战斗已结束。"""

        with self._lock:
            state = dict(self._state)
            stamp = self._state_ts
        if not state:
            return logic.state_summary({})
        running = bool(state.get("running")) and (time.time() - stamp <= _STATE_FRESH_SECONDS)
        state["running"] = running
        return logic.state_summary(state)

    def _queue_order(self, order_id: str, reason: str, source: str = "llm") -> int:
        """把战术指令排进队列，返回当前队列长度。"""

        with self._lock:
            self._order_seq += 1
            self._orders.append(
                {
                    "id": self._order_seq,
                    "order": order_id,
                    "label": logic.ORDER_LABELS[order_id],
                    "reason": reason.strip()[:80],
                    "source": source,
                    "ts": int(time.time()),
                }
            )
            if len(self._orders) > _MAX_PENDING_ORDERS:
                self._orders = self._orders[-_MAX_PENDING_ORDERS:]
            return len(self._orders)

    def _poll(self, *, ui_open: bool, running: bool) -> dict[str, Any]:
        """领取排队中的指令 / 开局请求 / 打气 / 主界面猫娘说的话。"""

        orders: list[dict[str, Any]] = []
        cheer = 0
        says: list[dict[str, Any]] = []
        with self._lock:
            start = self._start_request if (ui_open and not running) else None
            if start is not None:
                self._start_request = None
            if running:
                orders = list(self._orders)
                self._orders.clear()
                cheer = self._cheer_pending
                self._cheer_pending = 0
            says = list(self._says)
            self._says.clear()
        return {
            "now": int(time.time()),
            "start_request": start,
            "orders": orders,
            "cheer": cheer,
            "says": says,
        }

    def _push(
        self,
        text: str,
        *,
        visibility: list[str] | None = None,
        ai_behavior: str = "respond",
        coalesce_key: str | None = None,
    ) -> tuple:
        """向主界面推送一条消息，返回 (是否提交成功, 原因)。

        visibility 含 "chat" 时主聊天会直接渲染这段文本；含 "hud" 时进 HUD 通知面板；
        空列表则只进模型的上下文（是否接话由 ai_behavior 决定）。
        """

        kwargs: dict[str, Any] = {
            "visibility": list(visibility or []),
            "ai_behavior": ai_behavior,
            "parts": [{"type": "text", "text": text}],
            "source": logic.PLUGIN_ID,
        }
        if coalesce_key:
            kwargs["coalesce_key"] = coalesce_key
        try:
            receipt = self.push_message(**kwargs)
        except Exception as exc:  # noqa: BLE001 - 推送失败不影响游戏
            self._log("推送消息失败: %s", exc)
            return False, f"error: {exc}"
        if isinstance(receipt, dict):
            return bool(receipt.get("submitted")), str(receipt.get("reason") or "")
        return bool(getattr(receipt, "submitted", False)), ""

    def _event_text(self, kind: str, data: dict[str, Any]) -> str:
        """战斗事件推送给主界面的文案（占位符由宿主展开）。"""

        wave_value = 1
        try:
            wave_value = max(1, int(data.get("wave") or 1))
        except (TypeError, ValueError):
            wave_value = 1
        difficulty = logic.DIFFICULTY_LABELS.get(logic.clamp_difficulty(data.get("difficulty")), "普通")
        if kind == "start":
            return (
                f"【星海作战】{{MASTER_NAME}} 刚开了一局《猫娘星海作战》（{difficulty} 难度），"
                f"{{LANLAN_NAME}} 也已经就位。"
            )
        if kind == "boss_spawn":
            return f"【星海作战】{{MASTER_NAME}} 那边遇上了母舰，第 {wave_value} 波进入 Boss 战。"
        return f"【星海作战】{{MASTER_NAME}} 刚击破了母舰（第 {wave_value} 波）！"

    # ------------------------------------------------------------------ 静态界面入口

    @plugin_entry(
        id="battle_get_profile",
        name="读取战机档案",
        description="静态界面启动时调用：读取战绩、设置、徽章与运行时设置。",
        timeout=20,
        metadata={"result_kind": "event", "expires_in_s": 30},
    )
    async def battle_get_profile(self, **_):
        return Ok(self._profile_payload(self._load_profile()))

    @plugin_entry(
        id="battle_set_settings",
        name="保存游戏设置",
        description="静态界面保存设置时调用：难度、自动开火、音效、音乐、是否推送战报。",
        timeout=20,
        metadata={"result_kind": "event", "expires_in_s": 30},
    )
    async def battle_set_settings(self, settings: Any = None, **_kwargs):
        raw = settings if isinstance(settings, dict) else {}
        if not raw:
            known = logic.default_settings()
            raw = {key: value for key, value in _kwargs.items() if key in known}
        profile = logic.apply_settings(self._load_profile(), raw)
        self._save_profile(profile)
        return Ok(self._profile_payload(profile))

    @plugin_entry(
        id="battle_reset_profile",
        name="清空战绩",
        description="静态界面「清空战绩」按钮调用：清空战绩与徽章，保留设置。",
        timeout=20,
        metadata={"result_kind": "event", "expires_in_s": 30},
    )
    async def battle_reset_profile(self, **_):
        profile = logic.reset_profile(self._load_profile())
        self._save_profile(profile)
        return Ok(self._profile_payload(profile))

    @plugin_entry(
        id="battle_sync_state",
        name="同步战斗状态",
        description="游戏界面每 4 秒调用：上报战斗状态，并领取主界面排队的战术指令、开局请求和打气。",
        timeout=20,
        metadata={"result_kind": "event", "expires_in_s": 30},
    )
    async def battle_sync_state(self, state: Any = None, ui_open: Any = False, **_):
        summary = self._store_state(state) if isinstance(state, dict) else self._current_state()
        poll = self._poll(ui_open=_flag(ui_open, False), running=bool(summary.get("running")))
        return Ok(
            {
                "poll": poll,
                "state": summary,
                "runtime": dict(self._runtime),
                "server_time": int(time.time()),
            }
        )

    @plugin_entry(
        id="battle_report",
        name="结算战报",
        description="一局结束时调用：结算分数、徽章、亲密度，并按设置把战报推送到主界面。",
        timeout=30,
    )
    async def battle_report(self, report: Any = None, **_):
        if not isinstance(report, dict):
            return Ok({"success": False, "summary": "战报数据缺失，本局没有结算。"})
        result = logic.settle_report(self._load_profile(), report)
        profile = result["profile"]
        card_pushed = False
        comment_pushed = False
        reason = ""
        if self._runtime["battle_sync"]:
            cooldown_ok = logic.should_push_report(
                profile.get("last_report_at"),
                time.time(),
                self._runtime["report_cooldown"],
            )
            if cooldown_ok:
                stamp = int(time.time())
                card_text = logic.battle_report_card_text(result)
                if card_text:
                    card_pushed, _ = self._push(
                        card_text,
                        visibility=["chat"],
                        ai_behavior="blind",
                        coalesce_key=f"{logic.PLUGIN_ID}:report_card",
                    )
                text = logic.battle_report_text(result, self._runtime["wingman_name"])
                comment_pushed, reason = self._push(
                    text,
                    ai_behavior="respond",
                    coalesce_key=f"{logic.PLUGIN_ID}:report",
                )
                if card_pushed or comment_pushed:
                    profile["last_report_at"] = stamp
            else:
                reason = "cooldown"
        pushed = card_pushed or comment_pushed
        self._save_profile(profile)
        payload = self._profile_payload(profile)
        return Ok(
            {
                "success": True,
                "summary": result["summary"],
                "report": result["report"],
                "new_record": result["new_record"],
                "previous_best": result["previous_best"],
                "new_achievements": result["new_achievements"],
                "affinity": result["affinity"],
                "affinity_gain": result["affinity_gain"],
                "affinity_level": result["affinity_level"],
                "level_up": result["level_up"],
                "rank": result["rank"],
                "best_score": payload["profile"]["best_score"],
                "achievements": payload["achievements"],
                "pushed": pushed,
                "card_pushed": card_pushed,
                "comment_pushed": comment_pushed,
                "push_reason": reason,
            }
        )

    @plugin_entry(
        id="battle_event",
        name="战斗事件",
        description="游戏内事件（开局/母舰出现/母舰击破）：按设置以只读方式告知主界面的猫娘。",
        timeout=20,
        metadata={"result_kind": "event", "expires_in_s": 30},
    )
    async def battle_event(self, event: Any = None, payload: Any = None, **_):
        kind = str(event or "").strip().lower()[:24]
        data = payload if isinstance(payload, dict) else {}
        if not self._runtime["boss_comment"]:
            return Ok({"success": False, "reason": "disabled"})
        if kind not in {"start", "boss_spawn", "boss_down"}:
            return Ok({"success": False, "reason": "unknown_event"})
        text = self._event_text(kind, data)
        visibility = ["hud"] if kind in {"boss_spawn", "boss_down"} else []
        pushed, reason = self._push(
            text,
            visibility=visibility,
            ai_behavior="read",
            coalesce_key=f"{logic.PLUGIN_ID}:{kind}",
        )
        return Ok({"success": pushed, "pushed": pushed, "visibility": visibility, "reason": reason})

    @plugin_entry(
        id="battle_chat",
        name="机内通讯",
        description=(
            "玩家在游戏里对猫娘说话时调用：把这句话转给主界面的猫娘本人，"
            "由她用宿主模型回应，并通过 spacewar_say 把回话送回游戏画面。"
        ),
        timeout=20,
        metadata={"result_kind": "event", "expires_in_s": 30},
    )
    async def battle_chat(self, message: Any = None, state: Any = None, **_):
        said = str(message or "").strip()[:400]
        if not said:
            return Ok({"success": False, "delegated": False, "summary": "没有说话内容，没有转达。"})
        if not self._runtime["llm_chat"]:
            return Ok(
                {
                    "success": False,
                    "delegated": False,
                    "reason": "disabled",
                    "summary": "机内通讯没有连到主界面的猫娘（设置里关掉了），这句话没有送出去。",
                }
            )
        snapshot = self._store_state(state) if isinstance(state, dict) else self._current_state()
        pushed, reason = self._push(
            logic.comm_relay_text(said, snapshot),
            ai_behavior="respond",
        )
        summary = (
            "已经转给主界面的猫娘，她回话时会通过 spacewar_say 出现在机内通讯面板里。"
            if pushed
            else f"没送出去（{reason}），稍后再试。"
        )
        return Ok(
            {
                "success": bool(pushed),
                "delegated": bool(pushed),
                "pushed": bool(pushed),
                "reason": reason,
                "reply": "",
                "message": said[:120],
                "summary": summary,
            }
        )

    @plugin_entry(
        id="battle_banter",
        name="情境搭话",
        description=(
            "战斗节点调用：开局、新一波开始、母舰出现/击破、装甲告急、高连击、本局结束时，"
            "触发主界面的猫娘主动说一句应景的话，她会把同一句台词通过 spacewar_say 送进游戏画面。"
        ),
        timeout=20,
        metadata={"result_kind": "event", "expires_in_s": 30},
    )
    async def battle_banter(self, kind: Any = None, state: Any = None, payload: Any = None, **_):
        if not self._runtime["llm_banter"]:
            return Ok({"success": False, "delegated": False, "reason": "disabled", "reply": ""})
        key = str(kind or "").strip().lower()[:24]
        if key not in logic.BANTER_KINDS:
            return Ok({"success": False, "delegated": False, "reason": "unknown_kind", "reply": ""})
        now = time.time()
        with self._lock:
            cooldown = float(self._runtime["banter_cooldown"])
            # 关键节点（开局 / 母舰 / 结束）一律放行：宁可多说一句，也不能漏掉。
            urgent = key in logic.URGENT_BANTER_KINDS
            if not urgent and cooldown > 0 and now - self._banter_ts < cooldown:
                return Ok({"success": False, "delegated": False, "reason": "cooldown", "reply": "", "kind": key})
            self._banter_ts = now
        snapshot = self._store_state(state) if isinstance(state, dict) else self._current_state()
        note = ""
        if isinstance(payload, dict):
            note = str(payload.get("note") or "")
        pushed, reason = self._push(
            logic.event_relay_text(key, snapshot, note),
            ai_behavior="respond",
            coalesce_key=f"{logic.PLUGIN_ID}:banter",
        )
        return Ok(
            {
                "success": bool(pushed),
                "delegated": bool(pushed),
                "pushed": bool(pushed),
                "kind": key,
                "reason": reason,
                "reply": "",
            }
        )

    @plugin_entry(
        id="battle_get_docs",
        name="读取说明文档",
        description="读取玩法、操作、战术指令、机制、联动与接口文档。",
        timeout=20,
        metadata={"result_kind": "event", "expires_in_s": 30},
    )
    async def battle_get_docs(self, topic: Any = "overview", **_):
        return Ok({"docs": logic.docs_catalog(), "section": logic.docs_text(topic)})

    # ------------------------------------------------------------------ LLM 工具

    @llm_tool(
        name="spacewar_status",
        description=(
            "查看《猫娘星海作战》的当前状态与玩家的战绩：是否在战斗中、第几波、得分、装甲、羁绊、"
            "历史最高分、军衔、亲密度、已解锁徽章和上一局战报。玩家问「现在打到哪了」「我战绩怎么样」时使用。"
        ),
        parameters={"type": "object", "properties": {}},
        timeout=15,
    )
    async def spacewar_status(self, **_):
        profile = self._load_profile()
        public = logic.profile_public(profile)
        state = self._current_state()
        unlocked = [item for item in public["achievements"] if item["unlocked"]]
        if state["running"]:
            summary = state["text"]
        else:
            summary = (
                f"现在不在战斗中。历史最高 {profile['best_score']:,} 分（{public['rank']}），"
                f"累计 {profile['total_sorties']} 局，亲密度 Lv.{public['affinity_level']}，"
                f"已解锁 {len(unlocked)}/{len(public['achievements'])} 枚徽章。"
            )
        output = {
            "ok": True,
            "playing": state["running"],
            "summary": summary,
            "state": state,
            "profile": {
                "best_score": profile["best_score"],
                "best_wave": profile["best_wave"],
                "best_combo": profile["best_combo"],
                "total_sorties": profile["total_sorties"],
                "total_kills": profile["total_kills"],
                "boss_kills": profile["boss_kills"],
                "ultimates_used": profile["ultimates_used"],
                "affinity": profile["affinity"],
                "affinity_level": public["affinity_level"],
                "rank": public["rank"],
                "achievements_unlocked": len(unlocked),
                "achievements_total": len(public["achievements"]),
            },
            "recent_report": profile["last_report_text"][-400:],
            "orders": logic.order_catalog(),
            "difficulties": logic.difficulty_catalog(),
        }
        return {"output": output, "is_error": False}

    @llm_tool(
        name="spacewar_command",
        description=(
            "向《猫娘星海作战》排队一条战术指令：shield/护盾、focus/集火、repair/维修、ultimate/猫猫星爆。"
            "玩家在聊天里让你「开盾」「集火那家伙」「放大招」时使用；游戏界面 4 秒内会自动领取并执行。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "order": {
                    "type": "string",
                    "description": "指令：shield/focus/repair/ultimate，或 护盾/集火/维修/必杀 等中文说法。",
                },
                "reason": {"type": "string", "description": "为什么下这条指令，一句话即可。"},
            },
            "required": ["order"],
        },
        timeout=15,
    )
    async def spacewar_command(self, order: Any = None, reason: Any = None, **_):
        order_id = logic.normalize_order_id(order)
        if not order_id:
            return {
                "output": {
                    "ok": False,
                    "summary": "没听懂这条战术指令：只支持护盾、集火、维修、猫猫星爆。",
                },
                "is_error": False,
            }
        if not self._runtime["enable_llm_orders"]:
            return {
                "output": {"ok": False, "summary": "玩家在设置里关掉了「让猫娘下达战术指令」。"},
                "is_error": False,
            }
        queued = self._queue_order(order_id, str(reason or ""))
        state = self._current_state()
        return {
            "output": {
                "ok": True,
                "order": order_id,
                "label": logic.ORDER_LABELS[order_id],
                "queued": queued,
                "playing": state["running"],
                "summary": logic.command_ack_text(order_id, state["running"], state),
            },
            "is_error": False,
        }

    @llm_tool(
        name="spacewar_launch",
        description=(
            "在《猫娘星海作战》里预约一局：玩家下次打开游戏界面时自动开始，可选难度。"
            "玩家说「陪我打一局」「来局太空战」时使用。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "difficulty": {
                    "type": "string",
                    "enum": ["easy", "normal", "hard"],
                    "description": "难度，默认 normal。",
                }
            },
        },
        timeout=15,
    )
    async def spacewar_launch(self, difficulty: Any = "normal", **_):
        level = logic.clamp_difficulty(difficulty)
        with self._lock:
            self._start_request = {"difficulty": level, "requested_at": int(time.time()), "source": "llm"}
        return {
            "output": {"ok": True, "difficulty": level, "summary": logic.launch_ack_text(level)},
            "is_error": False,
        }

    @llm_tool(
        name="spacewar_cheer",
        description=(
            "给正在打《猫娘星海作战》的玩家打气：游戏里 4 秒内会弹出你的鼓励，并补 2 点羁绊。"
            "同一场战斗里 15 秒才能打一次气（用来加油，不是用来刷羁绊的）。"
            "玩家打得很辛苦、或者你只是想为TA加油时使用。"
        ),
        parameters={"type": "object", "properties": {}},
        timeout=15,
    )
    async def spacewar_cheer(self, **_):
        with self._lock:
            self._cheer_pending = min(self._cheer_pending + 1, _MAX_PENDING_CHEERS)
            pending = self._cheer_pending
        return {
            "output": {"ok": True, "pending": pending, "summary": logic.cheer_ack_text()},
            "is_error": False,
        }


    @llm_tool(
        name="spacewar_say",
        description=(
            "对正在玩《猫娘星海作战》的玩家说一句话：内容会在 4 秒内出现在游戏里的机内通讯面板。"
            "机内通讯把她的话转给你、或者游戏里的战况提醒你开口时，必须用这个工具把台词送回去——"
            "只在聊天里说，游戏画面里是听不到的。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "text": {"type": "string", "description": "要对玩家说的中文短句，一到两句，不要带引号。"}
            },
            "required": ["text"],
        },
        timeout=15,
    )
    async def spacewar_say(self, text: Any = None, **_):
        said = str(text or "").strip()[:200]
        if not said:
            return {"output": {"ok": False, "summary": "没有说话内容。"}, "is_error": False}
        with self._lock:
            self._say_seq += 1
            self._says.append({"id": self._say_seq, "text": said, "ts": int(time.time())})
            if len(self._says) > _MAX_PENDING_SAYS:
                self._says = self._says[-_MAX_PENDING_SAYS:]
            pending = len(self._says)
        return {
            "output": {
                "ok": True,
                "queued": pending,
                "summary": "这句话会在 4 秒内出现在游戏里的机内通讯面板。",
            },
            "is_error": False,
        }

    @llm_tool(
        name="spacewar_docs",
        description=(
            "读取《猫娘星海作战》的说明文档：玩法、操作、战术指令、数值机制、与主界面的联动、接口与存档。"
            "玩家问游戏怎么玩、怎么操作、指令是什么时，先读这里再回答，不要凭空编。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "topic": {
                    "type": "string",
                    "enum": list(logic.DOC_SECTIONS.keys()),
                    "description": "文档小节，默认 overview。",
                }
            },
        },
        timeout=15,
    )
    async def spacewar_docs(self, topic: Any = "overview", **_):
        section = logic.docs_text(topic)
        return {
            "output": {
                "ok": True,
                "docs": logic.docs_catalog(),
                "topic": section["topic"],
                "title": section["title"],
                "content": section["content"],
            },
            "is_error": False,
        }


__all__ = ["NekoSpaceWarPlugin"]
