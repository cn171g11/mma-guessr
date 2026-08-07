// MmaGuessr · 多人对战（socket.io 客户端）
// 依赖 src/js/config.js、src/js/api.js、src/js/game.js（HTML 中须先加载 socket.io 客户端库）。
// 服务端已按 60s 定时结算回合，本端仅做倒计时展示与提交距离。

let mpState = {
    socket: null,
    inMatch: false,
    waitingResult: false,
    roomId: null,
    opponentUsername: null,
    roundIndex: 0,
    currentLocation: null,
    myId: null,
    myScore: 0,
    timerId: null,
};

function mpMyId() {
    const identity = MmaApi.getIdentity();
    if (!identity) return null;
    if (identity.role === 'user') return identity.user ? identity.user.id : null;
    return identity.profile ? identity.profile.guestId : null;
}

function mpSetStatus(text) {
    const el = $('mp-status');
    if (el) el.textContent = text;
}

function mpSetLobby(playing) {
    $('mp-find-btn').style.display = playing ? 'none' : 'block';
    $('mp-cancel-btn').style.display = playing ? 'block' : 'none';
}

function openMpPanel() {
    $('mp-overlay').classList.add('show');
    if (!MmaApi.isOnline()) {
        mpSetStatus('📴 当前离线，无法进行对战');
        return;
    }
    if (!mpState.socket || !mpState.socket.connected) {
        mpSetStatus('⏳ 正在连接服务器...');
        createMpSocket();
    } else {
        mpSetStatus('✅ 已连接 · 点击「开始匹配」');
    }
}

function mpCloseLobby() {
    const overlay = $('mp-overlay');
    if (overlay && overlay.classList.contains('show')) {
        if (mpState.socket && mpState.socket.connected && !mpState.inMatch) {
            mpState.socket.emit('mp:leave');
        }
    }
    $('mp-overlay').classList.remove('show');
    mpSetStatus('尚未连接');
    if (!mpState.inMatch) mpSetLobby(false);
}

function createMpSocket() {
    const token = MmaApi.getAccessToken() || MmaApi.getGuestToken();
    if (!token) {
        mpSetStatus('❌ 未取得身份令牌，请刷新页面重试');
        return;
    }
    const socket = io(API_BASE, { auth: { token } });
    mpState.socket = socket;

    socket.on('connect', () => {
        if (!mpState.inMatch) mpSetStatus('✅ 已连接 · 点击「开始匹配」');
    });
    socket.on('disconnect', () => {
        if (mpState.inMatch) {
            showToast('⏹️ 连接已断开，对局中止');
            mpCleanup();
            backHome();
        } else {
            mpSetStatus('📴 连接断开，请重试');
        }
    });
    socket.on('connect_error', () => {
        if (!mpState.inMatch) mpSetStatus('❌ 连接服务器失败，请确认后端已启动');
    });
    socket.on('mp:queued', (data) => {
        mpSetStatus('⏳ 排队中... 队列第 ' + (data ? data.position : '?') + ' 位');
        mpSetLobby(true);
    });
    socket.on('mp:leftQueue', () => {
        mpSetStatus('已取消匹配');
        mpSetLobby(false);
    });
    socket.on('mp:matched', (data) => enterMatch(data));
    socket.on('mp:round', (data) => mpStartRound(data));
    socket.on('mp:roundEnd', (data) => mpShowRoundEnd(data));
    socket.on('mp:finished', (data) => mpShowFinished(data));
    socket.on('mp:opponentLeft', () => {
        showToast('👋 对方已退出，对局中止');
        mpCleanup();
        backHome();
    });
    socket.on('mp:error', (data) => {
        const message = data && data.message ? data.message : '对战出现异常';
        if (mpState.inMatch) {
            showToast('❌ ' + message);
            mpCleanup();
        } else {
            mpSetStatus('❌ ' + message);
        }
    });
}

function mpFindMatch() {
    if (!mpState.socket || !mpState.socket.connected) {
        mpSetStatus('⏳ 正在连接服务器...');
        createMpSocket();
        return;
    }
    if (mpState.inMatch) return;
    mpSetStatus('🔍 匹配中...');
    mpSetLobby(true);
    mpState.socket.emit('mp:join', { mode: 'duel' });
}

function mpCancelMatch() {
    if (mpState.socket && mpState.socket.connected) {
        mpState.socket.emit('mp:leave');
    }
    mpSetStatus('已取消匹配');
    mpSetLobby(false);
}

// ==========================================================
// 【对局中】
// ==========================================================
function enterMatch(data) {
    mpState.inMatch = true;
    mpState.roomId = data && data.roomId ? data.roomId : null;
    mpState.opponentUsername = (data && data.opponentUsername) || '对手';
    mpState.myId = mpMyId();
    mpState.myScore = 0;
    mpState.waitingResult = false;
    mpActive = true;

    $('mp-overlay').classList.remove('show');
    mpSetLobby(false);
    $('home-screen').style.display = 'none';
    $('game-container').classList.add('show');
    $('info-bar').classList.add('show');
    $('minimap-container').classList.add('show');
    $('submit-btn').classList.add('show');
    $('quit-btn').classList.add('show');
    $('level-panel').classList.remove('show');
    $('mode-tag').textContent = '⚔️ 对战 · vs ' + mpState.opponentUsername;
    $('total-score').textContent = '0';
    showToast('🎮 匹配成功！对战 ' + mpState.opponentUsername);
}

function mpStartRound(data) {
    mpState.roundIndex = data.roundIndex;
    mpState.currentLocation = data.location || null;
    mpState.waitingResult = false;
    const location = mpState.currentLocation;

    $('round-info').innerHTML =
        '第 <span class="round" id="round-num">' +
        (data.roundIndex + 1) +
        '</span> 轮 / 共 <span id="total-rounds">' +
        data.totalRounds +
        '</span> 轮';
    $('submit-btn').disabled = true;
    $('submit-btn').textContent = '🎯 提交选择';
    guessPoint = null;
    clearMapLayers();
    map.invalidateSize();
    safeFly(
        () => map.flyTo([20, 0], 2, { duration: 0.8 }),
        () => map.setView([20, 0], 2, { animate: false })
    );

    $('result-overlay').classList.remove('show');
    $('panorama-loading').style.display = 'flex';
    $('panorama-fallback').style.display = 'none';

    if (location && location.mapillaryId) {
        showPanorama(location.mapillaryId);
    } else if (location && location.panoramaUrl) {
        // 无街景 ID 时退化为直接展示全景图 URL；走 DOM 构建而非 innerHTML，防止 URL 被注入为标签
        showPanoramaUrl(location.panoramaUrl);
    } else {
        $('panorama-loading').style.display = 'none';
        $('panorama-fallback').style.display = 'flex';
    }
    mpStartTimer(data.timeLimitMs);
}

function mpStartTimer(ms) {
    mpStopTimer();
    let left = Math.ceil(ms / 1000);
    $('timer-box').classList.add('show');
    $('timer-box').classList.remove('danger');
    $('timer-num').textContent = left;
    mpState.timerId = setInterval(() => {
        left--;
        $('timer-num').textContent = left;
        if (left <= 10) $('timer-box').classList.add('danger');
        if (left <= 0) {
            clearInterval(mpState.timerId);
            mpState.timerId = null;
            $('submit-btn').disabled = true;
            $('submit-btn').textContent = '等待结果...';
            mpState.waitingResult = true;
        }
    }, 1000);
}

function mpStopTimer() {
    if (mpState.timerId) {
        clearInterval(mpState.timerId);
        mpState.timerId = null;
    }
    const box = $('timer-box');
    if (box) box.classList.remove('show');
}

function mpSubmitGuess() {
    if (mpState.waitingResult || !mpState.currentLocation || !guessPoint || $('submit-btn').disabled) return;
    mpState.waitingResult = true;
    $('submit-btn').disabled = true;
    $('submit-btn').textContent = '已提交，等待对方...';
    mpStopTimer();
    // 答案坐标仅由服务端权威持有，本端只提交猜测点坐标，距离与得分由服务端计算
    mpState.socket.emit('mp:answer', {
        guessLat: guessPoint.lat,
        guessLng: guessPoint.lng,
        roundIndex: mpState.roundIndex,
    });
}

function fmtMpDistance(distanceKm) {
    if (distanceKm == null) return '未作答';
    return distanceKm < 1
        ? Math.round(distanceKm * 1000) + ' 米'
        : distanceKm.toFixed(distanceKm < 100 ? 2 : 0) + ' 公里';
}

function mpShowRoundEnd(data) {
    mpStopTimer();
    mpState.waitingResult = false;
    const results = Array.isArray(data.results) ? data.results : [];
    const me = results.find((r) => r.playerId === mpState.myId);
    const opponent = results.find((r) => r.playerId !== mpState.myId);
    const myScore = me ? me.score : 0;
    mpState.myScore += myScore;
    $('total-score').textContent = mpState.myScore;

    const target = L.latLng(data.answer.lat, data.answer.lng);
    answerMarker = L.marker(target, { icon: blueIcon }).addTo(map);
    if (guessPoint) {
        routeLine = L.polyline([guessPoint, target], {
            color: '#ff4757',
            weight: 4,
            opacity: 0.9,
            dashArray: '8, 8',
            lineCap: 'round',
        }).addTo(map);
    }
    const group = guessPoint ? L.featureGroup([guessMarker, answerMarker]) : L.featureGroup([answerMarker]);
    safeFly(
        () => map.flyToBounds(group.getBounds().pad(0.4), { duration: 1.2 }),
        () => map.fitBounds(group.getBounds().pad(0.4), { animate: false })
    );

    $('new-record').style.display = 'none';
    $('result-title').textContent = '📊 第 ' + (data.roundIndex + 1) + ' 轮结果';
    $('result-location').textContent = '📍 正确答案：' + data.answer.name;
    $('result-distance').textContent = me
        ? '我的猜测：' + fmtMpDistance(me.distanceKm) + ' · 得 ' + myScore + ' 分'
        : '未提交猜测';
    const sum = $('round-summary');
    sum.innerHTML =
        '<div class="row"><span>对手：' +
        escapeHtml(mpState.opponentUsername) +
        '</span><span>' +
        escapeHtml(opponent ? fmtMpResult(opponent.distanceKm, opponent.score) : '--') +
        '</span></div>';
    sum.style.display = 'block';
    $('next-btn').textContent = '下一轮 ▶';
    $('next-btn').style.display = 'inline-block';
    $('next-btn').onclick = () => $('result-overlay').classList.remove('show');
    $('share-btn').style.display = 'none';
    $('home-btn2').style.display = 'none';
    $('result-score').textContent = '+' + myScore + ' 分';
    $('result-xp').style.display = 'none';
    $('result-overlay').classList.add('show');
}

function fmtMpResult(distanceKm, score) {
    const d = distanceKm == null ? '超时' : fmtDistanceLabel(distanceKm);
    return d + ' · ' + score + ' 分';
}

function fmtDistanceLabel(distanceKm) {
    return distanceKm < 1 ? Math.round(distanceKm * 1000) + 'm' : distanceKm.toFixed(0) + 'km';
}

function mpShowFinished(data) {
    mpStopTimer();
    const rankings = Array.isArray(data.rankings) ? data.rankings : [];
    const me = rankings.find((r) => r.playerId === mpState.myId);
    const opponent = rankings.find((r) => r.playerId !== mpState.myId);
    const myTotal = me ? me.totalScore : mpState.myScore;
    const oppTotal = opponent ? opponent.totalScore : 0;
    const isWin = me && opponent ? myTotal > oppTotal : false;

    $('result-title').textContent = isWin ? '🏆 你战胜了！' : '🥈 ' + mpState.opponentUsername + ' 更胜一筹';
    $('result-location').textContent = '对战 ' + mpState.opponentUsername + ' · 总分 ' + myTotal + ' : ' + oppTotal;
    $('result-distance').textContent = rankings.map((r) => r.username + '：' + r.totalScore + ' 分').join(' ');
    $('result-score').textContent = isWin ? '🎉 恭喜获胜！' : '🔥 再来一局！';
    $('round-summary').style.display = 'none';
    $('new-record').style.display = 'none';
    $('next-btn').style.display = 'none';
    $('share-btn').style.display = 'none';
    $('home-btn2').style.display = 'inline-block';
    $('result-xp').style.display = 'none';
    $('result-overlay').classList.add('show');
    mpCleanup();
}

function mpCleanup() {
    mpStopTimer();
    mpState.inMatch = false;
    mpState.roomId = null;
    mpState.opponentUsername = null;
    mpState.currentLocation = null;
    mpState.myId = null;
    mpState.myScore = 0;
    mpActive = false;
}

function mpQuit() {
    if (!confirm('确定退出对局吗？')) return;
    const socket = mpState.socket;
    mpCleanup();
    if (socket) socket.disconnect();
    backHome();
}
