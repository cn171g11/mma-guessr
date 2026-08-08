// MmaGuessr · 排行榜面板
// 依赖 src/js/config.js、src/js/api.js、src/js/game.js（HTML 中按该顺序加载）。

const LB_MODES = ['classic', 'challenge', 'region', 'china', 'daily', 'landmark'];
const LB_MODE_LABELS = {
    classic: '🎯 经典',
    challenge: '⚡ 挑战',
    region: '🗺️ 区域',
    china: '🇨🇳 中国',
    daily: '📅 每日',
    landmark: '🗼 地标',
};
let lbState = { mode: 'classic', period: 'overall' };

function openLeaderboard() {
    $('leaderboard-overlay').classList.add('show');
    renderLbModeTabs();
    renderLbPeriodTabs();
    refreshLeaderboard();
}

function closeLeaderboard() {
    $('leaderboard-overlay').classList.remove('show');
}

let lbModesDelegationReady = false;

function renderLbModeTabs() {
    const container = $('lb-modes');
    if (!lbModesDelegationReady) {
        lbModesDelegationReady = true;
        container.addEventListener('click', (event) => {
            const tab = event.target.closest('.lb-tab');
            if (tab && tab.dataset.mode) switchLbMode(tab.dataset.mode);
        });
    }
    container.innerHTML = LB_MODES.map(
        (m) =>
            `<button class="lb-tab${lbState.mode === m ? ' active' : ''}" data-mode="${m}">${LB_MODE_LABELS[m]}</button>`
    ).join('');
}

function switchLbMode(mode) {
    lbState.mode = mode;
    renderLbModeTabs();
    refreshLeaderboard();
}

function renderLbPeriodTabs() {
    $('lb-period-overall').classList.toggle('active', lbState.period === 'overall');
    $('lb-period-daily').classList.toggle('active', lbState.period === 'daily');
}

function switchLbPeriod(period) {
    lbState.period = period;
    renderLbPeriodTabs();
    refreshLeaderboard();
}

async function refreshLeaderboard() {
    const list = $('lb-list');
    const sub = $('lb-sub');
    if (!MmaApi.isOnline()) {
        sub.textContent = '';
        list.innerHTML = '<div class="lb-empty">📴 当前离线，排行榜不可用</div>';
        return;
    }
    const identity = MmaApi.getIdentity();
    const me = identity && identity.role === 'user' ? identity.user.username : null;
    const date = lbState.period === 'daily' ? new Date().toISOString().slice(0, 10) : null;
    sub.textContent =
        lbState.period === 'daily' ? '今日榜 · ' + date + '（UTC）· 取当天最高分' : '总榜 · 取各玩家历史最高分';
    list.innerHTML = '<div class="lb-empty">⏳ 加载中...</div>';
    try {
        const data = await MmaApi.getLeaderboard(lbState.mode, lbState.period, 20, date);
        if (!data.entries.length) {
            list.innerHTML = '<div class="lb-empty">暂无数据，快去创造第一个记录！</div>';
            return;
        }
        list.innerHTML = data.entries
            .map(
                (e, i) =>
                    `<div class="lb-row${e.username === me ? ' me' : ''}">
                        <span class="lb-rank">${i + 1}</span>
                        <span class="lb-name">${escapeHtml(e.username)}</span>
                        <span class="lb-score">${escapeHtml(Number.isFinite(Number(e.score)) ? String(e.score) : '--')} 分</span>
                    </div>`
            )
            .join('');
    } catch (e) {
        list.innerHTML = '<div class="lb-empty">❌ 排行榜加载失败，请稍后重试</div>';
    }
}
