// 猫娘星海作战 —— 前端常量与静态数据
export const PLUGIN_ID = "neko_spacewar";
export const RUNS_URL = "/runs";
export const STORAGE_KEY = "neko_spacewar:v1";
export const GAME_W = 480;
export const GAME_H = 720;
// 游戏内显示的默认称呼；说话的一直是主界面的猫娘本人（可在配置里改 wingman_name）。
export const WINGMAN_DEFAULT = "猫娘";

export const DIFFICULTIES = {
  easy: {
    id: "easy",
    label: "轻松",
    sub: "慢一拍也没关系",
    startHull: 3,
    maxHull: 5,
    enemySpeed: 0.86,
    enemyHp: 0.85,
    enemyFire: 1.18,
    spawnGap: 0.7,
    scoreScale: 0.9,
  },
  normal: {
    id: "normal",
    label: "普通",
    sub: "并肩作战的感觉",
    startHull: 3,
    maxHull: 5,
    enemySpeed: 1,
    enemyHp: 1,
    enemyFire: 1,
    spawnGap: 0.62,
    scoreScale: 1,
  },
  hard: {
    id: "hard",
    label: "硬核",
    sub: "猫猫也会紧张",
    startHull: 2,
    maxHull: 5,
    enemySpeed: 1.16,
    enemyHp: 1.18,
    enemyFire: 0.85,
    spawnGap: 0.52,
    scoreScale: 1.15,
  },
};

export const DIFFICULTY_ORDER = ["easy", "normal", "hard"];

export const ORDERS = [
  {
    id: "shield",
    label: "护盾",
    full: "护盾展开",
    cost: 32,
    cooldown: 24,
    key: "1",
    hint: "2.2 秒无敌，清掉身边的弹幕",
  },
  {
    id: "focus",
    label: "集火",
    full: "集火指令",
    cost: 38,
    cooldown: 28,
    key: "2",
    hint: "僚机对最强目标连续激光 3.5 秒",
  },
  {
    id: "repair",
    label: "维修",
    full: "紧急维修",
    cost: 55,
    cooldown: 40,
    key: "3",
    hint: "恢复 1 点装甲，最多 5 点",
  },
  {
    id: "ultimate",
    label: "星爆",
    full: "猫猫星爆",
    cost: 95,
    cooldown: 75,
    key: "4",
    hint: "2.2 秒全屏光束，清弹重创全场",
  },
];

export const ORDER_MAP = Object.fromEntries(ORDERS.map((item) => [item.id, item]));

// 平衡数值集中在这里，方便后续微调（改完刷新页面即可生效）
export const BALANCE = {
  // —— 她的支援（这次整体削弱：不再是无脑续航，用一次要想清楚）——
  droneGap: 0.55, // 僚机无人机两发之间的间隔（秒），越大越弱
  focusDps: 62, // 集火激光每秒伤害（原 105）
  ultDps: 32, // 星爆全屏每秒伤害（原 52）
  ultBossDps: 46, // 星爆打母舰的每秒伤害（原 78）
  shieldDuration: 2.2, // 护盾无敌时长（秒，原 4）
  shieldClearRadius: 150, // 护盾开时清弹半径（像素，原 200）
  focusDuration: 3.5, // 集火持续（秒，原 5）
  ultDuration: 2.2, // 星爆持续（秒，原 3）
  cheerBond: 2, // 打气给多少羁绊（原 5）
  cheerCooldown: 15, // 打气冷却（秒，原无冷却，可无限刷羁绊）
  // —— 羁绊收入（原：击杀 2 / 清波 8 / 母舰 20 / 拾取 15）——
  bondPerKill: 1,
  bondPerWaveClear: 5,
  bondPerBoss: 12,
  bondPerPickup: 10,
  // —— 掉落率（原：坦克 0.6 / 炮艇 0.14 / 其他 0.09）——
  dropTank: 0.42,
  dropGunner: 0.1,
  dropOther: 0.055,
  // —— 难度随波数增长（1.0 = 第 1 波）——
  waveHpGrowth: 0.07, // 每波敌人血量 +7%（原 5.5%）
  waveFireGrowth: 0.035, // 每波出弹频率 +3.5%，上限 2.4 倍
  waveFireCap: 2.4,
  waveBulletGrowth: 0.015, // 每波弹速 +1.5%，上限 1.45 倍
  waveBulletCap: 1.45,
  waveCountBase: 6, // 每波敌机数 = 6 + 波数 × 2.4
  waveCountPerWave: 2.4,
  waveCountCap: 48, // 原上限 24
  spawnGapFloor: 0.18, // 出怪间隔下限（秒，原 0.3）
};

export const QUICK_PHRASES = [
  { id: "cheer", text: "加油！" },
  { id: "nice", text: "打得漂亮！" },
  { id: "careful", text: "小心弹幕！" },
  { id: "command", text: "听我指挥~" },
];

// 本地稳妥台词：主界面的猫娘负责真正的对话，这里只是保证战斗里始终有人应声（不联网也不冷场）
export const CAT_LINES = {
  start: [
    "舰长，僚机已就位。今天也一起把星海打穿吧！",
    "雷达干净，引擎正常。我跟着你，放心冲。",
    "猫耳级星舰，启动！我会帮你盯着后面的。",
  ],
  wave: [
    "这一波清干净了，漂亮！",
    "又有敌机靠近了，我先把无人机拉过去。",
    "波次推进中，舰长保持节奏。",
    "雷达上有点热闹……不过我们能行。",
  ],
  boss: [
    "母舰来了！弹幕会变密，护盾留着这时候用。",
    "检测到旗舰级信号……舰长，认真了哦。",
    "Boss 出现了！我先帮你打掉它的炮口。",
  ],
  bossDown: [
    "母舰击破！干得漂亮，舰长！",
    "旗舰沉了！我就说我们能行。",
    "呼——打完了。要不要击个掌？",
  ],
  lowHull: [
    "装甲报警！回避一下，我来掩护你。",
    "舰长，血不多了，别硬接弹幕！",
    "维修指令随时可以下，我等你一句话。",
  ],
  hit: [
    "被擦到了！小心点嘛。",
    "呜……我会帮你把弹幕打散的。",
    "别硬吃伤害，绕一下！",
  ],
  orderShield: ["护盾展开，交给我。", "开盾！这四秒随便冲。"],
  orderFocus: ["集火指令收到，激光锁定！", "锁定最强目标，交给我打。"],
  orderRepair: ["维修无人机出发，撑住！", "补上装甲了，继续。"],
  orderUltimate: ["猫猫星爆——全功率释放！", "星爆启动！都给我让开！"],
  combo: ["连击起来了，舰长好手感！", "这个连击数……有点帅。"],
  kill: ["击毁确认。", "打掉了！", "命中！"],
  cheer: ["收到你的打气！我更有劲了。", "嘿嘿，那我可要认真了。"],
  idle: [
    "星海今天也很安静呢。",
    "舰长，要不要试着用一下战术指令？",
    "我在你左后方，放心。",
    "这块星域的光真好看。",
  ],
  gameOver: [
    "星舰返航了……下次我们打得更远。",
    "辛苦了舰长，战绩我记下来了。",
    "没关系，修一修还能再战。",
  ],
  relay: ["机内频道是通的，你直接说就好。", "她在听呢，想说什么就说。"],
};

export const DOCTOR_FALLBACK = [
  {
    id: "overview",
    title: "玩法概览",
    text: "拖动星舰移动，自动开火。她会让两架无人机帮你打，还会按你的指令放护盾、集火、维修和猫猫星爆。每 5 波出现一艘母舰。",
  },
  {
    id: "controls",
    title: "操作方式",
    text: "鼠标/触屏拖动移动；WASD 或方向键也可移动；空格开火（可设自动开火）；1-4 战术指令；P 或 Esc 暂停。",
  },
  {
    id: "orders",
    title: "战术指令",
    text: "护盾 20 羁绊 / 16 秒冷却；集火 25 / 18 秒；维修 40 / 30 秒；星爆 70 / 50 秒。羁绊靠击毁敌机、清波和补给获得，被击中会掉。",
  },
  {
    id: "integration",
    title: "和猫娘联动",
    text: "游戏里说话的就是主界面那位她本人，插件不再自己养第二只。你在机内通讯里说话，这句话会送到她那儿，她的回话再出现在游戏画面里；开局、母舰出现和击破时她也会主动喊一句。每局结束战报会送到主界面，她还能用工具给你下指令、打气或者预约下一局。",
  },
];
