from __future__ import annotations

import importlib.util
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parents[1]


def _load_logic():
    spec = importlib.util.spec_from_file_location("neko_spacewar_logic", PLUGIN_ROOT / "logic.py")
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


LOGIC = _load_logic()


def _report(**overrides):
    report = {
        "score": 1200,
        "wave": 3,
        "kills": 20,
        "boss_kills": 0,
        "max_combo": 10,
        "duration_seconds": 95,
        "hits_taken": 1,
        "ultimates_used": 0,
        "bond_peak": 60,
        "difficulty": "normal",
        "used_orders": {"shield": 2},
    }
    report.update(overrides)
    return report


# --------------------------------------------------------------------------- 清单


def test_plugin_manifest_exists() -> None:
    manifest = PLUGIN_ROOT / "plugin.toml"
    assert manifest.is_file()
    text = manifest.read_text(encoding="utf-8")
    assert 'id = "neko_spacewar"' in text
    assert 'entry = "plugin.plugins.neko_spacewar:NekoSpaceWarPlugin"' in text


def test_static_ui_ships_all_modules() -> None:
    static = PLUGIN_ROOT / "static"
    for name in ("index.html", "style.css", "main.js", "engine.js", "ui.js", "config.js", "pixel.js", "audio.js"):
        assert (static / name).is_file(), name


def test_config_example_has_no_plugin_section() -> None:
    text = (PLUGIN_ROOT / "config.example.toml").read_text(encoding="utf-8")
    assert "[plugin]" not in text
    assert "[plugin_runtime]" not in text
    assert "[neko_spacewar]" in text


# --------------------------------------------------------------------------- 档案


def test_reset_profile_keeps_settings() -> None:
    fresh = LOGIC.reset_profile({"settings": {"difficulty": "hard", "sfx": False}}, now=1_700_000_000)
    assert fresh["best_score"] == 0
    assert fresh["achievements"] == []
    assert fresh["settings"]["difficulty"] == "hard"
    assert fresh["settings"]["sfx"] is False


def test_merge_profile_survives_broken_input() -> None:
    profile = LOGIC.merge_profile(
        {"best_score": "12,345", "total_sorties": -4, "achievements": ["first_sortie", "nope", "first_sortie"]}
    )
    assert profile["best_score"] == 12345
    assert profile["total_sorties"] == 0
    assert profile["achievements"] == ["first_sortie"]


def test_apply_settings_does_not_mutate_input() -> None:
    original = LOGIC.default_profile()
    updated = LOGIC.apply_settings(original, {"difficulty": "hard", "battle_sync": False})
    assert original["settings"]["difficulty"] == "normal"
    assert updated["settings"]["difficulty"] == "hard"
    assert updated["settings"]["battle_sync"] is False


# --------------------------------------------------------------------------- 结算


def test_settle_report_first_run_unlocks_first_sortie() -> None:
    result = LOGIC.settle_report(None, _report(), now=1_700_000_000)
    assert result["new_record"] is True
    assert result["previous_best"] == 0
    assert result["report"]["score"] == 1200
    assert result["profile"]["best_score"] == 1200
    assert result["profile"]["total_sorties"] == 1
    assert result["affinity_gain"] == 3
    assert result["affinity"] == 3
    assert result["affinity_level"] == 1
    assert result["rank"] == "列兵"
    assert "first_sortie" in [item["id"] for item in result["new_achievements"]]
    assert "第 3 波" in result["summary"]
    assert "1,200" in result["summary"]


def test_settle_report_second_run_keeps_best() -> None:
    first = LOGIC.settle_report(None, _report(score=8000), now=1_700_000_000)
    second = LOGIC.settle_report(first["profile"], _report(score=500, wave=1, kills=3), now=1_700_000_100)
    assert second["new_record"] is False
    assert second["previous_best"] == 8000
    assert second["profile"]["best_score"] == 8000
    assert second["profile"]["total_sorties"] == 2
    assert second["profile"]["total_kills"] == 23
    assert second["rank"] == "星际游骑"


def test_settle_report_unlocks_expected_badges() -> None:
    result = LOGIC.settle_report(
        None,
        _report(score=12000, wave=10, kills=60, boss_kills=1, max_combo=22, hits_taken=0, difficulty="hard"),
        now=1_700_000_000,
    )
    unlocked = {item["id"] for item in result["new_achievements"]}
    for expected in ("first_sortie", "wave_5", "wave_10", "hard_wave_10", "boss_slayer", "combo_20", "score_10k"):
        assert expected in unlocked
    assert "flawless_5" in unlocked
    assert "bond_full" not in unlocked
    assert result["rank"] == "星际游骑"


def test_settle_report_clamps_hostile_values() -> None:
    result = LOGIC.settle_report(
        None,
        {"score": -50, "wave": -3, "bond_peak": 999, "difficulty": "nightmare", "used_orders": {"shield": 1, "bogus": 5}},
        now=1_700_000_000,
    )
    assert result["report"]["score"] == 0
    assert result["report"]["wave"] == 1
    assert result["report"]["bond_peak"] == 100
    assert result["report"]["difficulty"] == "normal"
    assert result["report"]["used_orders"] == ["shield"]


# --------------------------------------------------------------------------- 输入规整


def test_normalize_order_id_accepts_aliases() -> None:
    assert LOGIC.normalize_order_id("开盾") == "shield"
    assert LOGIC.normalize_order_id("集火") == "focus"
    assert LOGIC.normalize_order_id("回血") == "repair"
    assert LOGIC.normalize_order_id("猫猫星爆") == "ultimate"
    assert LOGIC.normalize_order_id("帮我开一下护盾") == "shield"
    assert LOGIC.normalize_order_id("随便聊聊") == ""


def test_clamp_difficulty() -> None:
    assert LOGIC.clamp_difficulty("HARD") == "hard"
    assert LOGIC.clamp_difficulty("轻松") == "easy"
    assert LOGIC.clamp_difficulty("nightmare") == "normal"
    assert LOGIC.clamp_difficulty(None) == "normal"


def test_should_push_report_respects_cooldown() -> None:
    assert LOGIC.should_push_report(0, 1000, 20) is True
    assert LOGIC.should_push_report(980, 1000, 20) is True
    assert LOGIC.should_push_report(981, 1000, 20) is False
    assert LOGIC.should_push_report(None, 1_700_000_000, 0) is True


# --------------------------------------------------------------------------- 状态与文档


def test_state_summary_defaults() -> None:
    summary = LOGIC.state_summary({})
    assert summary["running"] is False
    assert summary["wave"] == 1
    assert summary["hull_integrity"] == 3
    assert summary["max_hull"] == 3
    assert summary["difficulty"] == "normal"
    assert isinstance(summary["text"], str) and summary["text"]


def test_state_summary_normalizes_snapshot() -> None:
    summary = LOGIC.state_summary(
        {
            "running": "yes",
            "wave": 7,
            "score": 4310,
            "bond": 140,
            "hull_integrity": 2,
            "max_hull": 5,
            "boss_active": 1,
            "difficulty": "hard",
        }
    )
    assert summary["running"] is True
    assert summary["bond"] == 100
    assert summary["hull_integrity"] == 2
    assert summary["max_hull"] == 5
    assert summary["boss_active"] is True


def test_profile_public_shape() -> None:
    payload = LOGIC.profile_public(None)
    assert payload["profile"]["best_score"] == 0
    assert payload["rank"] == "列兵"
    assert payload["affinity_level"] == 1
    assert len(payload["achievements"]) == len(LOGIC.achievement_catalog())
    assert [item["id"] for item in payload["orders"]] == list(LOGIC.ORDER_IDS)
    assert [item["id"] for item in payload["difficulties"]] == list(LOGIC.DIFFICULTIES)


def test_docs_text_falls_back_to_overview() -> None:
    overview = LOGIC.docs_text("overview")
    assert overview["topic"] == "overview"
    assert overview["content"]
    fallback = LOGIC.docs_text("no-such-topic")
    assert fallback["topic"] == "overview"
    controls = LOGIC.docs_text("controls")
    assert controls["topic"] == "controls"
    assert controls["title"]


def test_battle_report_text_uses_placeholders() -> None:
    result = LOGIC.settle_report(None, _report(score=6400, wave=6, kills=48, boss_kills=1), now=1_700_000_000)
    text = LOGIC.battle_report_text(result, "猫娘")
    assert "{MASTER_NAME}" in text
    assert "星海作战" in text
    assert "6,400" in text
    assert LOGIC.cheer_ack_text()
    assert LOGIC.command_ack_text("shield", True, {"hull_integrity": 2, "max_hull": 3})


# --------------------------------------------------------------------------- 猫娘互动


def test_manifest_ships_interaction_settings() -> None:
    manifest = (PLUGIN_ROOT / "plugin.toml").read_text(encoding="utf-8")
    assert 'version = "0.4.0"' in manifest
    for key in ("llm_chat_enabled", "llm_banter_enabled", "banter_cooldown_seconds"):
        assert key in manifest
    assert "chat_mirror_enabled" not in manifest
    assert "yui_chat" not in manifest


def test_config_example_ships_interaction_settings() -> None:
    text = (PLUGIN_ROOT / "config.example.toml").read_text(encoding="utf-8")
    for key in ("llm_chat_enabled", "llm_banter_enabled", "banter_cooldown_seconds"):
        assert key in text
    assert "chat_mirror_enabled" not in text


def test_plugin_has_no_second_catgirl() -> None:
    """插件里不能再有自己开模型会话的第二个猫娘。"""

    assert not (PLUGIN_ROOT / "yui_chat.py").exists()
    source = (PLUGIN_ROOT / "__init__.py").read_text(encoding="utf-8")
    assert "yui_chat" not in source
    assert "create_chat_llm_async" not in source
    assert "game_main" not in source
    # 说话交给宿主：机内通讯与战况播报都必须走 respond，并要求她调用 spacewar_say 回传。
    assert 'ai_behavior="respond"' in source
    assert "spacewar_say" in source


def test_relay_texts_ask_host_catgirl_to_speak() -> None:
    text = LOGIC.comm_relay_text("你今天打得真好", {"running": True, "wave": 3})
    assert "{MASTER_NAME}" in text
    assert "你今天打得真好" in text
    assert "spacewar_say" in text
    banter = LOGIC.event_relay_text("boss_spawn", {"running": True, "wave": 5})
    assert "{MASTER_NAME}" in banter
    assert "spacewar_say" in banter
    assert "母舰" in banter


def test_settings_include_interaction_switches() -> None:
    settings = LOGIC.default_settings()
    for key in ("llm_chat", "llm_banter"):
        assert settings[key] is True
    assert "chat_mirror" not in settings
    merged = LOGIC.merge_settings({"llm_chat": False, "llm_banter": "no"})
    assert merged["llm_chat"] is False
    assert merged["llm_banter"] is False
    assert "chat_mirror" not in merged


def test_banter_kinds_all_have_situation_text() -> None:
    assert "start" in LOGIC.BANTER_KINDS
    for kind in LOGIC.BANTER_KINDS:
        assert LOGIC.banter_situation(kind, {"running": True, "wave": 2})


def test_battle_report_card_text_is_plain_card() -> None:
    result = LOGIC.settle_report(None, _report(score=6400, wave=6, kills=48, boss_kills=1), now=1_700_000_000)
    card = LOGIC.battle_report_card_text(result)
    assert "本局战报" in card
    assert "6,400" in card
    assert "第 6 波" in card
    assert "军衔" in card
    assert LOGIC.battle_report_card_text(None) == ""


def test_banter_situation_describes_nodes() -> None:
    assert "母舰" in LOGIC.banter_situation("boss_spawn", {"wave": 5})
    assert "第 1 波" in LOGIC.banter_situation("start", {"difficulty": "hard"})
    assert "装甲" in LOGIC.banter_situation("low_hull", {"hull_integrity": 1})
    assert "连击" in LOGIC.banter_situation("combo", {"combo": 12})
    assert LOGIC.banter_situation("nope")


# --------------------------------------------------------------------------- 游戏触发她开口


def test_game_events_trigger_catgirl_to_speak() -> None:
    """游戏里的关键时刻必须把主界面的她叫起来主动说话，而不是等她被问。"""

    engine = (PLUGIN_ROOT / "static" / "engine.js").read_text(encoding="utf-8")
    for event in ("start", "wave", "boss_spawn", "boss_down", "hull_low", "combo", "over"):
        assert 'onEvent("' + event + '"' in engine, event
    ui = (PLUGIN_ROOT / "static" / "ui.js").read_text(encoding="utf-8")
    for kind in ("start", "wave", "boss_spawn", "boss_down", "low_hull", "combo", "run_over"):
        assert '_requestBanter("' + kind + '"' in ui, kind
    # 闲聊节点要限流，关键节点不限流。
    assert "BANTER_MIN_GAP" in ui


def test_urgent_banter_kinds_bypass_cooldown() -> None:
    urgent = set(LOGIC.URGENT_BANTER_KINDS)
    assert urgent <= set(LOGIC.BANTER_KINDS)
    assert {"start", "boss_spawn", "boss_down", "run_over"} <= urgent
    assert "wave" not in urgent
    source = (PLUGIN_ROOT / "__init__.py").read_text(encoding="utf-8")
    assert "URGENT_BANTER_KINDS" in source


def test_relay_text_says_it_is_her_own_initiative() -> None:
    text = LOGIC.event_relay_text("wave", {"running": True, "wave": 4})
    assert "主动" in text
    assert "spacewar_say" in text


def test_run_over_banter_comforts_then_advises() -> None:
    text = LOGIC.event_relay_text("run_over", {"running": False, "wave": 6, "score": 3200})
    assert "{MASTER_NAME}" in text
    assert "spacewar_say" in text
    assert "战报" in text
    assert "第 6 波" in LOGIC.banter_situation("run_over", {"wave": 6})


# --------------------------------------------------------------------------- 战况与难度


def _battle_state(**overrides):
    state = {
        "running": True,
        "difficulty": "normal",
        "wave": 12,
        "score": 18400,
        "kills": 163,
        "hits_taken": 4,
        "combo": 7,
        "hull_integrity": 2,
        "max_hull": 5,
        "bond": 46,
        "power": 2,
        "enemies": 5,
        "enemies_left": 9,
        "boss_active": False,
        "boss_hp": 0,
        "boss_max_hp": 0,
        "elapsed": 320,
    }
    state.update(overrides)
    return state


def test_state_brief_reports_real_battle_facts() -> None:
    """她拿到的战况必须是真的打起来才知道的东西，不能只有波数和装甲。"""

    brief = LOGIC._state_brief(_battle_state())
    for expect in ("第 12 波", "击毁 163", "被打中 4", "场上 5 架", "还有 9 架", "火力 2/3", "本局打了"):
        assert expect in brief, expect


def test_state_brief_reports_boss_hp() -> None:
    brief = LOGIC._state_brief(_battle_state(wave=15, boss_active=True, boss_hp=300, boss_max_hp=1200))
    assert "母舰还在" in brief
    assert "25%" in brief


def test_relay_text_forbids_inventing_battle_details() -> None:
    for text in (
        LOGIC.comm_relay_text("在吗", _battle_state()),
        LOGIC.event_relay_text("wave", _battle_state()),
    ):
        assert "真实战况" in text
        assert "不要编" in text


def test_state_summary_exposes_battle_facts() -> None:
    summary = LOGIC.state_summary(_battle_state())
    assert summary["enemies"] == 5
    assert summary["enemies_left"] == 9
    assert summary["hits_taken"] == 4
    assert summary["power"] == 2
    assert "击毁" in summary["text"]


def test_difficulty_scales_with_wave() -> None:
    config = (PLUGIN_ROOT / "static" / "config.js").read_text(encoding="utf-8")
    assert "export const BALANCE" in config
    for key in ("waveHpGrowth", "waveFireGrowth", "waveBulletGrowth", "waveCountCap"):
        assert key in config, key
    engine = (PLUGIN_ROOT / "static" / "engine.js").read_text(encoding="utf-8")
    for marker in ("_waveHpScale", "_waveFireScale", "_waveBulletScale", "BALANCE.waveCountCap"):
        assert marker in engine, marker


def test_her_support_items_were_nerfed() -> None:
    """她的道具整体削弱过：造价/冷却上调，打气不能再无限刷羁绊。"""

    assert LOGIC.ORDER_COSTS["shield"] >= 30
    assert LOGIC.ORDER_COSTS["ultimate"] >= 90
    assert LOGIC.ORDER_COOLDOWNS["ultimate"] >= 70
    engine = (PLUGIN_ROOT / "static" / "engine.js").read_text(encoding="utf-8")
    for marker in ("BALANCE.cheerCooldown", "BALANCE.bondPerKill", "BALANCE.shieldDuration"):
        assert marker in engine, marker
    config = (PLUGIN_ROOT / "static" / "config.js").read_text(encoding="utf-8")
    assert "cheerCooldown" in config
    assert "bondPerPickup" in config
