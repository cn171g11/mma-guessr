// MmaGuessr · 图包工坊面板
// 依赖 src/js/config.js、api.js、game.js（HTML 中按该顺序加载）。
// 浏览/创建自定义题库，在地图上选点自动解析街景，公开分享给全球玩家。

let packsTab = 'public'; // 'public' | 'mine'
let editingPack = null; // 正在编辑的图包元数据
let editLocations = []; // 编辑器地点集合 [{ name, lat, lng, difficulty, region, imageId, panoramaUrl, source }]
let editorMap = null;
let editorMarker = null;
let pendingPick = null; // 地图上解析出的候选街景 { imageId, panoramaUrl, lat, lng, source }
let packImportSource = 'auto'; // 批量导入来源：'auto' | 'mapillary' | 'tencent'
let packImportBusy = false;

const SOURCE_LABELS = { mapillary: 'Mapillary', tencent: '腾讯街景' };

// ==========================================================
// 【面板开关】
// ==========================================================
async function openPacksPanel() {
    $('packs-overlay').classList.add('show');
    const identity = MmaApi.getIdentity();
    $('packs-create').style.display = identity && identity.role === 'user' ? 'block' : 'none';
    await switchPacksTab(packsTab);
}

function closePacksPanel() {
    $('packs-overlay').classList.remove('show');
}

// ==========================================================
// 【列表】
// ==========================================================
async function switchPacksTab(tab) {
    packsTab = tab;
    const publicBtn = $('pack-tab-public');
    const mineBtn = $('pack-tab-mine');
    publicBtn.classList.toggle('active', tab === 'public');
    mineBtn.classList.toggle('active', tab === 'mine');
    const list = $('pack-list');
    list.innerHTML = '<div class="lb-empty">⏳ 正在加载...</div>';
    try {
        const result = await MmaApi.listPacks(tab === 'mine', '');
        renderPackList(list, result.packs);
    } catch (e) {
        list.innerHTML =
            '<div class="lb-empty">❌ 加载失败' + (e.message ? '：' + escapeHtml(e.message) : '') + '</div>';
    }
}

function myUserId() {
    const identity = MmaApi.getIdentity();
    if (identity && identity.role === 'user' && identity.user) return identity.user.id;
    return null;
}

function renderPackList(list, packs) {
    if (!packs.length) {
        list.innerHTML =
            '<div class="lb-empty">📭 暂无图包' +
            (packsTab === 'mine' ? '，点击上方「＋ 创建图包」开始吧！' : '') +
            '</div>';
        return;
    }
    const uid = myUserId();
    list.innerHTML = packs
        .map((pack) => {
            const mine = uid != null && pack.ownerId === uid;
            const status = pack.isPublic ? '🔓 公开' : '🔒 私密';
            const buttons =
                `<button class="acc-code-btn" data-play="${pack.id}">🚀 游玩</button>` +
                (mine
                    ? `<button class="acc-code-btn" data-edit="${pack.id}">📍 编辑地点</button>` +
                      `<button class="acc-code-btn" data-delete="${pack.id}">🗑 删除</button>`
                    : '');
            return `<div class="lb-row">
                <div class="lb-name">${escapeHtml(pack.name)}</div>
                <span style="color:#8899bb;font-size:12px">${escapeHtml(pack.ownerUsername)}</span>
                <span style="color:#8899bb;font-size:12px">${pack.locationCount} 题 · 游玩 ${pack.playCount} 次</span>
                <span style="color:#8899bb;font-size:12px">${status}</span>
                ${buttons}
            </div>`;
        })
        .join('');
}

function ensurePackListDelegation() {
    const list = $('pack-list');
    if (list.dataset.wired === '1') return;
    list.dataset.wired = '1';
    list.addEventListener('click', (event) => {
        const button = event.target.closest('[data-play], [data-edit], [data-delete]');
        if (!button) return;
        if (button.dataset.play !== undefined) playPack(Number(button.dataset.play));
        else if (button.dataset.edit !== undefined) openPackEditor(Number(button.dataset.edit));
        else if (button.dataset.delete !== undefined) deletePack(Number(button.dataset.delete));
    });
}

// ==========================================================
// 【创建 / 删除 / 游玩】
// ==========================================================
async function createPack() {
    const name = $('pack-name').value.trim();
    const description = $('pack-desc').value.trim();
    if (!name) {
        showToast('⚠️ 请填写图包名称');
        return;
    }
    try {
        const result = await MmaApi.createPack({ name, description, isPublic: $('pack-public').checked });
        $('pack-name').value = '';
        $('pack-desc').value = '';
        showToast('✅ 图包已创建，接下来添加地点！');
        await switchPacksTab('mine');
        openPackEditor(result.pack.id);
    } catch (e) {
        showToast('❌ 创建失败：' + (e.message || '请稍后再试'));
    }
}

async function deletePack(id) {
    if (!confirm('确定删除该图包吗？其地点与游玩记录将一并移除。')) return;
    try {
        await MmaApi.deletePack(id);
        showToast('🗑 图包已删除');
        await switchPacksTab(packsTab);
    } catch (e) {
        showToast('❌ 删除失败：' + (e.message || '请稍后再试'));
    }
}

async function playPack(id) {
    if (!MmaApi.isOnline()) {
        showToast('❌ 图包游玩需要后端连接');
        return;
    }
    try {
        const challenge = await MmaApi.getPackPlay(id);
        if (!challenge.locations || challenge.locations.length === 0) {
            showToast('⚠️ 该图包暂无地点');
            return;
        }
        closePacksPanel();
        startPackGame(challenge);
    } catch (e) {
        showToast('❌ 加载图包失败：' + (e.message || '请稍后再试'));
    }
}

// ==========================================================
// 【地点编辑器】
// ==========================================================
async function openPackEditor(packId) {
    try {
        const meta = await MmaApi.getPack(packId);
        const locs = await MmaApi.getPackLocations(packId);
        editingPack = meta.pack;
        editLocations = (locs.locations || []).map((l) => ({
            name: l.name,
            lat: l.lat,
            lng: l.lng,
            difficulty: l.difficulty,
            region: l.region,
            imageId: l.imageId || null,
            panoramaUrl: l.panoramaUrl || null,
            source: l.source || 'mapillary',
        }));
        pendingPick = null;
        updatePackEditCount();
        $('packedit-preview').innerHTML = '';
        const importInput = $('packedit-import-input');
        if (importInput) importInput.value = '';
        const importStatus = $('packedit-import-status');
        if (importStatus) importStatus.textContent = '';
        renderPackEditList();
        initPackEditorMap();
        $('packedit-overlay').classList.add('show');
    } catch (e) {
        showToast('❌ 加载图包失败：' + (e.message || '请稍后再试'));
    }
}

function closePackEditor() {
    $('packedit-overlay').classList.remove('show');
}

function initPackEditorMap() {
    if (editorMap) {
        editorMap.invalidateSize();
        if (editorMarker) editorMap.removeLayer(editorMarker);
        return;
    }
    editorMap = L.map('packedit-map').setView([20, 0], 2);
    createBasemapLayer().addTo(editorMap);
    registerBasemapMap(editorMap);
    editorMap.on('click', onEditorMapClick);
}

async function onEditorMapClick(e) {
    if (editorMarker) editorMap.removeLayer(editorMarker);
    editorMarker = L.marker(e.latlng).addTo(editorMap);
    const preview = $('packedit-preview');
    preview.innerHTML = '<div class="lb-empty">🔍 正在解析该位置最近的街景...</div>';
    pendingPick = null;
    // 复用游戏内的街景搜索：自动解析最近的 Mapillary 全景图及其真实坐标
    const found = await findMapillaryImage(e.latlng.lat, e.latlng.lng);
    if (!found) {
        preview.innerHTML =
            '<div class="lb-empty">⚠️ 该位置暂无街景覆盖，请换一个位置再试（或拖动地图缩放后重新选点）。</div>';
        return;
    }
    pendingPick = {
        imageId: found.imageId,
        panoramaUrl: found.panoramaUrl,
        lat: found.lat,
        lng: found.lng,
        source: 'mapillary',
    };
    const img = found.panoramaUrl
        ? `<img src="${found.panoramaUrl}" alt="街景预览" style="width:100%;max-height:180px;object-fit:cover;border-radius:10px" />`
        : '';
    preview.innerHTML =
        img +
        '<div class="acc-stats">已解析街景坐标：' +
        found.lat.toFixed(4) +
        ', ' +
        found.lng.toFixed(4) +
        '</div>' +
        '<div class="acc-code-row">' +
        '<input id="pick-name" placeholder="地点名称（120 字以内）" maxlength="120" autocomplete="off" />' +
        '</div>' +
        '<div class="acc-code-row">' +
        '<select id="pick-difficulty">' +
        [1, 2, 3, 4, 5].map((d) => '<option value="' + d + '">难度 ' + '★'.repeat(d) + '</option>').join('') +
        '</select>' +
        '<select id="pick-region">' +
        Object.keys(REGION_NAMES)
            .map((r) => '<option value="' + r + '">' + REGION_NAMES[r] + '</option>')
            .join('') +
        '<option value="world">🌍 世界</option>' +
        '</select>' +
        '<button class="acc-code-btn" id="pick-add-btn">＋ 添加</button>' +
        '</div>';
    $('pick-add-btn').addEventListener('click', addPickedLocation);
}

function addPickedLocation() {
    const name = $('pick-name').value.trim();
    if (!pendingPick || !name) {
        showToast('⚠️ 请填写地点名称');
        return;
    }
    editLocations.push({
        name,
        lat: pendingPick.lat,
        lng: pendingPick.lng,
        difficulty: Number($('pick-difficulty').value),
        region: $('pick-region').value,
        imageId: pendingPick.imageId,
        panoramaUrl: pendingPick.panoramaUrl,
        source: pendingPick.source || 'mapillary',
    });
    updatePackEditCount();
    $('packedit-preview').innerHTML = '';
    pendingPick = null;
    renderPackEditList();
    showToast('✅ 已添加，继续选点或点击保存');
}

function updatePackEditCount() {
    if (!editingPack) return;
    $('packedit-name').textContent = '📦 ' + editingPack.name + '（' + editLocations.length + ' / 50 题）';
}

function renderPackEditList() {
    const list = $('packedit-list');
    if (!editLocations.length) {
        list.innerHTML = '<div class="lb-empty">📍 点击上方地图选点，或使用「批量导入」添加街景</div>';
        return;
    }
    list.innerHTML = editLocations
        .map((l, i) => {
            const source = l.source || 'mapillary';
            const badge =
                source === 'tencent'
                    ? '<span class="pack-src pack-src-tencent">腾讯</span>'
                    : '<span class="pack-src pack-src-mly">Mapillary</span>';
            return `<div class="lb-row">
                <div class="lb-name">${escapeHtml(l.name)}</div>
                <span style="color:#8899bb;font-size:12px">${l.lat.toFixed(4)}, ${l.lng.toFixed(4)}</span>
                <span style="color:#8899bb;font-size:12px">${'★'.repeat(l.difficulty)} · ${REGION_NAMES[l.region] || '世界'}</span>
                ${badge}
                <button class="acc-code-btn" data-remove="${i}">🗑</button>
            </div>`;
        })
        .join('');
}

function ensurePackEditDelegation() {
    const list = $('packedit-list');
    if (list.dataset.wired === '1') return;
    list.dataset.wired = '1';
    list.addEventListener('click', (event) => {
        const button = event.target.closest('[data-remove]');
        if (!button) return;
        const index = Number(button.dataset.remove);
        if (Number.isInteger(index) && index >= 0 && index < editLocations.length) {
            editLocations.splice(index, 1);
            updatePackEditCount();
            renderPackEditList();
        }
    });
}

async function savePackLocations() {
    if (!editingPack) return;
    if (editLocations.length === 0) {
        showToast('⚠️ 图包至少需要 1 个地点');
        return;
    }
    if (editLocations.length > 50) {
        showToast('⚠️ 图包最多 50 个地点');
        return;
    }
    try {
        await MmaApi.replacePackLocations(editingPack.id, editLocations);
        showToast('💾 地点已保存');
        closePackEditor();
        await switchPacksTab(packsTab);
    } catch (e) {
        showToast('❌ 保存失败：' + (e.message || '请稍后再试'));
    }
}

// ==========================================================
// 【批量导入街景】粘贴 Mapillary / 腾讯街景 ID 或链接，前端自动获取坐标元数据
// ==========================================================
function togglePackImport() {
    const box = $('packedit-import-body');
    if (!box) return;
    box.style.display = box.style.display === 'none' ? 'block' : 'none';
}

function setPackImportSource(value) {
    packImportSource = value === 'mapillary' || value === 'tencent' ? value : 'auto';
}

// 从一行文本解析出 { source, id }；无法识别返回 null
function parseImportLine(line) {
    let value = String(line || '').trim();
    if (!value || value.startsWith('#')) return null;
    // 去掉包裹的引号/方括号/逗号
    value = value.replace(/^[\s"'[,(]+/, '').replace(/[\s"'\]),]+$/, '');
    if (!value) return null;

    const lower = value.toLowerCase();
    let source;
    let id;
    if (lower.includes('mapillary.com')) {
        source = 'mapillary';
        id = extractMapillaryId(value);
    } else if (lower.includes('map.qq.com') || lower.includes('qq.com')) {
        source = 'tencent';
        id = extractTencentId(value);
    } else if (packImportSource !== 'auto') {
        source = packImportSource;
        id = value;
    } else {
        // 裸 ID 自动判断：纯 23 位数字按腾讯 svid 处理，其余按 Mapillary
        source = /^\d{23}$/.test(value) ? 'tencent' : 'mapillary';
        id = value;
    }
    if (!id || !/^[0-9A-Za-z_-]{1,64}$/.test(id)) return null;
    return { source, id };
}

function extractMapillaryId(url) {
    let match = url.match(/[?&]pKey=([0-9A-Za-z_-]+)/i);
    if (match) return match[1];
    match = url.match(/\/im\/([0-9A-Za-z_-]+)/i);
    if (match) return match[1];
    match = url.match(/[?&]image_key=([0-9A-Za-z_-]+)/i);
    if (match) return match[1];
    match = url.match(/\/([0-9]{10,})(?:[/?#]|$)/);
    return match ? match[1] : '';
}

function extractTencentId(url) {
    let match = url.match(/[?&]svid=([0-9A-Za-z_-]+)/i);
    if (match) return match[1];
    match = url.match(/\/([0-9]{10,})(?:[/?#]|$)/);
    return match ? match[1] : '';
}

// 通过后端代理按 ID 解析 Mapillary 图片坐标与缩略图
async function fetchMapillaryMeta(id) {
    const response = await fetch(`${API_BASE}/api/proxy/mapillary/metadata/${encodeURIComponent(id)}`);
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const data = await response.json();
    if (!Number.isFinite(data.lat) || !Number.isFinite(data.lng) || (data.lat === 0 && data.lng === 0)) {
        throw new Error('未返回坐标');
    }
    return data;
}

// 通过腾讯街景接口按 svid 解析坐标与缩略图
async function fetchTencentMeta(id) {
    if (!window.QQSv) throw new Error('腾讯街景客户端未加载');
    const detail = await window.QQSv.getPano(id);
    if (!detail || !detail.svid) throw new Error('该 svid 无街景');
    const addr = detail.addr || {};
    const basic = detail.basic || {};
    let lat = typeof addr.y_lat === 'number' ? addr.y_lat : null;
    let lng = typeof addr.x_lng === 'number' ? addr.x_lng : null;
    if ((lat == null || lng == null) && basic.x != null && basic.y != null) {
        const pos = window.QQSv.mercatorToLngLat(basic.x, basic.y);
        lat = pos.lat;
        lng = pos.lng;
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error('无法解析坐标');
    return { lat, lng, url: window.QQSv.thumbUrl(id), isPano: true };
}

async function importPackLocations() {
    if (packImportBusy || !editingPack) return;
    const input = $('packedit-import-input');
    const status = $('packedit-import-status');
    const button = $('packedit-import-btn');
    const lines = String(input.value || '').split(/\r?\n/);

    const seen = new Set();
    const parsed = [];
    for (const line of lines) {
        const item = parseImportLine(line);
        if (!item) continue;
        const key = item.source + ':' + item.id;
        if (seen.has(key)) continue;
        seen.add(key);
        parsed.push(item);
    }
    if (!parsed.length) {
        showToast('⚠️ 未识别到有效的街景 ID / 链接');
        return;
    }
    const remaining = 50 - editLocations.length;
    if (remaining <= 0) {
        showToast('⚠️ 图包已满 50 个地点');
        return;
    }
    const targets = parsed.slice(0, remaining);
    if (parsed.length > remaining) showToast(`⚠️ 仅剩 ${remaining} 个空位，只导入前 ${remaining} 条`);

    packImportBusy = true;
    if (button) button.disabled = true;
    let ok = 0;
    let fail = 0;
    for (let i = 0; i < targets.length; i++) {
        const item = targets[i];
        const label = SOURCE_LABELS[item.source] || item.source;
        if (status) status.textContent = `⏳ 正在解析 ${i + 1}/${targets.length}（${label} ${item.id}）...`;
        try {
            const meta =
                item.source === 'tencent' ? await fetchTencentMeta(item.id) : await fetchMapillaryMeta(item.id);
            editLocations.push({
                name: label + ' ' + item.id.slice(-8),
                lat: meta.lat,
                lng: meta.lng,
                difficulty: 3,
                region: 'world',
                imageId: item.id,
                panoramaUrl: meta.url || null,
                source: item.source,
            });
            ok++;
            updatePackEditCount();
            renderPackEditList();
        } catch (e) {
            fail++;
        }
    }
    packImportBusy = false;
    if (button) button.disabled = false;
    if (status) status.textContent = `✅ 导入完成：成功 ${ok} 条${fail ? `，失败 ${fail} 条` : ''}`;
    input.value = '';
    showToast(`✅ 已导入 ${ok} 个地点${fail ? `（${fail} 条失败）` : ''}`);
}

ensurePackListDelegation();
ensurePackEditDelegation();
