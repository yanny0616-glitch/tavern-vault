import { toast } from './ui.js';
// 保留原始网页链接，只在用户点击 Discord 频道链接时唤起 App。
export function discordAppUrl(value) {
    try {
        const url = new URL(value);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return '';
        if (!['discord.com', 'www.discord.com', 'discordapp.com', 'www.discordapp.com'].includes(url.hostname)) return '';
        if (!/^\/channels\/(?:[0-9]+|@me)\/[0-9]+(?:\/[0-9]+)?\/?$/.test(url.pathname)) return '';
        // Discord 客户端认的写法是 discord://-/channels/…
        return `discord://-${url.pathname.replace(/\/$/, '')}`;
    } catch { return ''; }
}

export function sourceLinkProps(value) {
    const appUrl = discordAppUrl(value);
    return {
        href: value,
        target: '_blank',
        rel: 'noopener noreferrer',
        title: appUrl ? '在 Discord 中打开' : '打开链接',
        onclick: appUrl ? (event) => {
            if (event.defaultPrevented || event.button > 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            // 唤起成功时页面会失去焦点或被切到后台；两秒后还在前台，多半是没唤起来（没装 App、这个环境不让唤起），提示改用网页
            let left = false;
            const gone = () => { left = true; };
            window.addEventListener('blur', gone, { once: true });
            document.addEventListener('visibilitychange', gone, { once: true });
            setTimeout(() => {
                window.removeEventListener('blur', gone); document.removeEventListener('visibilitychange', gone);
                if (!left && document.hasFocus()) toast('没能唤起 Discord，可以点旁边的「网页打开」', 'err');
            }, 2000);
            window.location.assign(appUrl);
        } : undefined,
    };
}
