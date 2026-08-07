// MmaGuessr · 账号面板（登录 / 注册 / 游客进度绑定）
// 依赖 src/js/config.js、src/js/api.js、src/js/game.js（HTML 中按该顺序加载）。

function openAccount() {
    refreshAccountPanel();
    $('account-overlay').classList.add('show');
}

function closeAccount() {
    $('account-overlay').classList.remove('show');
}

// 刷新面板：根据当前身份切换登录 / 注册表单或用户资料
async function refreshAccountPanel() {
    const identity = MmaApi.getIdentity();
    const isUser = identity !== null && identity.role === 'user';

    $('account-login-form').style.display = isUser ? 'none' : 'block';
    $('account-register-form').style.display = isUser ? 'none' : 'block';
    $('account-profile').style.display = isUser ? 'block' : 'none';
    $('account-logout-btn').style.display = isUser ? 'block' : 'none';

    const bindHint = $('account-bind-hint');
    bindHint.style.display = !isUser && MmaApi.isOnline() && MmaApi.getGuestToken() ? 'block' : 'none';

    if (isUser) {
        $('account-profile-name').textContent = '👤 ' + identity.user.username;
        $('account-profile-email').textContent = identity.user.email;
        $('account-profile-stats').textContent = await loadProfileStats();
        loadAchievements();
    } else {
        $('account-profile-name').textContent =
            MmaApi.isOnline() && identity ? '🎭 ' + identity.profile.username : '🎭 离线模式';
        const achBox = $('account-achievements');
        if (achBox) achBox.style.display = 'none';
    }
}

// 从服务端读取累计统计；请求失败时保持占位文案，不打断面板展示
const PROFILE_MODE_LABELS = {
    classic: '经典',
    challenge: '挑战',
    region: '区域',
    china: '中国',
    endless: '无限',
    daily: '每日',
    duel: '对战',
    landmark: '地标',
};
async function loadProfileStats() {
    try {
        const profile = await MmaApi.getProfile();
        const s = profile.stats;
        if (!s || s.totalGames === 0) return '暂无游戏数据';
        const bestMode = s.bestMode ? ' · 最佳模式 ' + (PROFILE_MODE_LABELS[s.bestMode] || s.bestMode) : '';
        return (
            `共 ${s.totalGames} 局 / ${s.totalRounds} 轮 · 总分 ${s.totalScore} 分 · 最佳 ${s.bestScore} 分` +
            ` · 命中率 ${s.accuracy}%` +
            bestMode
        );
    } catch (e) {
        return '暂无游戏数据';
    }
}

// 成就与称号：已解锁成就图标墙 + 称号装备按钮（仅注册用户展示）
async function loadAchievements() {
    const box = $('account-achievements');
    if (!box) return;
    try {
        const payload = await MmaApi.getAchievements();
        const unlocked = payload.achievements.filter((entry) => entry.unlockedAt);
        const equipped = payload.equippedTitle;
        const titles = payload.achievements.filter((entry) => entry.hasTitle);
        box.innerHTML =
            '<div class="acc-stats">🏅 成就 ' +
            unlocked.length +
            '/' +
            payload.achievements.length +
            (equipped ? ' · 称号：' + escapeHtml(equipped) : '') +
            '</div>' +
            (unlocked.length
                ? '<div class="ach-grid">' +
                  unlocked
                      .map(
                          (entry) =>
                              '<span class="ach-item" title="' +
                              escapeHtml(entry.description) +
                              '">' +
                              entry.icon +
                              '</span>'
                      )
                      .join('') +
                  '</div>'
                : '<div class="acc-stats">完成游戏即可解锁成就</div>') +
            (titles.length
                ? '<div class="ach-titles">' +
                  titles
                      .map(
                          (entry) =>
                              '<button class="ach-title-btn' +
                              (entry.unlockedAt ? '' : ' disabled') +
                              '" data-title="' +
                              escapeHtml(entry.title) +
                              '">' +
                              escapeHtml(entry.title) +
                              '</button>'
                      )
                      .join('') +
                  '</div>'
                : '');
        box.querySelectorAll('.ach-title-btn:not(.disabled)').forEach((btn) => {
            btn.addEventListener('click', () => equipTitle(btn.dataset.title));
        });
    } catch (e) {
        box.style.display = 'none';
    }
}

async function equipTitle(title) {
    try {
        const result = await MmaApi.equipTitle(title || null);
        showToast(result.equippedTitle ? '✅ 已装备称号：' + result.equippedTitle : '称号已卸下');
        await loadAchievements();
    } catch (e) {
        showToast('❌ ' + (e.message || '装备失败'));
    }
}

function currentUserInput() {
    return {
        username: $('register-username').value.trim(),
        email: $('register-email').value.trim(),
        password: $('register-password').value,
        code: $('register-code').value.trim(),
    };
}

async function doLogin() {
    const identifier = $('login-identifier').value.trim();
    const password = $('login-password').value;
    if (!identifier || !password) {
        showToast('请填写账号与密码');
        return;
    }
    try {
        await MmaApi.login(identifier, password);
        closeAccount();
        showToast('✅ 登录成功');
        renderBests();
    } catch (e) {
        showToast('❌ ' + (e.message || '登录失败'));
    }
}

async function sendCode() {
    const email = $('register-email').value.trim();
    if (!email) {
        showToast('请先填写邮箱');
        return;
    }
    try {
        await MmaApi.sendVerificationCode(email);
        showToast('📮 验证码已发送（开发环境见后端控制台）');
    } catch (e) {
        showToast('❌ ' + (e.message || '验证码发送失败'));
    }
}

async function doRegister() {
    const { username, email, password, code } = currentUserInput();
    if (!username || !email || !password || !code) {
        showToast('请填写完整注册信息');
        return;
    }
    try {
        // 携带游客令牌注册：服务端自动合并当前游客的游戏进度
        await MmaApi.register({ username, email, password, code, guestToken: MmaApi.getGuestToken() });
        closeAccount();
        showToast('✅ 注册成功，游客进度已绑定');
        renderBests();
    } catch (e) {
        showToast('❌ ' + (e.message || '注册失败'));
    }
}

async function doLogout() {
    await MmaApi.logout();
    closeAccount();
    showToast('已退出登录');
    renderBests();
}
