// 保留原始网页链接，只在用户点击 Discord 频道链接时唤起 App。
export function discordAppUrl(value) {
    try {
        const url = new URL(value);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return '';
        if (!['discord.com', 'www.discord.com', 'discordapp.com', 'www.discordapp.com'].includes(url.hostname)) return '';
        if (!/^\/channels\/(?:[0-9]+|@me)\/[0-9]+(?:\/[0-9]+)?\/?$/.test(url.pathname)) return '';
        return `discord://discord.com${url.pathname}${url.search}${url.hash}`;
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
            window.location.assign(appUrl);
        } : undefined,
    };
}
