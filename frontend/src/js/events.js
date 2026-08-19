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
})();
