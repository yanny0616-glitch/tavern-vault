// 酒馆主题预览：照着酒馆聊天界面真实的结构（同样的 id、class、层级）搭一个示意页面，再套上主题。
// 很多主题的自定义 CSS 是冲着这些结构写的，结构对不上，样子就全乱了。
// 放在隔离窗口里：不运行脚本；外部图片和字体默认不加载，remote=true 才放行（只放行 https）。
import { h } from './ui.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** 颜色只认常见写法，别的一律换成默认值，免得带出样式之外去 */
const color = (v, d) => (typeof v === 'string' && /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%/]+\)|hsla?\([\d\s.,%/a-z]+\))$/i.test(v.trim()) ? v.trim() : d);
const num = (v, d, min, max) => { const n = Number(v); return Number.isFinite(n) && v !== '' && v != null ? Math.min(max, Math.max(min, n)) : d; };

const CHAT_STYLE = { 0: 'flatchat', 1: 'bubblechat', 2: 'documentstyle' };
// 酒馆的头像样式：0 圆形，1 长方形（大头像），2 方形，3 圆角
const AVATAR_CLASS = { 1: 'big-avatars', 2: 'square-avatars', 3: 'rounded-avatars' };

/** 示意头像：一张内嵌的小图，不用去外面取 */
const face = (a, b, skin) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="100" height="100" fill="url(#g)"/><circle cx="50" cy="40" r="17" fill="${skin}"/><ellipse cx="50" cy="96" rx="33" ry="30" fill="${skin}"/></svg>`)}`;
const FACE_CHAR = face('#7d6aa8', '#c97f8f', '#f3d9c4');
const FACE_USER = face('#4f7f8f', '#7fb39a', '#efe2d0');

// 酒馆的图标用的是 Font Awesome，这里没有这套字体，用简单的符号顶替
const ICONS = { 'fa-sliders': '☷', 'fa-plug': '⏻', 'fa-font': 'A', 'fa-book-atlas': '▤', 'fa-user-cog': '⚙', 'fa-panorama': '▣', 'fa-cubes': '❖', 'fa-face-smile': '☺', 'fa-address-card': '☰', 'fa-bars': '☰', 'fa-magic-wand-sparkles': '✦', 'fa-paper-plane': '➤', 'fa-arrow-right': '→', 'fa-user-secret': '☻', 'fa-pencil': '✎', 'fa-ellipsis': '⋯', 'fa-chevron-right': '›', 'fa-chevron-left': '‹', 'fa-stop': '■' };

// 酒馆自带样式里和聊天界面有关的部分（按它的结构和变量名写的近似版本）
const BASE_CSS = `
*{box-sizing:border-box}
html,body{margin:0;height:100%}
body{font-family:"Noto Sans","Noto Color Emoji",system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;font-size:var(--mainFontSize);font-weight:400;line-height:1.4;color:var(--SmartThemeBodyColor);overflow:hidden;background-color:#20232b;-webkit-font-smoothing:antialiased}
.flex-container{display:flex;gap:5px;flex-wrap:wrap}.flex1{flex:1}.alignitemscenter{align-items:center}.alignItemsBaseline{align-items:baseline}.justifySpaceBetween{justify-content:space-between}.flexFlowColumn{flex-flow:column}.flexNoGap{gap:0}.flexGap5{gap:5px}
.fa-solid{font-style:normal;display:inline-block;text-align:center;line-height:1}
${Object.entries(ICONS).map(([k, v]) => `.${k}::before{content:"${v}"}`).join('')}
#bg1,#bg_custom{position:fixed;inset:0;width:100%;height:100%;background-repeat:no-repeat;background-attachment:fixed;background-size:cover;z-index:-3}
#bg1{background-image:linear-gradient(140deg,#39465e 0%,#6a5876 52%,#c48d76 100%)}
#top-bar{position:fixed;top:0;left:0;right:0;margin:0 auto;width:var(--sheldWidth);height:var(--topBarBlockSize);background-color:var(--SmartThemeBlurTintColor);backdrop-filter:blur(var(--SmartThemeBlurStrength));box-shadow:0 2px 20px 0 var(--SmartThemeShadowColor);z-index:3005}
#top-settings-holder{position:fixed;top:0;left:0;right:0;margin:0 auto;width:var(--sheldWidth);height:var(--topBarBlockSize);display:flex;justify-content:space-around;align-items:center;z-index:3005}
.drawer{display:flex;align-items:center;justify-content:center;height:var(--topBarBlockSize)}
.drawer-toggle{display:flex;align-items:center}
.drawer-icon{display:inline-block;cursor:pointer;font-size:var(--topBarIconSize);color:var(--SmartThemeBodyColor);text-shadow:0 0 calc(var(--shadowWidth) * 1px) var(--SmartThemeShadowColor)}
.drawer-icon.closedIcon{opacity:.3}.drawer-icon.openIcon{opacity:1}
.drawer-content{display:none}
#sheld{position:absolute;top:var(--topBarBlockSize);left:0;right:0;margin:0 auto;width:var(--sheldWidth);height:calc(100% - var(--topBarBlockSize));display:flex;flex-direction:column;overflow-x:hidden;z-index:30}
#chat{flex-grow:1;display:flex;flex-direction:column;overflow-x:hidden;overflow-y:auto;padding:0;background-color:var(--SmartThemeChatTintColor);backdrop-filter:blur(var(--SmartThemeBlurStrength));border:1px solid var(--SmartThemeBorderColor);border-bottom:0;border-top:0;text-shadow:0 0 calc(var(--shadowWidth) * 1px) var(--SmartThemeShadowColor);scrollbar-width:thin}
.mes{display:flex;align-items:flex-start;position:relative;width:100%;margin:0 auto;padding:10px 10px 0 10px;color:var(--SmartThemeBodyColor);border:1px solid transparent}
.for_checkbox,.del_checkbox,.swipe_left,.mes_edit_buttons,.extraMesButtons,.mes_ghost,.mes_bias:empty,.mes_img_container:empty{display:none}
.mesAvatarWrapper{display:flex;flex-direction:column;align-items:center;flex-basis:var(--avatar-base-width);min-width:var(--avatar-base-width);height:fit-content;z-index:1}
.avatar{width:var(--avatar-base-width);height:var(--avatar-base-height);flex:0 0 auto;border-style:none;border-radius:var(--avatar-base-border-radius-round);cursor:pointer}
.avatar img{width:var(--avatar-base-width);height:var(--avatar-base-height);display:block;object-fit:cover;object-position:center;border-radius:var(--avatar-base-border-radius-round);border:1px solid var(--SmartThemeBorderColor);box-shadow:0 0 5px var(--black50a)}
body.big-avatars{--avatar-base-height:calc(var(--avatar-base-width) * 1.5);--avatar-base-border-radius:10px}
body.big-avatars .avatar,body.big-avatars .avatar img,body.square-avatars .avatar,body.square-avatars .avatar img{border-radius:var(--avatar-base-border-radius)}
body.rounded-avatars .avatar,body.rounded-avatars .avatar img{border-radius:var(--avatar-base-border-radius-rounded)}
.mesIDDisplay,.mes_timer,.tokenCounterDisplay{font-size:calc(var(--mainFontSize) * .7);color:var(--SmartThemeBodyColor);opacity:.4;text-align:center;line-height:1.4;cursor:default}
.mes_block{flex:1;width:100%;min-width:0;padding-top:0;padding-left:10px;overflow-x:hidden}
.ch_name{display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:nowrap;gap:5px}
.name_text{font-weight:bold;display:inline-block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.timestamp{font-size:calc(var(--mainFontSize) * .7);font-weight:400;opacity:.6;cursor:default}
.mes_buttons{display:flex;gap:6px;height:20px;align-items:center;opacity:.3;flex-shrink:0}
.mes_button{cursor:pointer;font-size:calc(var(--mainFontSize) * 1.05)}
.mes_text{font-weight:500;line-height:calc(var(--mainFontSize) + .5rem);max-width:100%;overflow-wrap:anywhere;padding:calc(var(--mainFontSize) * .8) 0 0 0;padding-top:0;padding-right:30px;padding-bottom:5px}
.mes_text p{margin:5px 0}.mes_text p:first-child{margin-top:0}
.mes_text em,.mes_text i{color:var(--SmartThemeEmColor)}
.mes_text u{color:var(--SmartThemeUnderlineColor)}
.mes_text q{color:var(--SmartThemeQuoteColor)}
.mes_text q::before,.mes_text q::after{content:none}
.mes_text code{font-family:Consolas,"Courier New",monospace;font-size:calc(var(--mainFontSize) * .9);background-color:var(--black70a);border:1px solid var(--SmartThemeBorderColor);border-radius:5px;padding:0 3px;color:var(--white70a)}
.swipeRightBlock{position:absolute;right:0;bottom:0;width:30px;display:none;align-items:center;opacity:.3}
.mes.last_mes .swipeRightBlock{display:flex}
.swipe_right{font-size:20px;width:30px;height:30px;display:flex;align-items:center;justify-content:center;cursor:pointer}
.swipes-counter{font-size:calc(var(--mainFontSize) * .7);opacity:.7;white-space:nowrap}
body.bubblechat .mes{padding:10px;margin-bottom:5px;border-radius:10px;background-color:var(--SmartThemeBotMesBlurTintColor);border:1px solid var(--SmartThemeBorderColor)}
body.bubblechat .mes[is_user="true"]{background-color:var(--SmartThemeUserMesBlurTintColor)}
body.bubblechat #chat{padding:5px}
body.documentstyle .mes{padding-top:4px}
body.documentstyle .mesAvatarWrapper,body.documentstyle .ch_name .name_text,body.documentstyle .timestamp{display:none}
#form_sheld{flex-shrink:0;width:100%;z-index:30;text-shadow:0 0 calc(var(--shadowWidth) * 1px) var(--SmartThemeShadowColor)}
#send_form{display:flex;flex-wrap:wrap;align-items:center;position:relative;width:100%;margin:0 auto;min-height:var(--bottomFormBlockSize);background-color:var(--SmartThemeBlurTintColor);backdrop-filter:blur(var(--SmartThemeBlurStrength));border:1px solid var(--SmartThemeBorderColor);border-radius:0 0 10px 10px}
#qr--bar{width:100%;order:1;padding:0 5px;outline:none}
.qr--buttons{display:flex;flex-wrap:wrap;gap:5px;justify-content:center;width:100%;margin:0;padding:0}
.qr--button,.menu_button{display:flex;align-items:center;justify-content:center;padding:3px 8px;margin:3px 0;border:1px solid var(--SmartThemeBorderColor);border-radius:5px;background-color:var(--black50a);color:var(--SmartThemeBodyColor);font-size:calc(var(--mainFontSize) * .9);cursor:pointer}
#nonQRFormItems{display:flex;width:100%;order:25;align-items:flex-end}
#leftSendForm,#rightSendForm{display:flex;flex-wrap:nowrap;align-items:center;width:fit-content}
#leftSendForm{order:1}#rightSendForm{order:25}
#leftSendForm>div,#rightSendForm>div:not(.displayNone){display:flex}
#leftSendForm>div,#rightSendForm>div{width:var(--bottomFormBlockSize);height:var(--bottomFormBlockSize);font-size:var(--bottomFormIconSize);align-items:center;justify-content:center;cursor:pointer;opacity:.7;color:var(--SmartThemeBodyColor)}
#mes_stop{display:none!important}
.displayNone{display:none}
#send_textarea{flex:1;order:3;min-width:0;min-height:var(--bottomFormBlockSize);height:var(--bottomFormBlockSize);max-height:50vh;padding:6px;margin:0;background-color:transparent;border:0;outline:0;resize:none;box-shadow:none;color:var(--SmartThemeBodyColor);font-family:inherit;font-size:var(--mainFontSize);line-height:calc(var(--mainFontSize) + .25rem);text-shadow:inherit}
#send_textarea::placeholder{color:var(--SmartThemeEmColor);opacity:.8}
@media screen and (max-width:1000px){#sheld,#top-bar,#top-settings-holder{width:100%}#send_form{border-radius:0}}
`;

const drawer = (id, ic, open = false) => `<div id="${id}" class="drawer"><div class="drawer-toggle"><div class="drawer-icon fa-solid ${ic} fa-fw ${open ? 'openIcon' : 'closedIcon'}"></div></div><div class="drawer-content closedDrawer"></div></div>`;

function mesHtml({ id, who, user, avatar, html, time, last }) {
    return `<div class="mes${last ? ' last_mes' : ''}" mesid="${id}" ch_name="${esc(who)}" is_user="${user}" is_system="false" bookmark_link="" swipeid="0" type="">
<div class="for_checkbox"></div><input type="checkbox" class="del_checkbox">
<div class="mesAvatarWrapper"><div class="avatar"><img src="${avatar}" alt=""></div><div class="mesIDDisplay">#${id}</div><div class="mes_timer">${user ? '' : '8.4s'}</div><div class="tokenCounterDisplay">${user ? 21 : 96 + id * 7}t</div></div>
<div class="swipe_left fa-solid fa-chevron-left"></div>
<div class="mes_block">
<div class="ch_name flex-container justifySpaceBetween"><div class="flex-container flex1 alignitemscenter"><div class="flex-container alignItemsBaseline"><span class="name_text">${esc(who)}</span><i class="mes_ghost fa-solid"></i><small class="timestamp">${time}</small></div></div>
<div class="mes_buttons"><div class="mes_button extraMesButtonsHint fa-solid fa-ellipsis"></div><div class="extraMesButtons"></div><div class="mes_button mes_edit fa-solid fa-pencil"></div></div><div class="mes_edit_buttons"></div></div>
<div class="mes_text">${html}</div><div class="mes_img_container"></div><div class="mes_bias"></div>
</div>
<div class="flex-container swipeRightBlock flexFlowColumn flexNoGap"><div class="swipe_right fa-solid fa-chevron-right"></div><div class="swipes-counter">1&ZeroWidthSpace;/&ZeroWidthSpace;3</div></div>
</div>`;
}

/**
 * @param d 主题文件的内容
 * css：套不套主题的自定义 CSS；remote：让不让它加载外部图片和字体；phone：按手机宽度显示
 */
export function stThemePreview(d, { css = true, remote = false, phone = false, names = { char: '角色', user: '我' } } = {}) {
    const style = CHAT_STYLE[Number(d.chat_display)] || 'flatchat';
    const fs = num(d.font_scale, 1, 0.5, 1.5);
    const vars = {
        '--SmartThemeBodyColor': color(d.main_text_color, 'rgba(220, 220, 210, 1)'),
        '--SmartThemeEmColor': color(d.italics_text_color, 'rgba(145, 145, 145, 1)'),
        '--SmartThemeUnderlineColor': color(d.underline_text_color, 'rgba(188, 231, 207, 1)'),
        '--SmartThemeQuoteColor': color(d.quote_text_color, 'rgba(225, 138, 36, 1)'),
        '--SmartThemeBlurTintColor': color(d.blur_tint_color, 'rgba(23, 23, 23, 1)'),
        '--SmartThemeChatTintColor': color(d.chat_tint_color, 'rgba(23, 23, 23, 1)'),
        '--SmartThemeUserMesBlurTintColor': color(d.user_mes_blur_tint_color, 'rgba(30, 30, 30, 0.9)'),
        '--SmartThemeBotMesBlurTintColor': color(d.bot_mes_blur_tint_color, 'rgba(30, 30, 30, 0.9)'),
        '--SmartThemeShadowColor': color(d.shadow_color, 'rgba(0, 0, 0, 1)'),
        '--SmartThemeBorderColor': color(d.border_color, 'rgba(0, 0, 0, 0.5)'),
        '--fontScale': fs,
        '--blurStrength': num(d.blur_strength, 10, 0, 30),
        '--shadowWidth': num(d.shadow_width, 2, 0, 5),
        '--SmartThemeBlurStrength': 'calc(var(--blurStrength) * 1px)',
        '--mainFontSize': 'calc(var(--fontScale) * 15px)',
        '--sheldWidth': `${num(d.chat_width, 50, 25, 100)}vw`,
        '--topBarBlockSize': 'calc(var(--mainFontSize) * 2 + 5px)', '--topBarIconSize': 'calc(var(--mainFontSize) * 1.6)',
        '--bottomFormBlockSize': 'calc(var(--mainFontSize) * 2 + 5px)', '--bottomFormIconSize': 'calc(var(--mainFontSize) * 1.5)',
        '--avatar-base-width': '50px', '--avatar-base-height': '50px',
        '--avatar-base-border-radius': '2px', '--avatar-base-border-radius-round': '50%', '--avatar-base-border-radius-rounded': '10px',
        '--black30a': 'rgba(0,0,0,.3)', '--black50a': 'rgba(0,0,0,.5)', '--black70a': 'rgba(0,0,0,.7)', '--white30a': 'rgba(255,255,255,.3)', '--white50a': 'rgba(255,255,255,.5)', '--white70a': 'rgba(255,255,255,.7)', '--grey70': 'rgb(180,180,180)', '--grey5020a': 'rgba(128,128,128,.2)',
    };
    const custom = css ? String(d.custom_css || '').replace(/<\/?\s*style/gi, '') : '';
    const csp = `default-src 'none'; style-src 'unsafe-inline'${remote ? ' https:' : ''}; img-src data:${remote ? ' https:' : ''}; font-src data:${remote ? ' https:' : ''}`;
    const classes = [style, AVATAR_CLASS[Number(d.avatar_style)] || '', Number(d.blur_strength) === 0 ? 'no-blur' : '', d.noShadows ? 'no-shadows' : ''].filter(Boolean).join(' ');
    const mes = [
        { who: names.char, user: false, avatar: FACE_CHAR, time: '2026年1月12日 21:06', html: '<p><em>雨下了一整夜，檐角的水线到清晨才慢下来。她把窗推开一条缝，回头看了你一眼。</em></p><p><q>“醒了？灶上温着粥，趁热喝。”</q></p><p>桌上压着一张字条，写着 <u>巳时，城南渡口</u>。</p>' },
        { who: names.user, user: true, avatar: FACE_USER, time: '2026年1月12日 21:07', html: '<p><q>“渡口？今天就走吗。”</q> <em>我接过碗，没有急着喝。</em></p>' },
        { who: names.char, user: false, avatar: FACE_CHAR, time: '2026年1月12日 21:08', html: '<p><q>“船不等人。”</q> <em>她笑了一下，把斗笠扣在你头上。</em> 口令是 <code>青梅</code>，别记错了。</p>' },
    ];
    const doc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>:root{${Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';')}}${BASE_CSS}</style>
<style id="custom-style">${custom}</style></head>
<body class="${classes}"><div id="bg1"></div><div id="bg_custom"></div>
<div id="top-bar"></div>
<div id="top-settings-holder">${drawer('ai-config-button', 'fa-sliders')}${drawer('sys-settings-button', 'fa-plug')}${drawer('advanced-formatting-button', 'fa-font')}${drawer('WI-SP-button', 'fa-book-atlas')}${drawer('user-settings-button', 'fa-user-cog')}${drawer('backgrounds-button', 'fa-panorama')}${drawer('extensions-settings-button', 'fa-cubes')}${drawer('persona-management-button', 'fa-face-smile')}${drawer('rightNavHolder', 'fa-address-card')}</div>
<div id="sheld"><div id="sheldheader" class="fa-solid"></div>
<div id="chat">${mes.map((m, i) => mesHtml({ ...m, id: i, last: i === mes.length - 1 })).join('\n')}</div>
<div id="form_sheld"><div id="dialogue_del_mes"></div><div id="send_form" class="no-connection">
<div id="qr--bar" class="flex-container flexGap5"><div class="qr--buttons qr--color"><div class="qr--button menu_button interactable"><div class="qr--button-label">继续</div></div><div class="qr--button menu_button interactable"><div class="qr--button-label">总结</div></div></div></div>
<div id="nonQRFormItems"><div id="leftSendForm" class="alignContentCenter"><div id="options_button" class="fa-solid fa-bars interactable"></div><div id="extensionsMenuButton" class="fa-solid fa-magic-wand-sparkles interactable"></div></div>
<textarea id="send_textarea" name="text" class="mdHotkeys" placeholder="输入消息…" readonly></textarea>
<div id="rightSendForm" class="alignContentCenter"><div id="mes_stop" class="mes_stop"><i class="fa-solid fa-stop"></i></div><div id="mes_impersonate" class="fa-solid fa-user-secret interactable displayNone"></div><div id="mes_continue" class="fa-solid fa-arrow-right interactable displayNone"></div><div id="send_but" class="fa-solid fa-paper-plane interactable"></div></div></div>
</div></div></div>
</body></html>`;
    const f = h('iframe', { class: `st-theme-frame ${phone ? 'phone' : ''}`, sandbox: '', referrerpolicy: 'no-referrer', title: '酒馆主题预览' });
    f.srcdoc = doc;
    return f;
}
