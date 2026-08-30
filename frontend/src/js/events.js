// MmaGuessr · UI 事件绑定（静态页面统一事件入口）
// 全部使用 addEventListener 而非内联 onclick，使 CSP 可移除 'unsafe-inline'。
// 依赖 src/js/game.js、auth.js、lb.js、daily.js、mp.js 中定义的全局函数（最后加载）。

function bindClick(selectorOrElement, handler) {
    if (typeof selectorOrElement === 'string') {
        document.querySelectorAll(selectorOrElement).forEach((element) => element.addEventListener('click', handler));
    } else if (selectorOrElement) {
        selectorOrElement.addEventListener('click', handler);
    }
}

// 点击遮罩空白处关闭弹窗（与原内联 onclick 行为一致）
function bindOverlayDismiss(overlayId, closeFn) {
    const overlay = document.getElementById(overlayId);
    bindClick(overlay, (event) => {
        if (event.target === overlay) closeFn();
    });
}

(function wireEvents() {
    bindClick('[data-mode]', (event) => chooseMode(event.currentTarget.dataset.mode));
    bindClick('[data-region]', (event) => startGame('region', event.currentTarget.dataset.region));

    bindClick('#btn-changelog', openChangelog);
    bindClick('#btn-leaderboard', openLeaderboard);
    bindClick('#btn-daily-panel', openDailyPanel);
    bindClick('#btn-mp-panel', openMpPanel);
    bindClick('#btn-history', openHistory);
    bindClick('#btn-account', openAccount);
    bindClick('#btn-packs', openPacksPanel);
    bindClick('#back-btn', hideRegionScreen);

    bindClick('#quit-btn', routeQuit);
    bindClick('#skip-location-btn', skipLocation);
    bindClick('#streetview-error-btn', exportStreetViewError);
    bindClick('#map-toggle-btn', toggleMapSize);
    bindClick('#submit-btn', routeSubmit);
    bindClick('#mobile-map-btn', toggleMobileMap);
    bindClick('#pano-mode-auto', () => setViewMode('auto'));
    bindClick('#pano-mode-sphere', () => setViewMode('sphere'));
    bindClick('#pano-mode-flat', () => setViewMode('flat'));
    bindClick('#pano-settings-btn', togglePanoSettingsPanel);
    $('pano-invert-x').addEventListener('change', (e) => updatePanoSettings({ invertX: e.target.checked }));
    $('pano-invert-y').addEventListener('change', (e) => updatePanoSettings({ invertY: e.target.checked }));

    bindClick('#next-btn', nextRound);
    bindClick('#share-btn', shareResult);
    bindClick('#home-btn2', backHome);

    bindClick('#changelog-close-btn', closeChangelog);
    bindClick('#history-close-btn', closeHistory);
    bindClick('#account-close-btn', closeAccount);
    bindClick('#leaderboard-close-btn', closeLeaderboard);
    bindClick('#daily-close-btn', closeDailyPanel);
    bindClick('#mp-close-btn', mpCloseLobby);
    bindClick('#err-close-btn', closeErrReport);

    bindClick('#login-submit-btn', doLogin);
    bindClick('#register-submit-btn', doRegister);
    bindClick('#guest-enter-btn', closeAccount);
    bindClick('#account-logout-btn', doLogout);
    bindClick('#lb-period-overall', () => switchLbPeriod('overall'));
    bindClick('#lb-period-daily', () => switchLbPeriod('daily'));
    bindClick('#mp-find-btn', mpFindMatch);
    bindClick('#mp-cancel-btn', mpCancelMatch);
    bindClick('#err-download-btn', downloadErrReport);
    bindClick('#err-copy-btn', copyErrReport);

    bindClick('#packs-close-btn', closePacksPanel);
    bindClick('#pack-create-btn', createPack);
    bindClick('#pack-tab-public', () => switchPacksTab('public'));
    bindClick('#pack-tab-mine', () => switchPacksTab('mine'));
    bindClick('#packedit-close-btn', closePackEditor);
    bindClick('#packedit-save-btn', savePackLocations);

    bindOverlayDismiss('changelog-overlay', closeChangelog);
    bindOverlayDismiss('history-overlay', closeHistory);
    bindOverlayDismiss('account-overlay', closeAccount);
    bindOverlayDismiss('leaderboard-overlay', closeLeaderboard);
    bindOverlayDismiss('daily-overlay', closeDailyPanel);
    bindOverlayDismiss('mp-overlay', mpCloseLobby);
    bindOverlayDismiss('err-overlay', closeErrReport);
    bindOverlayDismiss('packs-overlay', closePacksPanel);
    bindOverlayDismiss('packedit-overlay', closePackEditor);
    bindOverlayDismiss('basemap-overlay', closeBasemap);

    // 底图设置
    bindClick('#btn-basemap', openBasemap);
    bindClick('#basemap-close-btn', closeBasemap);
    // 列表项是 openBasemap 时才动态渲染的，直接绑定会失败（页面加载时列表为空），
    // 必须用事件委托绑定到父容器，通过 closest 命中动态生成的选项
    bindClick('#basemap-list', (event) => {
        const option = event.target.closest('.basemap-option');
        if (option) selectBasemap(option.dataset.basemap);
    });

    // 首页公告关闭
    bindClick('#announcement-close-btn', closeAnnouncement);

    // 页面加载：未关闭过则显示公告
    initAnnouncement();
})();

// ==========================================================
// 【底图设置】渲染底图列表 / 打开 / 关闭 / 切换
// ==========================================================
function renderBasemapList() {
    const list = $('basemap-list');
    if (!list) return;
    const current = getBasemapId();
    list.innerHTML = Object.keys(BASEMAPS)
        .map(function (id) {
            const cfg = BASEMAPS[id];
            const active = id === current;
            return (
                '<button class="basemap-option' +
                (active ? ' active' : '') +
                '" data-basemap="' +
                id +
                '">' +
                '<span class="basemap-name">' +
                cfg.label +
                '</span>' +
                '<span class="basemap-check">' +
                (active ? '✓' : '') +
                '</span>' +
                '</button>'
            );
        })
        .join('');
}

function openBasemap() {
    renderBasemapList();
    $('basemap-overlay').classList.add('show');
}

function closeBasemap() {
    $('basemap-overlay').classList.remove('show');
}

function selectBasemap(id) {
    switchBasemap(id);
    renderBasemapList();
}

// ==========================================================
// 【首页公告】显示 / 关闭
// ==========================================================
function initAnnouncement() {
    const bar = $('announcement-bar');
    if (bar && !isAnnouncementDismissed()) {
        bar.style.display = 'flex';
    }
}

function closeAnnouncement() {
    dismissAnnouncement();
    const bar = $('announcement-bar');
    if (bar) bar.style.display = 'none';
}
