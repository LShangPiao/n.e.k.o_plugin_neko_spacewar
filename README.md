# 猫娘星海作战 / Neko Space War

像素风太空射击小游戏：你驾驶猫耳星舰，主界面的猫娘陪你一起打。游戏里说话的就是她本人——你在机内通讯里打字，这句话会送到她那里，由她用宿主模型以自己的身份回你，回话再通过 `spacewar_say` 出现在游戏画面里；开局、母舰出现、母舰击破时她还会主动喊你一句。插件不再自己养第二只猫娘，也不额外开模型会话。

## 玩法

- 拖动鼠标（或方向键 / WASD）移动星舰，自动开火；`P` 或 `Esc` 暂停。
- **难度随波数递增**（数值集中在 [static/config.js](static/config.js) 的 `BALANCE`）：
  - 敌人血量每波 +7%；
  - 出弹频率每波 +3.5%（上限 2.4 倍），弹速每波 +1.5%（上限 1.45 倍），第 12 波起炮艇改为双发、第 15 波起母舰改为四连发；
  - 每波敌机数 `6 + 波数 × 2.4`（上限 48，原来只到 24），出怪间隔下限从 0.3 s 收紧到 0.18 s；
  - 母舰血量 `80 + 波数 × 34`，环形弹与召唤频率也随波数提高。
- 每 5 波出现一艘母舰，击破有额外得分与羁绊奖励。
- 屏幕上掉落的补给：`P` 火力增强、`A` 装甲修复、`B` 羁绊补充（掉落率已下调：坦克 42%、炮艇 10%、其他 5.5%）。
- 羁绊值（bond）是资源也是亲密度：击毁敌机 +1、清空波次 +5、击破母舰 +12、捡到 `B` +10、打气 +2；被击中会减少。
- 四个战术指令，数字键 `1`-`4` 或点击按钮释放，消耗羁绊并进入冷却（数值已整体上调，不再是无脑续航）：
  - `1` 护盾展开（32 羁绊 / 24 s 冷却）：2.2 秒无敌并清掉身边的弹幕
  - `2` 集火指令（38 / 28 s）：僚机无人机对最强目标连续激光 3.5 秒
  - `3` 紧急维修（55 / 40 s）：恢复 1 点装甲（上限 5 点）
  - `4` 猫猫星爆（95 / 75 s）：2.2 秒全屏光束，清弹并重创所有敌人

## 和猫娘一起玩

插件本身不跑模型、不维护第二个人格。所有台词都来自主界面那个猫娘，她通过宿主的 `push_message(ai_behavior="respond")` 被叫起来说话，再用 `spacewar_say` 把同一句台词送回游戏画面。

- **机内通讯**：游戏右侧通讯栏直接跟她说话。插件把你的话包成一条上下文消息推给她（`ai_behavior="respond"`），她当场回一句，并按要求调用 `spacewar_say` 让这句话进入游戏里的通讯记录。开关：`llm_chat_enabled`。
- **主动搭话（游戏触发）**：战斗里的关键时刻会触发她**自己开口**跟你说话——开局、新一波开始、母舰出现、母舰击破、装甲告急、连击冲到 20/50、本局结束（关掉战报同步时兜底）。插件推一条战况消息给她（`ai_behavior="respond"`），她用宿主模型生成一句台词，再通过 `spacewar_say` 把同一句送回游戏画面。闲聊类节点在前端有间隔限制（`wave` 45 s、`combo` 60 s、`low_hull` 30 s），关键节点（开局 / 母舰 / 结束）不受 `banter_cooldown_seconds` 限制。开关：`llm_banter_enabled`。
- **她看得到真实战况**：每条推给她的战况/通讯消息后面都带一行同步数据——波数、得分、装甲、羁绊、难度、本局击毁数、被击中次数、连击、火力等级、场上敌机与未出场敌机数、母舰剩余血量、本局用时，并明确要求「没写到的不要编」，避免她凭空点评玩家的操作。
- **战报推送**：每局结束先推一张纯文本战报卡片（`visibility=["chat"]`，主聊天一定看得到），再让她点评这一局（受 `report_cooldown_seconds` 节流）。
- **主界面下令**：在聊天里让她「开护盾」「集火」「维修」「放星爆」，或以 LLM 工具 `spacewar_command` 下达，指令会进入游戏内的队列。
- **传话进游戏**：她随时可以用 `spacewar_say` 把一句话直接送进游戏里的机内通讯栏。
- **跟着开局 / 打气**：`spacewar_launch` 预约一局；`spacewar_cheer` 让游戏里羁绊 +2，同一场战斗 15 秒只能打一次气（以前没有冷却，等于无限刷羁绊）。
- **离线降级**：插件后端不可用时，界面自动切离线模式，战绩与发言暂存本机。

## 已注册入口

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

LLM 工具：`spacewar_status`、`spacewar_command`、`spacewar_launch`、`spacewar_cheer`、`spacewar_say`、`spacewar_docs`。

## 配置

`plugin.toml` 的 `[neko_spacewar]` 段：

```toml
wingman_name = "猫娘"        # 游戏内显示的称呼（说话的是主界面的她本人）
difficulty = "normal"        # 默认难度：easy / normal / hard
auto_fire = true             # 自动开火
sfx_enabled = true           # 战斗音效
music_enabled = true         # 背景音乐
battle_sync_enabled = true   # 战报推送到主界面
boss_comment_enabled = true  # 母舰出现 / 击破时把事件推给主界面（HUD 通知）
report_cooldown_seconds = 20 # 两局战报推送的最小间隔（秒）
enable_llm_orders = true     # 允许主界面通过 LLM 工具下令
llm_chat_enabled = true      # 机内通讯转给主界面的猫娘本人
llm_banter_enabled = true    # 开局 / 母舰等节点让她主动搭话
banter_cooldown_seconds = 25 # 主动搭话的最小间隔（秒，0 表示不限制）
```

## 开发

插件的源码与 Git 仓库位于：

```text
N.E.K.O/plugin/plugins/neko_spacewar
```

发布到插件市场时使用的 GitHub 仓库名：

```text
n.e.k.o_plugin_neko_spacewar
```

在 N.E.K.O 仓库根目录中：

```bash
uv run --with pip neko-plugin sync neko_spacewar --clean
uv run neko-plugin check neko_spacewar
uv run neko-plugin check -r neko_spacewar
python -m pytest plugin/plugins/neko_spacewar/tests -q
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
└── tests/
```

## Market release / Market 发布

发布 `plugin.toml` 中声明的版本：推送 Git tag、等待标准 GitHub Release，然后通知插件市场。

```bash
uv run neko-plugin publish neko_spacewar
```

## Entry

```toml
entry = "plugin.plugins.neko_spacewar:NekoSpaceWarPlugin"
```
