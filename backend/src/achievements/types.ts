// 成就解锁依据：由 game_results 聚合而来，全部为服务端权威数据
export interface AchievementAggregates {
    totalGames: number;
    totalRounds: number;
    totalScore: number;
    bestScore: number;
    correctGuesses: number;
    perfectRounds: number;
    perfectGames: number;
    distinctModes: number;
    dailyCount: number;
    chinaCount: number;
    landmarkCount: number;
}

export interface AchievementView {
    code: string;
    name: string;
    description: string;
    icon: string;
    hasTitle: boolean;
    title: string | null;
    unlockedAt: string | null;
}

export interface AchievementsPayload {
    achievements: AchievementView[];
    equippedTitle: string | null;
}
