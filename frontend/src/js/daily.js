// MmaGuessr · 每日挑战面板
// 依赖 src/js/config.js、src/js/api.js、src/js/game.js、src/js/auth.js（HTML 中按该顺序加载）。

let dailyPanelState = null; // { date, locations, played }

async function openDailyPanel() {
    const identity = MmaApi.getIdentity();
    if (!identity || identity.role !== 'user') {
        showToast('📅 每日挑战需登录后参与');
        openAccount();
        return;
    }
    $('daily-overlay').classList.add('show');
    const content = $('daily-content');
    content.innerHTML = '<div class="lb-empty">⏳ 正在获取今日挑战...</div>';
    try {
        const challenge = await MmaApi.getDaily();
        dailyPanelState = challenge;
        renderDailyPanel(content, challenge);
    } catch (e) {
        content.innerHTML =
            '<div class="lb-empty">❌ 获取每日挑战失败' +
            (e.message ? '：' + escapeHtml(e.message) : '') +
            '，请稍后重试。</div>';
    }
}

function closeDailyPanel() {
    $('daily-overlay').classList.remove('show');
}

let dailyStartDelegationReady = false;

function renderDailyPanel(content, challenge) {
    if (!dailyStartDelegationReady) {
        dailyStartDelegationReady = true;
        content.addEventListener('click', (event) => {
            if (event.target.closest('.lb-start')) startDailyGame();
        });
    }
    const best = getBest('daily');
    const diffs = [...new Set(challenge.locations.map((l) => l.difficulty))].sort();
    const diffText = diffs.map((d) => '★'.repeat(d)).join(' ');
    content.innerHTML =
        '<div class="acc-stats">📅 ' +
        escapeHtml(challenge.date) +
        ' · 全球同题 ' +
        challenge.locations.length +
        ' 题 · 难度 ' +
        (diffText || '未知') +
        '</div>' +
        (best ? '<div class="lb-best">🏅 历史最佳：' + Number(best.score) + ' 分</div>' : '') +
        (challenge.played
            ? '<div class="lb-played">✅ 今日挑战已完成，明天再来！</div>'
            : '<button class="lb-start">🚀 开始今日挑战</button>');
}

function startDailyGame() {
    if (!dailyPanelState || dailyPanelState.played) return;
    closeDailyPanel();
    startDailyChallenge(dailyPanelState);
}
