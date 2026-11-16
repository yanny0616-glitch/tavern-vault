// 酒馆主题预览：按主题文件里的颜色、字号、头像和气泡样式搭一个示意聊天界面。
// 放在隔离窗口里：不运行脚本，不加载任何外部资源（主题的自定义 CSS 里常有外链图片、字体）。
import { h } from './ui.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** 颜色只认常见写法，别的一律换成默认值，免得带出样式之外去 */
const color = (v, d) => (typeof v === 'string' && /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%/]+\)|hsla?\([\d\s.,%/a-z]+\))$/i.test(v.trim()) ? v.trim() : d);
const num = (v, d, min, max) => { const n = Number(v); return Number.isFinite(n) && v !== '' && v != null ? Math.min(max, Math.max(min, n)) : d; };

const CHAT_STYLE = { 0: 'flatchat', 1: 'bubblechat', 2: 'documentstyle' };
const AVATAR = { 0: 'border-radius:50%', 1: 'height:75px;border-radius:10px', 2: 'border-radius:10px', 3: 'border-radius:14px' };

/** @param d 主题文件的内容；css：要不要套上主题的自定义 CSS */
export function stThemePreview(d, { css = true, names = { char: '角色', user: '我' } } = {}) {
    const style = CHAT_STYLE[Number(d.chat_display)] || 'flatchat';
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
        '--fontScale': num(d.font_scale, 1, 0.5, 1.5),
        '--blurStrength': num(d.blur_strength, 10, 0, 30),
        '--shadowWidth': num(d.shadow_width, 2, 0, 5),
    };
    const width = num(d.chat_width, 50, 25, 100);
    const custom = css ? String(d.custom_css || '').replace(/<\/?\s*style/gi, '') : '';
    const mes = (who, user, html) => `<div class="mes" is_user="${user}" ch_name="${esc(who)}"><div class="mesAvatarWrapper"><div class="avatar"><div class="pv-face ${user ? 'u' : ''}"></div></div></div><div class="mes_block"><div class="ch_name"><span class="name_text">${esc(who)}</span><small class="timestamp">21:${user ? '07' : '06'}</small></div><div class="mes_text">${html}</div></div></div>`;
    const doc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{${Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';')};--SmartThemeBlurStrength:calc(var(--blurStrength) * 1px);--mainFontSize:calc(var(--fontScale) * 15px);--sheldWidth:${width}vw;--avatar-base-width:50px;--avatar-base-height:50px}
*{box-sizing:border-box}
html,body{margin:0;height:100%}
body{font-family:"Noto Sans","Noto Color Emoji",system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;font-size:var(--mainFontSize);line-height:1.5;color:var(--SmartThemeBodyColor);overflow:hidden;background:#20232b}
#bg1{position:fixed;inset:0;background:linear-gradient(140deg,#39465e 0%,#6a5876 52%,#c48d76 100%)}
#top-bar{position:fixed;top:0;left:0;right:0;height:35px;background:var(--SmartThemeBlurTintColor);border-bottom:1px solid var(--SmartThemeBorderColor);backdrop-filter:blur(var(--SmartThemeBlurStrength));box-shadow:0 2px 20px 0 var(--SmartThemeShadowColor)}
#top-settings-holder{position:fixed;top:0;left:50%;transform:translateX(-50%);height:35px;display:flex;align-items:center;gap:22px;opacity:.75}
#top-settings-holder .drawer-icon{width:16px;height:16px;border-radius:4px;border:2px solid var(--SmartThemeBodyColor)}
#sheld{position:absolute;top:35px;bottom:0;left:50%;transform:translateX(-50%);width:max(var(--sheldWidth),min(100%,420px));max-width:100%;display:flex;flex-direction:column}
#chat{flex:1;overflow-y:auto;background:var(--SmartThemeChatTintColor);backdrop-filter:blur(var(--SmartThemeBlurStrength));border:1px solid var(--SmartThemeBorderColor);border-top:0;text-shadow:0 0 calc(var(--shadowWidth) * 1px) var(--SmartThemeShadowColor)}
.mes{display:flex;gap:10px;padding:10px 10px 0;border-bottom:1px solid transparent}
.avatar{width:var(--avatar-base-width);height:var(--avatar-base-height);overflow:hidden;flex-shrink:0;${AVATAR[Number(d.avatar_style)] || AVATAR[0]};box-shadow:0 0 5px var(--SmartThemeShadowColor)}
.pv-face{width:100%;height:100%;background:radial-gradient(circle at 50% 38%,#f3d9c4 0 22%,transparent 23%),radial-gradient(circle at 50% 105%,#f3d9c4 0 42%,transparent 43%),linear-gradient(160deg,#7d6aa8,#c97f8f)}
.pv-face.u{background:radial-gradient(circle at 50% 38%,#efe2d0 0 22%,transparent 23%),radial-gradient(circle at 50% 105%,#efe2d0 0 42%,transparent 43%),linear-gradient(160deg,#4f7f8f,#7fb39a)}
.mes_block{flex:1;min-width:0}
.ch_name{display:flex;align-items:baseline;gap:8px}
.name_text{font-weight:bold}
.timestamp{font-size:calc(var(--mainFontSize) * .7);opacity:.5}
.mes_text{padding:2px 0 10px;overflow-wrap:anywhere}
.mes_text p{margin:0 0 .6em}.mes_text p:last-child{margin:0}
.mes_text em,.mes_text i{color:var(--SmartThemeEmColor)}
.mes_text u{color:var(--SmartThemeUnderlineColor)}
.mes_text q{color:var(--SmartThemeQuoteColor)}
.mes_text q::before,.mes_text q::after{content:none}
.mes_text code{font-family:Consolas,monospace;background:rgba(0,0,0,.35);border:1px solid var(--SmartThemeBorderColor);border-radius:5px;padding:0 3px}
body.bubblechat .mes{margin:10px;padding:10px;border-radius:10px;border:1px solid var(--SmartThemeBorderColor);background:var(--SmartThemeBotMesBlurTintColor)}
body.bubblechat .mes[is_user="true"]{background:var(--SmartThemeUserMesBlurTintColor)}
body.bubblechat .mes_text{padding-bottom:0}
body.documentstyle .mes{padding-top:4px}
body.documentstyle .mesAvatarWrapper,body.documentstyle .ch_name{display:none}
#form_sheld{flex-shrink:0}
#send_form{display:flex;align-items:center;gap:8px;min-height:42px;padding:4px 10px;background:var(--SmartThemeBlurTintColor);border:1px solid var(--SmartThemeBorderColor);border-radius:0 0 10px 10px;backdrop-filter:blur(var(--SmartThemeBlurStrength))}
#send_textarea{flex:1;min-width:0;background:transparent;border:0;outline:0;resize:none;color:var(--SmartThemeBodyColor);font:inherit;height:28px;padding:3px 0}
#send_textarea::placeholder{color:var(--SmartThemeEmColor)}
#options_button,#send_but{width:18px;height:18px;opacity:.7;border:2px solid var(--SmartThemeBodyColor);border-radius:50%}
#send_but{border-radius:4px 10px 10px 4px}
</style>
<style>${custom}</style></head>
<body class="${style}"><div id="bg1"></div><div id="top-bar"></div><div id="top-settings-holder"><div class="drawer-icon"></div><div class="drawer-icon"></div><div class="drawer-icon"></div><div class="drawer-icon"></div><div class="drawer-icon"></div></div>
<div id="sheld"><div id="chat">
${mes(names.char, false, '<p><em>雨下了一整夜，檐角的水线到清晨才慢下来。她把窗推开一条缝，回头看了你一眼。</em></p><p><q>“醒了？灶上温着粥，趁热喝。”</q></p><p>桌上压着一张字条，写着 <u>巳时，城南渡口</u>。</p>')}
${mes(names.user, true, '<p><q>“渡口？今天就走吗。”</q> <em>我接过碗，没有急着喝。</em></p>')}
${mes(names.char, false, '<p><q>“船不等人。”</q> <em>她笑了一下，把斗笠扣在你头上。</em> 口令是 <code>青梅</code>，别记错了。</p>')}
</div><div id="form_sheld"><div id="send_form"><div id="options_button"></div><textarea id="send_textarea" placeholder="输入消息…" readonly></textarea><div id="send_but"></div></div></div></div>
</body></html>`;
    const f = h('iframe', { class: 'st-theme-frame', sandbox: '', referrerpolicy: 'no-referrer', title: '酒馆主题预览' });
    f.srcdoc = doc;
    return f;
}
