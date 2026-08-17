// MmaGuessr · 功能补全（好友/私房辅助/回放/天梯/图鉴/日榜/赞助/冷知识）
// 依赖 src/js/api.js、game.js、mp.js 中定义的全局函数（在 mp.js 之后加载）。

// ---------------------------------------------------------------
// 冷知识：结果弹窗出现「正确答案：地点名」时，自动拉取地点知识
// ---------------------------------------------------------------
(function setupFactLine() {
    const resultLocation = document.getElementById('result-location');
    const factLine = document.getElementById('result-fact');
    if (!resultLocation || !factLine) return;
    const observer = new MutationObserver(() => {
        const text = resultLocation.textContent || '';
        const match = text.match(/正确答案：(.+)$/);
        if (!match) {
            factLine.style.display = 'none';
            factLine.textContent = '';
            return;
        }
        const name = match[1].trim();
        if (!name) return;
        MmaApi.getFact(name)
            .then((data) => {
                factLine.textContent = '💡 ' + data.fact;
                factLine.style.display = 'block';
            })
            .catch(() => {
                factLine.style.display = 'none';
            });
    });
    observer.observe(resultLocation, { childList: true, characterData: true, subtree: true });
})();

// ---------------------------------------------------------------
// 账号面板：好友 / 天梯 / 图鉴
// ---------------------------------------------------------------
function currentUserId() {
    const identity = MmaApi.getIdentity();
    if (!identity || identity.role !== 'user' || !identity.user) return null;
    return identity.user.id;
}

function showToastSafe(message) {
    if (typeof showToast === 'function') showToast(message);
    else alert(message);
}

async function refreshFriendsPanel() {
    const container = document.getElementById('friend-list');
    const requestsBox = document.getElementById('friend-requests');
    if (!container || !requestsBox) return;
    if (!currentUserId()) {
        requestsBox.innerHTML = '<div class="hist-empty">登录后即可添加好友</div>';
        container.innerHTML = '';
        return;
    }
    let data;
    try {
        data = await MmaApi.listFriendRequests();
    } catch (e) {
        return;
    }
    const incoming = data.incoming || [];
    const outgoing = data.outgoing || [];
    if (incoming.length === 0 && outgoing.length === 0) {
        requestsBox.innerHTML = '';
    } else {
        requestsBox.innerHTML =
            incoming
                .map(
                    (r) =>
                        `<div class="friend-item">
                            <span class="fr-name">${escapeHtml(r.username)} 请求加你为好友</span>
                            <span class="fr-actions">
                                <button class="hist-replay" data-accept="${escapeHtml(r.id)}">接受</button>
                                <button class="hist-delete" data-reject="${escapeHtml(r.id)}">拒绝</button>
                            </span>
                        </div>`
                )
                .join('') +
            outgoing
                .map(
                    (r) =>
                        `<div class="friend-item"><span class="fr-name">已向 ${escapeHtml(r.username)} 发出请求</span></div>`
                )
                .join('');
    }
    let friends;
    try {
        friends = await MmaApi.listFriends();
    } catch (e) {
        return;
    }
    const list = friends.friends || [];
    if (list.length === 0) {
        container.innerHTML = '<div class="hist-empty">还没有好友</div>';
        return;
    }
    container.innerHTML =
        '<div class="acc-stats">共 ' +
        list.length +
        ' 位好友</div>' +
        list
            .map(
                (f) =>
                    `<div class="friend-item">
                        <span class="fr-name">${escapeHtml(f.username)}</span>
                        <span class="fr-actions">
                            <button class="hist-delete" data-remove="${escapeHtml(f.id)}">删除</button>
                        </span>
                    </div>`
            )
            .join('');
}

async function refreshLadder() {
    const container = document.getElementById('account-ladder');
    if (!container) return;
    if (!currentUserId()) {
        container.style.display = 'none';
        return;
    }
    let data;
    try {
        data = await MmaApi.getRatings();
    } catch (e) {
        container.style.display = 'none';
        return;
    }
    const rating = data.rating || {};
    const tierLabel = rating.tierName ? rating.tierName + ' · Lv.' + rating.tier : '';
    const nextTier = rating.nextTier ? ' · 距 ' + rating.nextTier + ' 一步之遥' : '';
    container.style.display = 'block';
    container.innerHTML =
        `<div class="acc-stats">🎯 天梯段位：${escapeHtml(tierLabel)} · ${rating.rating} 分${escapeHtml(nextTier)}</div>` +
        `<div class="acc-stats">胜场 ${rating.wins} · 最高连胜 ${rating.bestStreak} 场 · 赛季 ${escapeHtml(rating.season)}</div>` +
        '<div class="lb-sub">天梯前 5</div>' +
        (data.leaderboard || [])
            .slice(0, 5)
            .map(
                (entry, index) =>
                    `<div class="friend-item"><span class="fr-name">${index + 1}. ${escapeHtml(entry.username)}</span>
                     <span class="fr-name">${escapeHtml(entry.tierName)} · ${entry.rating} 分</span></div>`
            )
            .join('');
}

async function refreshCollections() {
    const container = document.getElementById('collection-list');
    if (!container) return;
    if (!currentUserId()) {
        container.innerHTML = '<div class="hist-empty">登录后可见地点图鉴</div>';
        return;
    }
    let data;
    try {
        data = await MmaApi.getCollections();
    } catch (e) {
        return;
    }
    const items = data.items || [];
    if (items.length === 0) {
        container.innerHTML =
            '<div class="hist-empty">还没有收集到地点<br><span style="font-size:12px">答对地点即可点亮图鉴</span></div>';
        return;
    }
    container.innerHTML =
        `<div class="acc-stats">🗺️ 已点亮 ${data.total} 个地点</div>` +
        items
            .slice(0, 50)
            .map(
                (item) =>
                    `<div class="friend-item"><span class="fr-name">📍 ${escapeHtml(item.name)}</span>
                     <span class="fr-name">×${item.count}</span></div>`
            )
            .join('');
}

// 好友按钮事件委托
document.getElementById('friend-requests').addEventListener('click', async (event) => {
    const accept = event.target.closest('[data-accept]');
    const reject = event.target.closest('[data-reject]');
    try {
        if (accept) {
            await MmaApi.acceptFriendRequest(accept.dataset.accept);
            showToastSafe('✅ 已成为好友');
        } else if (reject) {
            await MmaApi.rejectFriendRequest(reject.dataset.reject);
        } else {
            return;
        }
        await refreshFriendsPanel();
    } catch (e) {
        showToastSafe('❌ 操作失败：' + (e.message || ''));
    }
});
document.getElementById('friend-list').addEventListener('click', async (event) => {
    const remove = event.target.closest('[data-remove]');
    if (!remove) return;
    if (!confirm('确定删除这位好友吗？')) return;
    try {
        await MmaApi.removeFriend(remove.dataset.remove);
        await refreshFriendsPanel();
    } catch (e) {
        showToastSafe('❌ 删除失败');
    }
});
document.getElementById('friend-add-btn').addEventListener('click', async () => {
    const input = document.getElementById('friend-username');
    const username = (input.value || '').trim();
    if (!username) return;
    try {
        await MmaApi.sendFriendRequest(username);
        showToastSafe('✅ 好友请求已发送');
        input.value = '';
        await refreshFriendsPanel();
    } catch (e) {
        showToastSafe('❌ ' + (e.message || '添加失败'));
    }
});
document.getElementById('friend-username').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') document.getElementById('friend-add-btn').click();
});

// ---------------------------------------------------------------
// 每日挑战计分榜
// ---------------------------------------------------------------
async function refreshDailyLeaderboard() {
    const box = document.getElementById('daily-lb');
    if (!box) return;
    if (!MmaApi.isOnline()) {
        box.style.display = 'none';
        return;
    }
    let data;
    try {
        data = await MmaApi.getDailyLeaderboard();
    } catch (e) {
        box.style.display = 'none';
        return;
    }
    box.style.display = 'block';
    const entries = data.entries || [];
    if (entries.length === 0) {
        box.innerHTML = '<div class="acc-stats">今日暂无玩家上榜</div>';
        return;
    }
    box.innerHTML =
        '<div class="lb-sub">🏆 今日计分榜</div>' +
        entries
            .map(
                (entry, index) =>
                    `<div class="friend-item"><span class="fr-name">${index + 1}. ${escapeHtml(entry.username)}</span>
                     <span class="fr-name">${entry.score} 分</span></div>`
            )
            .join('');
}

// ---------------------------------------------------------------
// 对局回放
// ---------------------------------------------------------------
let replayMap = null;
let replayMarkers = [];
let replayRounds = [];

function ensureReplayMap() {
    if (replayMap) return;
    replayMap = L.map('replay-map', { worldCopyJump: true, zoomControl: true }).setView([20, 0], 2);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap',
        maxZoom: 19,
    }).addTo(replayMap);
}

function clearReplayMarkers() {
    replayMarkers.forEach((layer) => replayMap.removeLayer(layer));
    replayMarkers = [];
}

function showReplayRound(round, roundIndex) {
    ensureReplayMap();
    clearReplayMarkers();
    const guessLat = round.guessLat;
    const guessLng = round.guessLng;
    const answerLat = round.answerLat;
    const answerLng = round.answerLng;
    const bounds = [];
    if (answerLat != null && answerLng != null) {
        const marker = L.marker(L.latLng(answerLat, answerLng), { icon: L.divIcon({ className: 'rp-blue-dot' }) });
        marker.bindPopup('正确答案：' + escapeHtml(round.name || ''));
        marker.addTo(replayMap);
        replayMarkers.push(marker);
        bounds.push([answerLat, answerLng]);
    }
    if (guessLat != null && guessLng != null) {
        const marker = L.marker(L.latLng(guessLat, guessLng));
        marker.bindPopup('你的猜测（第 ' + (roundIndex + 1) + ' 轮）');
        marker.addTo(replayMap);
        replayMarkers.push(marker);
        bounds.push([guessLat, guessLng]);
        if (answerLat != null && answerLng != null) {
            const line = L.polyline(
                [
                    [guessLat, guessLng],
                    [answerLat, answerLng],
                ],
                { color: '#ff5252', weight: 2, dashArray: '6,6' }
            );
            line.addTo(replayMap);
            replayMarkers.push(line);
        }
    }
    if (bounds.length > 0) {
        replayMap.fitBounds(L.latLngBounds(bounds).pad(0.3));
    } else {
        replayMap.setView([20, 0], 2);
    }
}

async function openReplay(key) {
    let game;
    try {
        const data = await MmaApi.getGame(key);
        game = data.game;
    } catch (e) {
        showToastSafe('❌ 无法读取该对局');
        return;
    }
    const summary = document.getElementById('replay-summary');
    const list = document.getElementById('replay-list');
    const modeLabels = {
        classic: '经典',
        challenge: '挑战',
        region: '区域',
        china: '中国',
        endless: '无限',
        daily: '每日',
        landmark: '地标',
        duel: '对战',
    };
    summary.textContent =
        (modeLabels[game.mode] || game.mode) + ' · 总分 ' + game.totalScore + ' 分 · ' + game.createdAt;
    const rounds = game.rounds || [];
    replayRounds = rounds;
    list.innerHTML = rounds
        .map((round, index) => {
            const dist =
                round.distanceKm == null
                    ? '超时'
                    : round.distanceKm < 1
                      ? Math.round(round.distanceKm * 1000) + 'm'
                      : round.distanceKm.toFixed(0) + 'km';
            return `<div class="hist-replay-item" data-rp-index="${index}">
                    <span class="hr-round">r${index + 1}</span>
                    <span class="hr-name">${escapeHtml(round.name || '未知地点')}</span>
                    <span class="hr-dist">${dist}</span>
                    <span class="hr-score">${round.score}分</span>
                </div>`;
        })
        .join('');
    document.getElementById('replay-overlay').classList.add('show');
    if (rounds.length > 0) showReplayRound(rounds[0], 0);
    setTimeout(() => replayMap && replayMap.invalidateSize(), 60);
}

document.getElementById('replay-list').addEventListener('click', (event) => {
    const item = event.target.closest('[data-rp-index]');
    if (!item) return;
    const index = Number(item.dataset.rpIndex);
    showReplayRound(replayRounds[index], index);
});

document.getElementById('replay-close-btn').addEventListener('click', () => {
    document.getElementById('replay-overlay').classList.remove('show');
});
document.getElementById('replay-overlay').addEventListener('click', (event) => {
    if (event.target === document.getElementById('replay-overlay')) {
        document.getElementById('replay-overlay').classList.remove('show');
    }
});

// 历史列表回放按钮委托
document.getElementById('history-list').addEventListener('click', (event) => {
    const button = event.target.closest('.hist-replay');
    if (!button) return;
    openReplay(button.dataset.key);
});

// ---------------------------------------------------------------
// 赞助
// ---------------------------------------------------------------
async function openSponsors() {
    document.getElementById('sponsor-overlay').classList.add('show');
    const box = document.getElementById('sponsor-list');
    box.innerHTML = '<div class="acc-stats">加载中...</div>';
    try {
        const data = await MmaApi.getSponsors();
        const sponsors = data.sponsors || [];
        if (sponsors.length === 0) {
            box.innerHTML =
                '<div class="hist-empty">感谢名单还是空的<br><span style="font-size:12px">第一位赞助者会出现在这里</span></div>';
            return;
        }
        box.innerHTML = sponsors
            .map(
                (sp) =>
                    `<div class="friend-item"><span class="fr-name">❤️ ${escapeHtml(sp.name)}</span>
                     <span class="fr-name">${sp.note ? escapeHtml(sp.note) : ''}</span></div>`
            )
            .join('');
    } catch (e) {
        box.innerHTML = '<div class="hist-empty">暂时无法加载</div>';
    }
}

document.getElementById('btn-sponsors').addEventListener('click', openSponsors);
document.getElementById('sponsor-close-btn').addEventListener('click', () => {
    document.getElementById('sponsor-overlay').classList.remove('show');
});
document.getElementById('sponsor-overlay').addEventListener('click', (event) => {
    if (event.target === document.getElementById('sponsor-overlay')) {
        document.getElementById('sponsor-overlay').classList.remove('show');
    }
});

// ---------------------------------------------------------------
// 第三方登录（OAuth）：有可用提供方时展示按钮；处理回调结果提示
// ---------------------------------------------------------------
(function setupOAuthLogin() {
    const divider = document.getElementById('oauth-divider');
    const button = document.getElementById('oauth-google-btn');
    if (!divider || !button) return;

    // 拉取可用提供方，动态显示/隐藏登录表单里的第三方按钮
    async function refreshOAuthButton() {
        try {
            const data = await MmaApi.getOAuthProviders();
            const providers = data.providers || [];
            const first = providers[0];
            if (!first) {
                divider.style.display = 'none';
                button.style.display = 'none';
                return;
            }
            divider.style.display = 'flex';
            button.style.display = 'block';
            button.textContent = '🔑 使用 ' + first.label + ' 登录';
            button.onclick = () => {
                // 整页跳转授权：回调会携带 HttpOnly 刷新令牌回到前端
                window.location.href = API_BASE + '/api/oauth/authorize/' + encodeURIComponent(first.name);
            };
        } catch (e) {
            divider.style.display = 'none';
            button.style.display = 'none';
        }
    }

    // 打开账号面板时同步按钮状态（登录成功后表单隐藏，无需再拉取）
    const originalRefreshAccount = window.refreshAccountPanel;
    if (typeof originalRefreshAccount === 'function') {
        window.refreshAccountPanel = async function () {
            const result = originalRefreshAccount();
            if (result && typeof result.then === 'function') await result;
            refreshOAuthButton();
        };
    }
    refreshOAuthButton();

    // 服务端回调重定向到 /?oauth=success|failed：提示并清理 URL 参数
    const oauthResult = new URLSearchParams(window.location.search).get('oauth');
    if (oauthResult) {
        window.addEventListener('load', () => {
            setTimeout(() => {
                if (oauthResult === 'success') {
                    showToastSafe('✅ 第三方登录成功');
                    if (typeof refreshAccountPanel === 'function') refreshAccountPanel();
                } else {
                    showToastSafe('❌ 第三方登录失败，请重试');
                }
                const clean = window.location.pathname + window.location.hash;
                history.replaceState(null, '', clean);
            }, 600);
        });
    }
})();

// ---------------------------------------------------------------
// 挂接到既有弹窗打开逻辑
// ---------------------------------------------------------------
(function hookPanels() {
    const originalOpenAccount = window.openAccount;
    if (typeof originalOpenAccount === 'function') {
        window.openAccount = function () {
            originalOpenAccount();
            refreshFriendsPanel();
            refreshLadder();
            refreshCollections();
        };
    }
    const originalOpenDaily = window.openDailyPanel;
    if (typeof originalOpenDaily === 'function') {
        window.openDailyPanel = async function () {
            const result = originalOpenDaily();
            if (result && typeof result.then === 'function') await result;
            refreshDailyLeaderboard();
        };
    }
})();
