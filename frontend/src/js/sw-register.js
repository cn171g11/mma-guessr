// MmaGuessr · PWA 注册
// 仅在 HTTPS 或本机开发环境（localhost/127.0.0.1）启用；file:// 与纯 HTTP 静默跳过。
// 注册失败不影响游戏功能。
if (
    'serviceWorker' in navigator &&
    (['localhost', '127.0.0.1'].includes(location.hostname) || location.protocol === 'https:')
) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
}
