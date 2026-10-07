// MmaGuessr · 练习模式面板
// 依赖 src/js/config.js、data.js、api.js、game.js（HTML 中按该顺序加载）。
// 两种来源：错题回顾（从历史对局挑出低分 / 超时题重练）与附近随机（地图选点半径内随机出题）。
// 练习题目自带答案坐标，走本地判分；成绩仅本地保存，不计入排行榜 / 天梯 / 成就。

const PRACTICE_WRONG_SCORE = 2000; // 低于该分数视为错题（满分 5000）
const PRACTICE_WRONG_LIMIT = 50;

let practiceTab = 'wrong'; // 'wrong' | 'nearby'
let practiceWrongItems = [];
let practiceMap = null;
let practiceMarker = null;

// ==========================================================
// 【面板开关 / 切换】
// ==========================================================
function openPracticePanel() {
    $('practice-overlay').classList.add('show');
    switchPracticeTab(practiceTab);
}

function closePracticePanel() {
    $('practice-overlay').classList.remove('show');
}

function switchPracticeTab(tab) {
    practiceTab = tab === 'nearby' ? 'nearby' : 'wrong';
    $('practice-tab-wrong').classList.toggle('active', practiceTab === 'wrong');
    $('practice-tab-nearby').classList.toggle('active', practiceTab === 'nearby');
    $('practice-wrong').style.display = practiceTab === 'wrong' ? 'block' : 'none';
    $('practice-nearby').style.display = practiceTab === 'nearby' ? 'block' : 'none';
    if (practiceTab === 'wrong') {
        loadWrongAnswers();
    } else {
        initPracticeMap();
    }
}

// ==========================================================
// 【错题回顾】
// ==========================================================
async function loadWrongAnswers() {
    const list = $('practice-wrong-list');
    list.innerHTML = '<div class="lb-empty">⏳ 正在加载历史记录...</div>';
    practiceWrongItems = [];

    // 在线优先用服务端历史（含每轮答案坐标）；离线回落到本地历史并按地点名反查坐标
    let games = null;
    if (MmaApi.isOnline()) {
        try {
            const result = await MmaApi.getRecent(HIST_MAX);
            games = result.games.map(serverGameToLocal);
        } catch (e) {
            games = null;
        }
    }
    if (!games) games = loadHistory();

    const seen = new Set();
    const items = [];
    games.forEach((game) => {
        (game.rounds || []).forEach((round) => {
            const wrong =
                round.distanceKm == null || (typeof round.score === 'number' && round.score < PRACTICE_WRONG_SCORE);
            if (!wrong) return;

            let lat = round.answerLat;
            let lng = round.answerLng;
            let region = null;
            let difficulty = round.difficulty || 3;
            if (lat == null || lng == null) {
                const loc = findLocationByName(round.name);
                if (!loc) return;
                lat = loc.lat;
                lng = loc.lng;
                region = loc.region;
                difficulty = loc.difficulty || difficulty;
            }
            const key = round.name + '|' + lat.toFixed(4) + ',' + lng.toFixed(4);
            if (seen.has(key)) return;
            seen.add(key);
            items.push({
                name: round.name,
                lat,
                lng,
                difficulty,
                region: region || 'world',
                imageId: round.imageId || null,
                panoramaUrl: round.panoramaUrl || null,
                distanceKm: round.distanceKm,
                score: round.score,
                modeLabel: game.modeLabel,
            });
        });
    });
    practiceWrongItems = items.slice(0, PRACTICE_WRONG_LIMIT);
    renderWrongList();
}

function findLocationByName(name) {
    if (!name) return null;
    for (let i = 0; i < LOCATIONS.length; i++) {
        if (LOCATIONS[i].name === name) return LOCATIONS[i];
    }
    return null;
}

function renderWrongList() {
    const list = $('practice-wrong-list');
    if (!practiceWrongItems.length) {
        list.innerHTML =
            '<div class="lb-empty">🎉 暂未找到错题记录<br><span style="font-size:12px">完成几局游戏后再来看看，或使用「附近随机」练习</span></div>';
        return;
    }
    list.innerHTML = practiceWrongItems
        .map((item, index) => {
            const dist =
                item.distanceKm == null
                    ? '超时'
                    : item.distanceKm < 1
                      ? Math.round(item.distanceKm * 1000) + 'm'
                      : item.distanceKm.toFixed(0) + 'km';
            const score = item.score == null ? 0 : item.score;
            return `<label class="practice-wrong-row">
                <input type="checkbox" class="practice-wrong-check" data-index="${index}" checked />
                <span class="pw-name">${escapeHtml(item.name)}</span>
                <span class="pw-meta">${escapeHtml(item.modeLabel || '')}</span>
                <span class="pw-meta">${dist} · ${score}分</span>
            </label>`;
        })
        .join('');
}

function startWrongPractice() {
    const selected = [];
    document.querySelectorAll('.practice-wrong-check').forEach((checkbox) => {
        if (!checkbox.checked) return;
        const item = practiceWrongItems[Number(checkbox.dataset.index)];
        if (!item) return;
        selected.push({
            name: item.name,
            lat: item.lat,
            lng: item.lng,
            difficulty: item.difficulty,
            region: item.region,
            imageId: item.imageId,
            panoramaUrl: item.panoramaUrl,
        });
    });
    if (!selected.length) {
        showToast('⚠️ 请至少选择一道题');
        return;
    }
    closePracticePanel();
    startPractice({ label: '🔁 错题回顾', locations: selected });
}

// ==========================================================
// 【附近随机】
// ==========================================================
function initPracticeMap() {
    if (!$('practice-map')) return;
    if (!practiceMap) {
        practiceMap = L.map('practice-map').setView([30, 105], 3);
        createBasemapLayer().addTo(practiceMap);
        registerBasemapMap(practiceMap);
        practiceMap.on('click', onPracticeMapClick);
    }
    // 默认以最近一条错题坐标作为中心，便于直接练习薄弱区域
    if (!$('practice-lat').value && practiceWrongItems.length) {
        const first = practiceWrongItems[0];
        setPracticeCenter(first.lat, first.lng);
    }
    setTimeout(() => practiceMap.invalidateSize(), 50);
}

function onPracticeMapClick(event) {
    setPracticeCenter(event.latlng.lat, event.latlng.lng);
}

function setPracticeCenter(lat, lng) {
    $('practice-lat').value = lat.toFixed(5);
    $('practice-lng').value = lng.toFixed(5);
    if (practiceMap) {
        if (practiceMarker) practiceMap.removeLayer(practiceMarker);
        practiceMarker = L.marker([lat, lng]).addTo(practiceMap);
    }
    const hint = $('practice-nearby-hint');
    if (hint) hint.textContent = '中心点：' + lat.toFixed(4) + ', ' + lng.toFixed(4);
}

function startNearbyPractice() {
    const lat = parseFloat($('practice-lat').value);
    const lng = parseFloat($('practice-lng').value);
    const radius = Number($('practice-radius').value) || 200;
    const count = Number($('practice-count').value) || 5;
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        showToast('⚠️ 请先在地图上选点或填写有效经纬度');
        return;
    }
    const nearby = LOCATIONS.filter((loc) => haversineKm(lat, lng, loc.lat, loc.lng) <= radius);
    if (!nearby.length) {
        showToast('⚠️ 该范围内没有题库地点，请扩大半径或换个中心点');
        return;
    }
    const picked = shuffle(nearby)
        .slice(0, Math.min(count, nearby.length))
        .map((loc) => ({
            name: loc.name,
            lat: loc.lat,
            lng: loc.lng,
            difficulty: loc.difficulty,
            region: loc.region,
        }));
    closePracticePanel();
    startPractice({ label: '📍 附近随机', locations: picked });
}

function haversineKm(lat1, lng1, lat2, lng2) {
    const earthRadiusKm = 6371;
    const toRad = Math.PI / 180;
    const dLat = (lat2 - lat1) * toRad;
    const dLng = (lng2 - lng1) * toRad;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
