// MmaGuessr · 图包工坊面板
// 依赖 src/js/config.js、api.js、game.js（HTML 中按该顺序加载）。
// 浏览/创建自定义题库，在地图上选点自动解析街景，公开分享给全球玩家。

let packsTab = 'public'; // 'public' | 'mine'
let editingPack = null; // 正在编辑的图包元数据
let editLocations = []; // 编辑器地点集合 [{ name, lat, lng, difficulty, region, imageId, panoramaUrl }]
let editorMap = null;
let editorMarker = null;
let pendingPick = null; // 地图上解析出的候选街景 { imageId, panoramaUrl, lat, lng }

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
        }));
        pendingPick = null;
        $('packedit-name').textContent = '📦 ' + editingPack.name + '（' + editLocations.length + ' / 50 题）';
        $('packedit-preview').innerHTML = '';
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
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap',
        maxZoom: 19,
    }).addTo(editorMap);
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
    pendingPick = { imageId: found.imageId, panoramaUrl: found.panoramaUrl, lat: found.lat, lng: found.lng };
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
    });
    $('packedit-name').textContent = '📦 ' + editingPack.name + '（' + editLocations.length + ' / 50 题）';
    $('packedit-preview').innerHTML = '';
    pendingPick = null;
    renderPackEditList();
    showToast('✅ 已添加，继续选点或点击保存');
}

function renderPackEditList() {
    const list = $('packedit-list');
    if (!editLocations.length) {
        list.innerHTML = '<div class="lb-empty">📍 点击上方地图选点，自动解析街景后添加</div>';
        return;
    }
    list.innerHTML = editLocations
        .map(
            (l, i) => `<div class="lb-row">
                <div class="lb-name">${escapeHtml(l.name)}</div>
                <span style="color:#8899bb;font-size:12px">${l.lat.toFixed(4)}, ${l.lng.toFixed(4)}</span>
                <span style="color:#8899bb;font-size:12px">${'★'.repeat(l.difficulty)} · ${REGION_NAMES[l.region] || '世界'}</span>
                <button class="acc-code-btn" data-remove="${i}">🗑</button>
            </div>`
        )
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
            $('packedit-name').textContent = '📦 ' + editingPack.name + '（' + editLocations.length + ' / 50 题）';
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

ensurePackListDelegation();
ensurePackEditDelegation();
