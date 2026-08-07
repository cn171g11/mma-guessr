// 成就静态定义：与迁移 006 中播种的 achievements 表保持一致。
// 代码内维护一份便于接口返回与称号校验，DB 内一份用于外键约束与未来后台管理。
export interface AchievementMeta {
    code: string;
    name: string;
    description: string;
    icon: string;
    hasTitle: boolean;
    title: string | null;
}

export const ACHIEVEMENT_DEFINITIONS: readonly AchievementMeta[] = [
    { code: 'first_game', name: '首次游玩', description: '完成第一局游戏', icon: '🎮', hasTitle: false, title: null },
    { code: 'games_10', name: '渐入佳境', description: '累计完成 10 局游戏', icon: '🕹️', hasTitle: false, title: null },
    {
        code: 'games_100',
        name: '百局老兵',
        description: '累计完成 100 局游戏',
        icon: '🎖️',
        hasTitle: true,
        title: '百局老兵',
    },
    {
        code: 'rounds_100',
        name: '百轮历练',
        description: '累计完成 100 轮挑战',
        icon: '🔟',
        hasTitle: false,
        title: null,
    },
    {
        code: 'score_100k',
        name: '十万大神',
        description: '累计总分达到 100,000 分',
        icon: '💎',
        hasTitle: true,
        title: '十万大神',
    },
    {
        code: 'perfect_round',
        name: '一击必中',
        description: '单轮获得满分 5000 分',
        icon: '🎯',
        hasTitle: false,
        title: null,
    },
    {
        code: 'perfect_game',
        name: '登峰造极',
        description: '完成一局且每轮均获满分',
        icon: '🏆',
        hasTitle: false,
        title: null,
    },
    {
        code: 'mode_master',
        name: '全能选手',
        description: '体验全部 7 种单人游戏模式',
        icon: '🌍',
        hasTitle: true,
        title: '全能选手',
    },
    {
        code: 'daily_regular',
        name: '每日坚持',
        description: '累计完成 7 天每日挑战',
        icon: '📅',
        hasTitle: false,
        title: null,
    },
    {
        code: 'daily_30',
        name: '每日之星',
        description: '累计完成 30 天每日挑战',
        icon: '🌟',
        hasTitle: true,
        title: '每日之星',
    },
    {
        code: 'accuracy_90',
        name: '神射手',
        description: '总命中率高于 90%',
        icon: '🎖️',
        hasTitle: true,
        title: '神射手',
    },
    {
        code: 'best_20k',
        name: '高分达人',
        description: '单局成绩达到 20,000 分',
        icon: '🚀',
        hasTitle: true,
        title: '高分达人',
    },
    {
        code: 'china_10',
        name: '中国通',
        description: '累计完成 10 局中国模式',
        icon: '🐉',
        hasTitle: true,
        title: '中国通',
    },
    {
        code: 'landmark_10',
        name: '地标巡礼',
        description: '累计完成 10 局地标模式',
        icon: '🗼',
        hasTitle: false,
        title: null,
    },
];

export const ACHIEVEMENT_BY_CODE: ReadonlyMap<string, AchievementMeta> = new Map(
    ACHIEVEMENT_DEFINITIONS.map((meta) => [meta.code, meta])
);
