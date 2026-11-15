"""猫娘星海作战的纯逻辑层。

这个模块不依赖 N.E.K.O 的插件运行时，也不做任何 IO：所有函数都是纯函数，或者只操作传入的
 dict，方便单元测试与复用。插件入口（__init__.py）负责把这里的返回值包装成 Ok /
push_message；静态界面（static/）是同一套规则的浏览器端实现。
"""

from __future__ import annotations

import math
import time
from datetime import datetime
from typing import Any

PLUGIN_ID = "neko_spacewar"
GAME_VERSION = "0.2.0"
PROFILE_VERSION = 1

DIFFICULTIES: tuple[str, ...] = ("easy", "normal", "hard")
DIFFICULTY_LABELS = {"easy": "轻松", "normal": "普通", "hard": "硬核"}

ORDER_IDS: tuple[str, ...] = ("shield", "focus", "repair", "ultimate")
ORDER_LABELS = {
    "shield": "护盾展开",
    "focus": "集火指令",
    "repair": "紧急维修",
    "ultimate": "猫猫星爆",
}
ORDER_COSTS = {"shield": 32, "focus": 38, "repair": 55, "ultimate": 95}
ORDER_COOLDOWNS = {"shield": 24, "focus": 28, "repair": 40, "ultimate": 75}
ORDER_HINTS = {
    "shield": "2.2 秒无敌并清除身边的弹幕",
    "focus": "让僚机无人机对最强目标连续激光 3.5 秒",
    "repair": "恢复 1 点装甲（上限 5 点）",
    "ultimate": "2.2 秒全屏光束，清弹并重创所有敌人",
}
ORDER_ALIASES: dict[str, tuple[str, ...]] = {
    "shield": ("shield", "护盾", "开盾", "防御", "盾", "无敌"),
    "focus": ("focus", "集火", "攻击", "集中火力", "打它", "锁定"),
    "repair": ("repair", "维修", "修理", "治疗", "回血", "补甲", "加血"),
    "ultimate": ("ultimate", "必杀", "大招", "星爆", "终极", "终极技能", "猫猫星爆"),
}

DEFAULT_WINGMAN_NAME = "猫娘"
MAX_QUEUE_ORDERS = 8

AFFINITY_LEVEL_STEP = 100
_RANKS: tuple[tuple[int, str], ...] = (
    (30_000, "星海传奇"),
    (15_000, "银河老兵"),
    (7_000, "星际游骑"),
    (3_000, "巡航舰员"),
    (0, "列兵"),
)

_ACHIEVEMENTS: tuple[dict[str, str], ...] = (
    {"id": "first_sortie", "name": "初次出击", "description": "完成第一局星海作战。"},
    {"id": "sortie_10", "name": "十次出击", "description": "累计完成 10 局。"},
    {"id": "wave_5", "name": "深空行者", "description": "单局坚持到第 5 波。"},
    {"id": "wave_10", "name": "星海长驱", "description": "单局坚持到第 10 波。"},
    {"id": "hard_wave_10", "name": "硬核幸存者", "description": "硬核难度下坚持到第 10 波。"},
    {"id": "boss_slayer", "name": "首杀旗舰", "description": "击破第一艘母舰。"},
    {"id": "boss_3", "name": "旗舰猎手", "description": "累计击破 3 艘母舰。"},
    {"id": "combo_20", "name": "连击达人", "description": "单局最高连击达到 20。"},
    {"id": "score_10k", "name": "万分舰长", "description": "单局得分达到 10000。"},
    {"id": "score_50k", "name": "五万王牌", "description": "单局得分达到 50000。"},
    {"id": "flawless_5", "name": "五波无伤", "description": "不被打中，坚持到第 5 波。"},
    {"id": "ultimate_3", "name": "星爆三连", "description": "单局使用 3 次猫猫星爆。"},
    {"id": "bond_full", "name": "满羁绊", "description": "单局羁绊峰值达到 100。"},
    {"id": "kills_100", "name": "百机击毁", "description": "累计击毁 100 架敌机。"},
    {"id": "kills_500", "name": "五百机击毁", "description": "累计击毁 500 架敌机。"},
    {"id": "affinity_5", "name": "默契搭档", "description": "亲密度达到 Lv.5。"},
)

_PROFILE_NUMERIC_LIMITS = {
    "best_score": 9_999_999,
    "best_wave": 9_999,
    "total_sorties": 999_999,
    "total_kills": 9_999_999,
    "boss_kills": 999_999,
    "total_duration_seconds": 99_999_999,
    "best_combo": 99_999,
    "ultimates_used": 999_999,
    "affinity": 9_999_999,
    "last_report_at": 99_999_999_999,
}

_MAX_STRING = 64
_MAX_MESSAGE = 400


def _num(value: Any) -> float | None:
    """把任意输入尽量转成有限的浮点数，失败返回 None。"""

    if value is None or isinstance(value, (dict, list, tuple, set)):
        return None
    if isinstance(value, bool):
        return float(int(value))
    if isinstance(value, (int, float)):
        number = float(value)
    else:
        try:
            number = float(str(value).strip().replace(",", ""))
        except (TypeError, ValueError):
            return None
    return number if math.isfinite(number) else None


def _int(value: Any, default: int = 0, *, low: int = 0, high: int = 99_999_999) -> int:
    """把任意输入转成 [low, high] 区间内的整数，无法解析时用默认值。"""

    number = _num(value)
    if number is None:
        return default
    return min(max(int(round(number)), low), high)


def _text(value: Any, default: str = "", *, limit: int = _MAX_STRING) -> str:
    """转成去首尾空白的短字符串。"""

    if value is None:
        return default
    text = str(value).strip()
    return text[:limit] if text else default


def _as_bool(value: Any, default: bool = False) -> bool:
    """宽松布尔解析：兼容 1/0、on/off、yes/no 这类前端传值。"""

    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    text = str(value).strip().lower()
    if text in {"1", "true", "yes", "on", "enabled", "是", "开"}:
        return True
    if text in {"0", "false", "no", "off", "disabled", "否", "关"}:
        return False
    return default


def clamp_difficulty(value: Any) -> str:
    """把输入规整成合法的难度键，未知时回落到 normal。"""

    text = _text(value, "normal", limit=16).lower()
    if text in DIFFICULTY_LABELS:
        return text
    for key, label in DIFFICULTY_LABELS.items():
        if text == label:
            return key
    return "normal"


def normalize_order_id(value: Any) -> str:
    """把玩家的说法（含中文别名）归一成战术指令 id。"""

    text = _text(value, "", limit=32).lower()
    if not text:
        return ""
    if text in ORDER_LABELS:
        return text
    for order_id, aliases in ORDER_ALIASES.items():
        if text in aliases:
            return order_id
    for order_id, aliases in ORDER_ALIASES.items():
        if any(alias in text for alias in aliases):
            return order_id
    for order_id, label in ORDER_LABELS.items():
        if label in text:
            return order_id
    return ""


def order_catalog() -> list[dict[str, Any]]:
    """返回战术指令列表，供界面和文档使用。"""

    return [
        {
            "id": order_id,
            "label": ORDER_LABELS[order_id],
            "cost": ORDER_COSTS[order_id],
            "cooldown": ORDER_COOLDOWNS[order_id],
            "hint": ORDER_HINTS[order_id],
        }
        for order_id in ORDER_IDS
    ]


def difficulty_catalog() -> list[dict[str, Any]]:
    """返回难度列表，供界面和文档使用。"""

    return [
        {"id": key, "label": label, "level": DIFFICULTIES.index(key) + 1}
        for key, label in DIFFICULTY_LABELS.items()
    ]


def default_settings() -> dict[str, Any]:
    """新存档的默认设置。"""

    return {
        "difficulty": "normal",
        "auto_fire": True,
        "sfx": True,
        "music": True,
        "battle_sync": True,
        "llm_chat": True,
        "llm_banter": True,
    }


def default_profile() -> dict[str, Any]:
    """一份全新的玩家档案。"""

    stamp = int(time.time())
    return {
        "version": PROFILE_VERSION,
        "created_at": stamp,
        "updated_at": stamp,
        "settings": default_settings(),
        "affinity": 0,
        "best_score": 0,
        "best_wave": 0,
        "best_combo": 0,
        "total_sorties": 0,
        "total_kills": 0,
        "boss_kills": 0,
        "total_duration_seconds": 0,
        "ultimates_used": 0,
        "achievements": [],
        "achievement_times": {},
        "last_session_at": stamp,
        "last_report_at": 0,
        "last_report_text": "",
    }


def _iso_to_timestamp(text: str) -> int | None:
    """把有限几种 ISO 写法转成 Unix 秒。"""

    cleaned = text.strip()
    if not cleaned:
        return None
    if cleaned.endswith("Z"):
        cleaned = cleaned[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(cleaned)
    except ValueError:
        return None
    return int(parsed.timestamp())


def parse_timestamp(value: Any) -> int | None:
    """解析时间戳：支持秒/毫秒/ISO 字符串，失败返回 None。"""

    number = _num(value)
    if number is not None:
        stamp = int(number)
        if stamp > 10_000_000_000:
            stamp = int(stamp / 1000)
        return min(max(stamp, 0), 99_999_999_999)
    text = _text(value, "", limit=40)
    if not text:
        return None
    return _iso_to_timestamp(text)


def merge_settings(raw: Any, *, defaults: dict[str, Any] | None = None) -> dict[str, Any]:
    """合并设置：只接受已知键，非法值回落到默认值。"""

    base = merge_settings_default(defaults)
    settings = default_settings()
    for key, value in base.items():
        if key in settings:
            settings[key] = value
    data = raw if isinstance(raw, dict) else {}
    settings["difficulty"] = clamp_difficulty(data.get("difficulty", settings["difficulty"]))
    for key in ("auto_fire", "sfx", "music", "battle_sync", "llm_chat", "llm_banter"):
        settings[key] = _as_bool(data.get(key), _as_bool(settings[key], True))
    return settings


def merge_settings_default(defaults: Any) -> dict[str, Any]:
    """把外部设置收敛成已知键的副本。"""

    settings = default_settings()
    if isinstance(defaults, dict):
        for key, value in defaults.items():
            if key in settings:
                settings[key] = value
    return settings


def merge_profile(raw: Any, *, now: int | None = None) -> dict[str, Any]:
    """把磁盘上的（可能损坏/旧版的）档案合并成完整档案。"""

    stamp = int(now if now is not None else time.time())
    profile = default_profile()
    data = raw if isinstance(raw, dict) else {}

    profile["version"] = PROFILE_VERSION
    created = parse_timestamp(data.get("created_at")) or stamp
    profile["created_at"] = created
    profile["updated_at"] = parse_timestamp(data.get("updated_at")) or created
    profile["last_session_at"] = parse_timestamp(data.get("last_session_at")) or 0

    for key, limit in _PROFILE_NUMERIC_LIMITS.items():
        profile[key] = _int(data.get(key), 0, high=limit)

    profile["settings"] = merge_settings(data.get("settings"))
    profile["last_report_text"] = _text(data.get("last_report_text"), "", limit=2000)

    unlocked: list[str] = []
    seen: set[str] = set()
    raw_achievements = data.get("achievements")
    if isinstance(raw_achievements, (list, tuple)):
        for item in raw_achievements:
            achievement_id = _text(item, "", limit=64)
            if achievement_id in ACHIEVEMENT_IDS and achievement_id not in seen:
                seen.add(achievement_id)
                unlocked.append(achievement_id)
    profile["achievements"] = unlocked

    times: dict[str, int] = {}
    raw_times = data.get("achievement_times")
    if isinstance(raw_times, dict):
        for achievement_id, value in raw_times.items():
            key = _text(achievement_id, "", limit=64)
            stamp_value = parse_timestamp(value)
            if key in ACHIEVEMENT_IDS and key in seen and stamp_value:
                times[key] = stamp_value
    profile["achievement_times"] = times
    profile["updated_at"] = max(profile["updated_at"], profile["created_at"])
    return profile


def apply_settings(profile: dict[str, Any], settings: Any) -> dict[str, Any]:
    """把界面提交的设置合并进档案并返回新档案（不修改入参）。"""

    merged = merge_profile(profile)
    merged["settings"] = merge_settings(settings, defaults=merged["settings"])
    merged["updated_at"] = parse_timestamp(time.time()) or merged["updated_at"]
    return merged


def reset_profile(profile: Any = None, *, now: int | None = None) -> dict[str, Any]:
    """清空战绩与徽章，但保留界面设置。"""

    fresh = default_profile()
    fresh["created_at"] = fresh["updated_at"] = int(now if now is not None else time.time())
    if isinstance(profile, dict):
        fresh["settings"] = merge_settings(profile.get("settings"))
    return fresh


ACHIEVEMENT_IDS = frozenset(item["id"] for item in _ACHIEVEMENTS)


def achievement_catalog() -> list[dict[str, str]]:
    """全部徽章定义（不含状态）。"""

    return [dict(item) for item in _ACHIEVEMENTS]


def achievement_flags(profile: dict[str, Any]) -> list[dict[str, Any]]:
    """徽章定义 + 玩家是否解锁。"""

    normalized = merge_profile(profile)
    unlocked = set(normalized["achievements"])
    times = normalized["achievement_times"]
    flags: list[dict[str, Any]] = []
    for item in _ACHIEVEMENTS:
        flags.append(
            {
                "id": item["id"],
                "name": item["name"],
                "description": item["description"],
                "unlocked": item["id"] in unlocked,
                "unlocked_at": times.get(item["id"], 0),
            }
        )
    return flags


def affinity_level(affinity: Any) -> int:
    """亲密度等级：每 100 点一级，0 点也是 1 级。"""

    points = _int(affinity, 0, high=_PROFILE_NUMERIC_LIMITS["affinity"])
    return 1 + points // AFFINITY_LEVEL_STEP


def rank_for_score(score: Any) -> str:
    """按历史最高分给出军衔名。"""

    best = _int(score, 0, high=_PROFILE_NUMERIC_LIMITS["best_score"])
    for threshold, name in _RANKS:
        if best >= threshold:
            return name
    return _RANKS[-1][1]


def _achievement_met(achievement_id: str, profile: dict[str, Any], report: dict[str, Any]) -> bool:
    """判断某条徽章条件在当前档案 + 本局战报下是否满足。"""

    if achievement_id == "first_sortie":
        return profile["total_sorties"] >= 1
    if achievement_id == "sortie_10":
        return profile["total_sorties"] >= 10
    if achievement_id == "wave_5":
        return report["wave"] >= 5
    if achievement_id == "wave_10":
        return report["wave"] >= 10
    if achievement_id == "hard_wave_10":
        return report["difficulty"] == "hard" and report["wave"] >= 10
    if achievement_id == "boss_slayer":
        return profile["boss_kills"] >= 1
    if achievement_id == "boss_3":
        return profile["boss_kills"] >= 3
    if achievement_id == "combo_20":
        return report["max_combo"] >= 20
    if achievement_id == "score_10k":
        return profile["best_score"] >= 10_000
    if achievement_id == "score_50k":
        return profile["best_score"] >= 50_000
    if achievement_id == "flawless_5":
        return report["wave"] >= 5 and report["hits_taken"] == 0 and report["kills"] >= 20
    if achievement_id == "ultimate_3":
        return report["ultimates_used"] >= 3
    if achievement_id == "bond_full":
        return report["bond_peak"] >= 100
    if achievement_id == "kills_100":
        return profile["total_kills"] >= 100
    if achievement_id == "kills_500":
        return profile["total_kills"] >= 500
    if achievement_id == "affinity_5":
        return profile["affinity"] >= AFFINITY_LEVEL_STEP * 5
    return False


def settle_report(profile: Any, report: Any, *, now: int | None = None) -> dict[str, Any]:
    """结算一局：更新档案并返回战报摘要、新徽章等。"""

    stamp = int(now if now is not None else time.time())
    current = merge_profile(profile, now=stamp)
    raw = report if isinstance(report, dict) else {}

    raw_orders = raw.get("used_orders")
    used_orders = [
        order_id
        for order_id in ORDER_IDS
        if isinstance(raw_orders, dict) and _int(raw_orders.get(order_id), 0) > 0
    ]
    payload = {
        "score": _int(raw.get("score"), 0, high=9_999_999),
        "wave": _int(raw.get("wave"), 1, low=1, high=9_999),
        "kills": _int(raw.get("kills"), 0, high=999_999),
        "boss_kills": _int(raw.get("boss_kills"), 0, high=9_999),
        "max_combo": _int(raw.get("max_combo"), 0, high=99_999),
        "duration_seconds": _int(raw.get("duration_seconds"), 0, high=999_999),
        "hits_taken": _int(raw.get("hits_taken"), 0, high=999_999),
        "ultimates_used": _int(raw.get("ultimates_used"), 0, high=99_999),
        "bond_peak": _int(raw.get("bond_peak"), 0, high=100),
        "difficulty": clamp_difficulty(raw.get("difficulty")),
        "used_orders": used_orders,
    }

    previous_best = current["best_score"]
    new_record = payload["score"] > previous_best
    current["best_score"] = max(previous_best, payload["score"])
    current["best_wave"] = max(current["best_wave"], payload["wave"])
    current["best_combo"] = max(current["best_combo"], payload["max_combo"])
    current["total_sorties"] += 1
    current["total_kills"] += payload["kills"]
    current["boss_kills"] += payload["boss_kills"]
    current["total_duration_seconds"] += payload["duration_seconds"]
    current["ultimates_used"] += payload["ultimates_used"]

    affinity_gain = 3
    affinity_gain += 1 if payload["wave"] >= 5 else 0
    affinity_gain += 2 if payload["wave"] >= 10 else 0
    affinity_gain += min(payload["boss_kills"], 3)
    affinity_gain += min(payload["max_combo"] // 20, 3)
    affinity_gain += min(payload["score"] // 10_000, 3)

    level_before = affinity_level(current["affinity"])
    current["affinity"] = min(
        current["affinity"] + affinity_gain,
        _PROFILE_NUMERIC_LIMITS["affinity"],
    )
    level_after = affinity_level(current["affinity"])

    new_achievements: list[dict[str, str]] = []
    known = set(current["achievements"])
    for item in _ACHIEVEMENTS:
        achievement_id = item["id"]
        if achievement_id in known or not _achievement_met(achievement_id, current, payload):
            continue
        current["achievements"].append(achievement_id)
        current["achievement_times"][achievement_id] = stamp
        new_achievements.append(dict(item))

    current["last_session_at"] = stamp
    current["updated_at"] = stamp
    result = {
        "profile": current,
        "report": payload,
        "new_record": new_record,
        "previous_best": previous_best,
        "affinity_gain": affinity_gain,
        "affinity": current["affinity"],
        "affinity_level": level_after,
        "level_up": level_after > level_before,
        "rank": rank_for_score(current["best_score"]),
        "new_achievements": new_achievements,
    }
    result["summary"] = summarize_run(result)
    current["last_report_text"] = result["summary"]
    return result


def _fmt_duration(seconds: Any) -> str:
    total = _int(seconds, 0, high=999_999)
    minutes, rest = divmod(total, 60)
    return f"{minutes}分{rest:02d}秒"


def summarize_run(result: dict[str, Any], wingman_name: str = DEFAULT_WINGMAN_NAME) -> str:
    """把结算结果压成一句给猫娘看的话（也可用作主界面推送摘要）。"""

    report = result.get("report") or {}
    parts = [
        f"《猫娘星海作战》第 {report.get('wave', 1)} 波结束",
        f"得分 {report.get('score', 0):,}",
        f"击毁 {report.get('kills', 0)} 架",
        f"母舰 {report.get('boss_kills', 0)} 艘",
        f"最高连击 {report.get('max_combo', 0)}",
        f"用时 {_fmt_duration(report.get('duration_seconds', 0))}",
        f"难度 {DIFFICULTY_LABELS.get(report.get('difficulty', 'normal'), '普通')}",
    ]
    if result.get("new_record"):
        parts.append("刷新了历史最高分")
    if result.get("new_achievements"):
        names = "、".join(item["name"] for item in result["new_achievements"])
        parts.append(f"解锁徽章：{names}")
    return "，".join(parts) + f"（{wingman_name}陪你打完了这一局）"


def battle_report_text(result: dict[str, Any], wingman_name: str = DEFAULT_WINGMAN_NAME) -> str:
    """构造推送到主界面的战报正文（占位符由宿主展开）。"""

    report = result.get("report") or {}
    best_score = result.get("profile", {}).get("best_score", 0)
    lines = [
        "【星海作战·战报】{MASTER_NAME} 刚和你并肩打完一局《猫娘星海作战》：",
        (
            f"- 得分 {report.get('score', 0):,}（历史最高 {best_score:,}）"
            f" · 第 {report.get('wave', 1)} 波"
            f" · 难度 {DIFFICULTY_LABELS.get(report.get('difficulty', 'normal'), '普通')}"
        ),
        (
            f"- 击毁 {report.get('kills', 0)} 架敌机，击破母舰 {report.get('boss_kills', 0)} 艘，"
            f"最高连击 {report.get('max_combo', 0)}"
        ),
        (
            f"- 用时 {_fmt_duration(report.get('duration_seconds', 0))}"
            f" · 被击中 {report.get('hits_taken', 0)} 次"
            f" · 羁绊峰值 {report.get('bond_peak', 0)}/100"
            f" · 猫猫星爆 {report.get('ultimates_used', 0)} 次"
        ),
    ]
    if result.get("new_record"):
        lines.append(f"- 新纪录！超过了之前的 {result.get('previous_best', 0):,} 分")
    if result.get("new_achievements"):
        names = "、".join(item["name"] for item in result["new_achievements"])
        lines.append(f"- 新徽章：{names}")
    lines.append(
        f"- 军衔：{result.get('rank', '列兵')} · 与你的亲密度 Lv.{result.get('affinity_level', 1)}"
        f"（+{result.get('affinity_gain', 0)}）"
    )
    lines.append(
        "请用 {LANLAN_NAME} 的语气，对 {MASTER_NAME} 说一两句：像并肩打完一局的搭档那样，"
        "自然点评这局的表现（可以夸、可以吐槽、可以约下一局），不要念上面的数据清单，"
        "也不要提「插件」「系统」「接口」这些词。"
    )
    return "\n".join(lines)


def _state_brief(state: Any) -> str:
    """一句话描述当前的战斗状态（把打起来才知道的信息也带上，免得她凭空脑补）。"""

    if not isinstance(state, dict) or not state.get("running"):
        return "现在不在战斗中"
    bits = [
        f"第 {_int(state.get('wave'), 1, low=1)} 波",
        f"得分 {_int(state.get('score'), 0):,}",
        f"装甲 {_int(state.get('hull_integrity'), 3)}/{_int(state.get('max_hull'), 3)}",
        f"羁绊 {_int(state.get('bond'), 0)}/100",
        f"难度 {DIFFICULTY_LABELS.get(clamp_difficulty(state.get('difficulty')), '普通')}",
    ]
    if state.get("kills") is not None:
        bits.append(f"本局击毁 {_int(state.get('kills'), 0)} 架")
    if state.get("hits_taken") is not None:
        bits.append(f"被打中 {_int(state.get('hits_taken'), 0)} 次")
    if _int(state.get("combo"), 0) > 0:
        bits.append(f"连击 {_int(state.get('combo'), 0)}")
    if state.get("power") is not None:
        bits.append(f"火力 {min(3, max(1, _int(state.get('power'), 1)))}/3 级")
    on_screen = _int(state.get("enemies"), 0)
    waiting = _int(state.get("enemies_left"), 0)
    if on_screen or waiting:
        bits.append(f"场上 {on_screen} 架敌机、还有 {waiting} 架没出来")
    if state.get("boss_active"):
        max_hp = _int(state.get("boss_max_hp"), 0)
        hp = _int(state.get("boss_hp"), 0)
        percent = round(hp * 100 / max_hp) if max_hp > 0 else 0
        bits.append(f"母舰还在，剩 {percent}% 装甲")
    if _int(state.get("elapsed"), 0) > 0:
        bits.append(f"本局打了 {_fmt_duration(state.get('elapsed'))}")
    return "现在是" + bits[0] + "，" + "，".join(bits[1:])


# 她只能看到游戏同步过来的东西：这句话用来压住「凭想象编战况」的毛病
_BATTLE_FACTS_RULE = (
    "括号里是游戏同步过来的真实战况，你只能依据它说话；"
    "没写到的（他刚才在不在躲、有没有在输出、敌人下一步要干什么）你并不知道，绝对不要编。"
)


def comm_relay_text(message: Any, state: Any = None) -> str:
    """把游戏里的机内通讯转给主界面猫娘时用的文本（走 ``ai_behavior="respond"``）。

    插件自己不生成台词：这段话进主界面猫娘的上下文并触发她本人说话，同时要求她调用
    ``spacewar_say`` 把同一句台词送进游戏内的机内通讯面板，做到「一个人、两个画面」。
    """

    said = _text(message, "", limit=_MAX_MESSAGE)
    return (
        "【星海作战 · 机内通讯】{MASTER_NAME} 正在玩《猫娘星海作战》，"
        "刚刚在游戏里的机内通讯对你说：「" + said + "」\n"
        "（" + _state_brief(state) + "）\n"
        + _BATTLE_FACTS_RULE
        + "\n现在就用你自己的身份回他一句，一到两句、口语、有精神；"
        "同时调用 spacewar_say 把这句台词的原文送进游戏里的机内通讯面板，"
        "让游戏画面里也出现这句话。不要提「插件」「接口」「模型」这些词。"
    )


def command_ack_text(order_id: str, running: bool, state: Any = None) -> str:
    """LLM 工具下达指令后返回给模型的一句话。"""

    label = ORDER_LABELS.get(order_id, "战术指令")
    if running:
        return f"已经把「{label}」排进舰载队列，游戏里 4 秒内生效（{_state_brief(state)}）。"
    return f"现在不在战斗中，已经把「{label}」准备好，下一局开始后第一次同步时执行。"


def launch_ack_text(difficulty: str) -> str:
    """LLM 工具预约开局后返回给模型的一句话。"""

    label = DIFFICULTY_LABELS.get(clamp_difficulty(difficulty), "普通")
    return f"已经在《猫娘星海作战》里预约了一局（{label} 难度）：玩家下次打开界面会自动开始。"


def cheer_ack_text() -> str:
    """LLM 工具打气后返回给模型的一句话。"""

    return "打气已经传达：你的鼓励 4 秒内会出现在游戏画面里（羁绊 +2、士气 +1，同一场战斗里 15 秒才能打一次气）。"


# 能触发主界面猫娘主动喊话的战斗节点；顺序与 :func:`banter_situation` 一致。
BANTER_KINDS: tuple[str, ...] = ("start", "wave", "boss_spawn", "boss_down", "low_hull", "combo", "run_over")

# 这些节点不受「两次搭话最小间隔」限制：错过就补不回来了。
URGENT_BANTER_KINDS: frozenset[str] = frozenset({"start", "boss_spawn", "boss_down", "run_over"})


def event_relay_text(kind: Any, state: Any = None, note: Any = "") -> str:
    """战斗节点触发主界面猫娘主动说话时用的文本（走 ``ai_behavior="respond"``）。

    与 :func:`comm_relay_text` 的分工：这个走「主动开口」，机内通讯走「回应玩家」。
    两者都要求她调用 ``spacewar_say``，所以游戏画面里出现的永远是同一个人的同一句话。
    """

    situation = banter_situation(kind, state)
    extra = _text(note, "", limit=120)
    tail = ("（补充：" + extra + "）\n") if extra else ""
    key = _text(kind, "", limit=32).lower()
    if key == "run_over":
        ask = (
            "这一局刚结束，他大概正看着战报。用你自己的身份主动说两句：先安慰或调侃一句，"
            "再给他一句下次怎么打会更稳的建议，别念数据；"
            "同时调用 spacewar_say 把这句话的原文送进游戏里的机内通讯面板。"
        )
    else:
        ask = (
            "现在就用你自己的身份主动对他说一句应景的短台词，像实时喊话，一句就够；"
            "可以自然带一句括号里的数字，但别整段念；"
            "同时调用 spacewar_say 把这句台词的原文送进游戏里的机内通讯面板。"
        )
    return (
        "【星海作战 · 战况】{MASTER_NAME} 正在玩《猫娘星海作战》，此刻的情况：" + situation + "。\n"
        "（" + _state_brief(state) + "）\n"
        + tail
        + _BATTLE_FACTS_RULE
        + "\n这是你自己在盯着战况、主动开口跟他说话，不是等他问你。"
        + ask
        + "不要提「插件」「接口」「模型」。"
    )


def battle_report_card_text(result: dict[str, Any]) -> str:
    """主聊天里直接展示的战报卡片（纯文本，不经过模型）。"""

    if not isinstance(result, dict):
        return ""
    report = result.get("report") or {}
    lines = [
        "【猫娘星海作战 · 本局战报】",
        (
            f"得分 {_int(report.get('score'), 0):,} · 第 {_int(report.get('wave'), 1, low=1)} 波"
            f" · 击毁 {_int(report.get('kills'), 0)} 架 · 母舰 {_int(report.get('boss_kills'), 0)} 艘"
        ),
        (
            f"最高连击 {_int(report.get('max_combo'), 0)}"
            f" · 用时 {_fmt_duration(report.get('duration_seconds'))}"
            f" · 被击中 {_int(report.get('hits_taken'), 0)} 次"
        ),
        (
            f"军衔 {_text(result.get('rank'), '列兵', limit=16)}"
            f" · 亲密度 Lv.{_int(result.get('affinity_level'), 1, low=1)}"
            f"（+{_int(result.get('affinity_gain'), 0)}）"
        ),
    ]
    if result.get("new_record"):
        lines.append(f"新纪录！超过了之前的 {_int(result.get('previous_best'), 0):,} 分")
    achievements = result.get("new_achievements")
    if isinstance(achievements, (list, tuple)) and achievements:
        names = "、".join(_text(item.get("name"), "", limit=24) for item in achievements if isinstance(item, dict))
        if names:
            lines.append("新徽章：" + names)
    return "\n".join(lines)


def banter_situation(kind: Any, state: Any = None) -> str:
    """把战斗节点翻译成给模型看的一句情境描述。"""

    raw = state if isinstance(state, dict) else {}
    wave = _int(raw.get("wave"), 1, low=1, high=9_999)
    hull = _int(raw.get("hull_integrity"), 3, high=9)
    combo = _int(raw.get("combo"), 0, high=99_999)
    label = DIFFICULTY_LABELS.get(clamp_difficulty(raw.get("difficulty")), "普通")
    key = _text(kind, "", limit=32).lower()
    if key == "start":
        return f"新的一局开始了，{label}难度，第 1 波敌机正在进入射程"
    if key == "boss_spawn":
        return f"第 {wave} 波的母舰出现了，弹幕很密"
    if key == "boss_down":
        return f"刚把第 {wave} 波的母舰击破，星海里暂时安静了一点"
    if key == "low_hull":
        return f"装甲只剩 {hull} 点，马上要撑不住了"
    if key == "combo":
        return f"连击已经到 {combo} 了，手感正热"
    if key == "wave":
        return f"第 {wave} 波开始了，新一批敌机压过来"
    if key == "run_over":
        return f"这一局在第 {wave} 波结束了，星舰被击毁，屏幕上正在显示本局战报"
    return "战斗还在继续"


def state_summary(state: Any) -> dict[str, Any]:
    """把界面同步来的战斗状态整理成摘要，供 LLM 工具和战报使用。"""

    raw = state if isinstance(state, dict) else {}
    running = _as_bool(raw.get("running"), False)
    payload = {
        "running": running,
        "difficulty": clamp_difficulty(raw.get("difficulty")),
        "wave": _int(raw.get("wave"), 1, low=1, high=9_999),
        "score": _int(raw.get("score"), 0, high=9_999_999),
        "kills": _int(raw.get("kills"), 0, high=999_999),
        "boss_kills": _int(raw.get("boss_kills"), 0, high=9_999),
        "combo": _int(raw.get("combo"), 0, high=99_999),
        "max_combo": _int(raw.get("max_combo"), 0, high=99_999),
        "hull_integrity": _int(raw.get("hull_integrity"), 3, high=9),
        "max_hull": _int(raw.get("max_hull"), 3, high=9),
        "bond": _int(raw.get("bond"), 0, high=100),
        "activated_orders": _int(raw.get("activated_orders"), 0, high=999),
        "boss_active": _as_bool(raw.get("boss_active"), False),
        "boss_hp": _int(raw.get("boss_hp"), 0, high=9_999_999),
        "boss_max_hp": _int(raw.get("boss_max_hp"), 0, high=9_999_999),
        "enemies": _int(raw.get("enemies"), 0, high=999),
        "enemies_left": _int(raw.get("enemies_left"), 0, high=999),
        "hits_taken": _int(raw.get("hits_taken"), 0, high=999_999),
        "power": _int(raw.get("power"), 1, low=1, high=3),
        "elapsed": _int(raw.get("elapsed"), 0, high=999_999),
    }
    payload["text"] = _state_brief(payload)
    return payload


def profile_public(profile: Any) -> dict[str, Any]:
    """给前端的档案快照（附带派生字段）。"""

    current = merge_profile(profile)
    return {
        "profile": current,
        "rank": rank_for_score(current["best_score"]),
        "affinity_level": affinity_level(current["affinity"]),
        "achievements": achievement_flags(current),
        "game_version": GAME_VERSION,
        "wingman_default_name": DEFAULT_WINGMAN_NAME,
        "orders": order_catalog(),
        "difficulties": difficulty_catalog(),
    }


DOC_SECTIONS: dict[str, dict[str, str]] = {
    "overview": {
        "title": "玩法概览",
        "content": (
            "《猫娘星海作战》是一个像素风竖版太空射击小游戏，界面由插件自带，不依赖外部网页。\n"
            "玩家驾驶「猫耳级」星舰，主界面的猫娘全程陪打：她的无人机会自动射击，"
            "玩家还能用「护盾 / 集火 / 维修 / 猫猫星爆」四种战术指令。\n"
            "难度会随波数往上走：越往后敌人越耐打、弹幕越密越快、每波敌机也更多；"
            "她的支援（护盾/集火/星爆/僚机火力）都调过，靠刷羁绊续命已经走不通了。\n"
            "每一局结束会把战报送到主界面，她可以就此点评；玩家也能在游戏里的「机内通讯」框说话，"
            "那句话会转给她本人，她的回话再出现在游戏画面里。成绩、亲密度和徽章保存在插件数据目录里，下次打开还在。\n"
            "打开方式：插件管理器 → 猫娘星海作战 → 打开界面。"
        ),
    },
    "controls": {
        "title": "操作方式",
        "content": (
            "鼠标/触屏：拖动星舰移动；按住左键或空格开火（设置里可以打开自动开火）。\n"
            "键盘：WASD / 方向键移动，空格开火，1-4 触发四种战术指令，P 或 Esc 暂停。\n"
            "窗口变小时画面按比例缩放，像素保持锐利；手机横屏也能玩。"
        ),
    },
    "orders": {
        "title": "战术指令",
        "content": (
            "护盾展开：消耗 20 羁绊，冷却 16 秒，4 秒无敌并清除身边的弹幕。\n"
            "集火指令：消耗 25 羁绊，冷却 18 秒，僚机无人机对最强目标连续激光 5 秒。\n"
            "紧急维修：消耗 40 羁绊，冷却 30 秒，恢复 1 点装甲（上限 5 点）。\n"
            "猫猫星爆：消耗 70 羁绊，冷却 50 秒，3 秒全屏光束，清弹并重创所有敌人。\n"
            "羁绊靠击毁敌机、清波和吃掉落物积累，被击中会掉羁绊。指令可以点界面按钮、按数字键，"
            "也可以由主界面的猫娘用 spacewar_command 工具转达。"
        ),
    },
    "mechanics": {
        "title": "战斗机制",
        "content": (
            "波次制无尽模式，每 5 波出现一艘母舰（Boss），击破有大量掉落。\n"
            "敌机：游荡者（慢速）、突袭者（俯冲）、炮手（瞄准射击）、重甲（高血量环形弹幕）。\n"
            "掉落：P 火力升级（最高 3 级）、A 装甲修复、B 羁绊补给。\n"
            "连击：连续击毁不被打断，最多 3 倍分数加成。\n"
            "难度：轻松、普通各 3 点装甲，硬核 2 点装甲且敌人更快更硬。\n"
            "结算：分数、波次、母舰、连击、用时都会计入战绩，并结算军衔、徽章与亲密度。"
        ),
    },
    "integration": {
        "title": "和猫娘一起玩",
        "content": (
            "游戏里说话的就是主界面的猫娘本人，插件不再自己养一只：她在游戏里说的每一句，"
            "都是宿主模型用她自己的身份生成的，同时出现在主聊天和游戏内的机内通讯面板里。\n"
            "机内通讯：你在游戏里打字，这段话会转给主界面的她，由她本人回你，"
            "回话再通过 spacewar_say 送回游戏画面（设置里可以关掉这条通道）。\n"
            "主动喊话：战斗里的关键时刻会触发她**自己先开口**——开局、新一波开始、母舰出现、母舰被击破、"
            "装甲告急、连击冲到 20/50、本局结束。这些不是回答玩家，是她盯着战况主动跟你说话；"
            "同一句话也会用 spacewar_say 送进游戏画面。\n"
            "每局结束的战报会以卡片形式出现在主聊天，并让她点评这一局。\n"
            "反过来，她可以调用 spacewar_command 把指令排进游戏（4 秒内生效）、"
            "spacewar_launch 预约一局、spacewar_cheer 打气，也可以用 spacewar_say 直接对游戏里的你说一句话。\n"
            "状态入口 battle_sync_state 由游戏每 4 秒同步一次，最新状态保留 15 秒。"
        ),
    },
    "api": {
        "title": "入口与存档",
        "content": (
            "静态界面通过 POST /runs 调用：battle_get_profile、battle_sync_state、battle_report、"
            "battle_chat、battle_banter、battle_set_settings、battle_reset_profile、battle_get_docs。\n"
            "LLM 工具：spacewar_status、spacewar_command、spacewar_launch、"
            "spacewar_cheer、spacewar_docs、spacewar_say。\n"
            "存档是插件数据目录下的 profile.json；前端另有 localStorage 兜底，插件未运行时也能看本地战绩。"
        ),
    },
}


def docs_catalog() -> list[dict[str, str]]:
    """文档目录。"""

    return [{"id": key, "title": value["title"]} for key, value in DOC_SECTIONS.items()]


def docs_text(topic: Any = "overview") -> dict[str, str]:
    """取某一节文档；未知主题返回概览。"""

    key = _text(topic, "overview", limit=32).lower()
    section = DOC_SECTIONS.get(key)
    if section is None:
        key, section = "overview", DOC_SECTIONS["overview"]
    return {"topic": key, "title": section["title"], "content": section["content"]}


def should_push_report(last_report_at: Any, now: Any, cooldown_seconds: Any) -> bool:
    """两局战报之间是否需要遵守冷却时间。"""

    cooldown = _int(cooldown_seconds, 0, high=600)
    if cooldown <= 0:
        return True
    last = parse_timestamp(last_report_at) or 0
    current = parse_timestamp(now) or int(time.time())
    return current - last >= cooldown


__all__ = [
    "ACHIEVEMENT_IDS",
    "AFFINITY_LEVEL_STEP",
    "DEFAULT_WINGMAN_NAME",
    "DIFFICULTIES",
    "DIFFICULTY_LABELS",
    "DOC_SECTIONS",
    "GAME_VERSION",
    "MAX_QUEUE_ORDERS",
    "ORDER_COOLDOWNS",
    "ORDER_COSTS",
    "ORDER_HINTS",
    "ORDER_IDS",
    "ORDER_LABELS",
    "PLUGIN_ID",
    "achievement_catalog",
    "achievement_flags",
    "affinity_level",
    "apply_settings",
    "BANTER_KINDS",
    "URGENT_BANTER_KINDS",
    "banter_situation",
    "battle_report_card_text",
    "battle_report_text",
    "cheer_ack_text",
    "clamp_difficulty",
    "comm_relay_text",
    "command_ack_text",
    "default_profile",
    "default_settings",
    "difficulty_catalog",
    "docs_catalog",
    "docs_text",
    "event_relay_text",
    "launch_ack_text",
    "merge_profile",
    "merge_settings",
    "normalize_order_id",
    "order_catalog",
    "parse_timestamp",
    "profile_public",
    "rank_for_score",
    "reset_profile",
    "settle_report",
    "should_push_report",
    "state_summary",
    "summarize_run",
]
