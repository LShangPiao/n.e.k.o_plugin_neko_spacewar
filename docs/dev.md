# 猫娘星海作战 · 开发与接口

游戏介绍见 [README.md](../README.md)。本文件是**技术文档**：配置项、插件入口、LLM 工具、本地开发命令与目录结构。

## 它是怎么工作的

```
游戏画面（static/ 里的静态页面，原生 ES 模块，无构建步骤）
  ↕ battle_sync_state 每 4 秒上报一次战斗状态 / 取回排队的指令
  ↕ battle_chat、battle_banter、battle_report、battle_event
neko_spacewar 插件（本插件：存档、战报文案、指令队列）
  ↕ push_message(ai_behavior="respond") 把战况交给她
  ↕ spacewar_say 把她回的台词收回游戏画面
主界面的猫娘（宿主 N.E.K.O. 的 LLM，用她自己的身份说话）
```

**关键约束**：插件本身不跑模型、不维护第二个人格、不持有任何 API key。所有台词都来自主界面的猫娘——她通过宿主的 `push_message(ai_behavior="respond")` 被叫起来，再用 `spacewar_say` 把同一句台词送回游戏画面。因为 `push_message` 的 receipt 拿不到她的回话文本，插件**无法**在入口返回值里直接回话，前端也不再等 `data.reply`。

## 配置项

`plugin.toml` 的 `[neko_spacewar]` 段：

```toml
wingman_name = "猫娘"        # 游戏内显示的称呼（说话的是主界面的她本人）
difficulty = "normal"        # 默认难度：easy / normal / hard
auto_fire = true             # 自动开火
sfx_enabled = true           # 战斗音效（WebAudio 实时合成）
music_enabled = true         # 背景音乐
battle_sync_enabled = true   # 战报推送到主界面
boss_comment_enabled = true  # 母舰出现/击破等事件推送（只读，进 HUD 通知）
report_cooldown_seconds = 20 # 两局战报推送的最小间隔（秒，0-600）
enable_llm_orders = true     # 允许主界面通过 LLM 工具下令
llm_chat_enabled = true      # 机内通讯转给主界面的猫娘本人
llm_banter_enabled = true    # 关键节点让她主动搭话
banter_cooldown_seconds = 25 # 两次主动搭话的最小间隔（秒，0-600）
```

`banter_cooldown_seconds` 只约束「闲聊类」节点（`wave` / `combo` / `hull_low`）；开局、母舰、本局结束属于关键节点，不受它限制。前端另有一层限流（`static/ui.js` 的 `BANTER_MIN_GAP`：`wave` 45 s、`combo` 60 s、`low_hull` 30 s），避免同一波里连着喊。

## 入口与工具

### 插件入口

| 入口 | 说明 |
| --- | --- |
| `battle_get_profile` | 读取档案、军衔、亲密度、徽章与设置 |
| `battle_set_settings` | 保存难度、自动开火、音效、音乐、战报开关 |
| `battle_reset_profile` | 清空战绩与徽章（保留设置） |
| `battle_sync_state` | 界面每 4 秒上报战斗状态，取回排队的指令 / 开局请求 / 打气 / 主界面传来的话 |
| `battle_report` | 结算一局，推送战报卡片并请猫娘点评 |
| `battle_event` | 上报开局、母舰出现、母舰击破等事件（母舰事件进 HUD 通知） |
| `battle_chat` | 机内通讯：把玩家的话转给主界面的猫娘本人，由她回话并回传游戏画面 |
| `battle_banter` | 情境搭话：开局 / 新一波 / 母舰 / 装甲告急 / 高连击 / 结束，让她主动说一句 |
| `battle_get_docs` | 读取玩法 / 指令 / 接口文档 |

`battle_chat` 不设 `coalesce_key`——同一个键只留最新会让连续几句玩家发言被吞掉。

### LLM 工具

| 工具 | 说明 |
| --- | --- |
| `spacewar_status` | 读当前战局与档案（含击毁数、被击中次数、剩余敌机、母舰血量等真实战况） |
| `spacewar_command` | 下达战术指令：护盾 / 集火 / 维修 / 星爆（受 `enable_llm_orders` 控制） |
| `spacewar_launch` | 预约开一局 |
| `spacewar_cheer` | 给玩家打气：羁绊 +2，同一场 15 秒冷却 |
| `spacewar_say` | 把一句台词送进游戏里的机内通讯栏（她说话时必须调用） |
| `spacewar_docs` | 读玩法 / 指令 / 接口文档 |

## 数值集中在哪

- `static/config.js` 的 `BALANCE`：难度曲线（`waveHpGrowth` / `waveFireGrowth` / `waveFireCap` / `waveBulletGrowth` / `waveBulletCap` / `waveCountBase` / `waveCountPerWave` / `waveCountCap` / `spawnGapFloor`）、指令效果（`shieldDuration` / `shieldClearRadius` / `focusDuration` / `ultDuration` / `ultBossDps`）、羁绊收入与掉落率、打气冷却。
- `static/config.js` 的 `ORDERS` / `DIFFICULTIES`：四指令的消耗与冷却、三档难度倍率。
- `logic.py` 的 `ORDER_COSTS` / `ORDER_COOLDOWNS` / `ORDER_HINTS`：给 LLM 与 `battle_get_docs` 用的同一份数值，改动时两边要同步。

## 开发

源码与 git 仓库位于 `N.E.K.O/plugin/plugins/neko_spacewar`；Market 使用的仓库名是 `n.e.k.o_plugin_neko_spacewar`。

在 N.E.K.O 仓库根目录中：

```bash
uv run --with pip neko-plugin sync neko_spacewar --clean
uv run neko-plugin check neko_spacewar
uv run neko-plugin check -r neko_spacewar --release
python -m pytest plugin/plugins/neko_spacewar/tests -q
```

前端 6 个 ES 模块可以做语法自检（`node --check` 只认 CommonJS，所以要拷成 `.mjs`）：

```powershell
New-Item -ItemType Directory -Force dist\jscheck | Out-Null
Get-ChildItem plugin\plugins\neko_spacewar\static\*.js | ForEach-Object {
  Copy-Item $_.FullName "dist\jscheck\$($_.BaseName).mjs" -Force
}
Get-ChildItem dist\jscheck\*.mjs | ForEach-Object { & "C:\Program Files\nodejs\node.exe" --check $_.FullName }
```

依赖声明在 `pyproject.toml`，打包时同步进 `vendor/`（不提交）。

## 目录结构

```text
neko_spacewar/
├── __init__.py          # 插件类：入口、LLM 工具、推送与存档
├── logic.py             # 纯逻辑：档案、结算、文案、文档（可单测）
├── plugin.toml
├── config.example.toml
├── static/              # 静态 UI（原生 ES 模块，无构建步骤）
│   ├── index.html
│   ├── style.css
│   ├── config.js        # 数值、指令、难度、台词
│   ├── pixel.js         # Canvas 像素绘制
│   ├── audio.js         # WebAudio 合成音效
│   ├── engine.js        # 战斗核心（固定步长循环）
│   ├── ui.js            # DOM 与 /runs 桥、主界面联动
│   └── main.js          # 组合根
├── docs/dev.md          # 本文件
└── tests/
```

## Market 发布

发布 `plugin.toml` 中声明的版本：推送 Git tag、等标准 GitHub Release 跑完（会产出 `.neko-plugin` + `market-evidence.json` + `market-release-check.txt` 三资产），再通知插件市场。

```bash
uv run neko-plugin publish neko_spacewar
```

> 发版前先确认 tag 指向的提交里 `plugin.toml` 已是目标版本：
> `git cat-file -p "vX.Y.Z:plugin.toml" | grep '^version'`。
> CI 读的是 tag 指向的提交，本地 `check` 读的是工作区，两者不一致时只有 CI 会红。

### Workflow 权限（重要）

`.github/workflows/release.yml` 里除了 `contents: write`，还必须显式授予 `id-token: write` 与 `attestations: write`：

```yaml
permissions:
  contents: write
  id-token: write
  attestations: write
```

上游 `plugin-market-release.yml` 自 2026-11-09（`497cb384`，#3655）起在独立 job 里用 `actions/attest-build-provenance` 签发构建证明。调用方不授予这两个权限时，GitHub 会在**启动阶段**直接判 `startup_failure`（约 1 秒，连 job 都不会创建，日志为空），很难从现象上猜到原因。

## Entry

```toml
entry = "plugin.plugins.neko_spacewar:NekoSpaceWarPlugin"
```