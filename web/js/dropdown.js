// 下拉框的弹出列表。系统自带的那个不跟主题走（白底蓝条），所以在用鼠标的设备上自己画一个；
// 手机、平板上系统的滚轮选择器更好用，保持原样。<select> 本身不动：选中后照常改 value、发 change。
const fine = window.matchMedia('(hover: hover) and (pointer: fine)');
let open = null; // { sel, menu, items, at }

function close() {
    if (!open) return;
    open.menu.remove();
    open = null;
}

function mark(i) {
    if (!open || i < 0) return;
    open.at = i;
    open.items.forEach((x, k) => x.el.classList.toggle('on', k === i));
    open.items[i].el.scrollIntoView({ block: 'nearest' });
}

function pick(i) {
    const { sel, items } = open;
    const it = items[i];
    if (!it || it.opt.disabled) return;
    close();
    if (sel.value === it.opt.value && sel.selectedIndex === it.opt.index) return;
    sel.selectedIndex = it.opt.index;
    sel.dispatchEvent(new Event('input', { bubbles: true }));
    sel.dispatchEvent(new Event('change', { bubbles: true }));
}

function place() {
    const { sel, menu } = open;
    const r = sel.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 10;
    const above = r.top - 10;
    const up = below < 180 && above > below;
    menu.style.maxHeight = `${Math.max(120, Math.min(380, up ? above : below))}px`;
    menu.style.minWidth = `${r.width}px`;
    menu.style.maxWidth = `${window.innerWidth - 16}px`;
    const w = menu.offsetWidth;
    menu.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - w - 8))}px`;
    if (up) { menu.style.top = ''; menu.style.bottom = `${window.innerHeight - r.top + 4}px`; } else { menu.style.bottom = ''; menu.style.top = `${r.bottom + 4}px`; }
}

function show(sel) {
    close();
    const menu = document.createElement('div');
    menu.className = 'dd-menu';
    menu.setAttribute('role', 'listbox');
    const items = [];
    const add = (opt) => {
        if (opt.hidden) return;
        const el = document.createElement('div');
        el.className = `dd-item${opt.selected ? ' sel' : ''}${opt.disabled ? ' off' : ''}`;
        el.setAttribute('role', 'option');
        el.textContent = opt.label || opt.textContent;
        const i = items.length;
        el.addEventListener('mousemove', () => { if (open?.at !== i) mark(i); });
        el.addEventListener('mousedown', (e) => e.preventDefault()); // 焦点留在下拉框上
        el.addEventListener('click', () => pick(i));
        items.push({ el, opt });
        menu.append(el);
    };
    for (const c of sel.children) {
        if (c.tagName === 'OPTGROUP') {
            const g = document.createElement('div');
            g.className = 'dd-group';
            g.textContent = c.label;
            menu.append(g);
            for (const o of c.children) add(o);
        } else if (c.tagName === 'OPTION') add(c);
    }
    if (!items.length) return;
    // 详情、弹窗里的下拉框：列表放进同一层，才不会被弹窗盖住或被它的焦点管理关掉
    (sel.closest('dialog') || document.body).append(menu);
    open = { sel, menu, items, at: -1 };
    place();
    mark(Math.max(0, items.findIndex((x) => x.opt.selected)));
}

const wanted = (el) => el instanceof HTMLSelectElement && el.classList.contains('select') && !el.multiple && !el.disabled && el.size <= 1 && fine.matches;

document.addEventListener('mousedown', (e) => {
    if (open && open.menu.contains(e.target)) return;
    const sel = e.target.closest?.('select');
    if (e.button === 0 && wanted(sel)) {
        e.preventDefault(); // 不让系统的列表弹出来
        sel.focus();
        if (open?.sel === sel) close(); else show(sel);
        return;
    }
    close();
}, true);

document.addEventListener('keydown', (e) => {
    if (!open) {
        const sel = e.target;
        if (wanted(sel) && (e.key === 'Enter' || e.key === ' ' || ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && e.altKey))) { e.preventDefault(); show(sel); }
        return;
    }
    const { items, at } = open;
    const step = (d) => { let i = at; do { i += d; } while (items[i] && items[i].opt.disabled); if (items[i]) mark(i); };
    if (e.key === 'Escape' || e.key === 'Tab') { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); } close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); step(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
    else if (e.key === 'Home') { e.preventDefault(); mark(0); }
    else if (e.key === 'End') { e.preventDefault(); mark(items.length - 1); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(at); }
    else if (e.key.length === 1) {
        // 按字母跳到第一个以它开头的
        e.preventDefault();
        const k = e.key.toLowerCase();
        const i = items.findIndex((x, n) => n !== at && !x.opt.disabled && x.el.textContent.trim().toLowerCase().startsWith(k));
        if (i >= 0) mark(i);
    }
}, true);

// 页面滚动、窗口变化、下拉框被重画掉或失去焦点：收起来
document.addEventListener('scroll', (e) => { if (open && !open.menu.contains(e.target)) close(); }, true);
window.addEventListener('resize', close);
window.addEventListener('blur', close);
document.addEventListener('focusout', (e) => { if (open && e.target === open.sel) setTimeout(() => { if (open && document.activeElement !== open.sel) close(); }, 0); });
new MutationObserver(() => { if (open && !open.sel.isConnected) close(); }).observe(document.documentElement, { childList: true, subtree: true });
