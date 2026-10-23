import {
    getHangSettings,
    saveHangSettings,
    newId,
    upsertSite,
    removeSite,
    setSiteSize,
    setLauncherVisible,
    normalizeUrl,
    SIZE_MODES,
} from '../core/hang-store.js';

const LOG = '[多API管理·挂机窗口]';
const TOAST_TITLE = '挂机窗口';

let mounted = false;

function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function sizeOptions(selected) {
    return Object.entries(SIZE_MODES)
        .map(([k, v]) => `<option value="${k}"${k === selected ? ' selected' : ''}>${v.label}</option>`)
        .join('');
}

function launcherHtml() {
    return `
    <div id="hb_launcher" title="挂机窗口（应用内浏览器）">
        <i class="fa-solid fa-globe"></i>
    </div>
    <div id="hb_panel" class="hb-hidden">
        <div class="hb-head">
            <span class="hb-title"><i class="fa-solid fa-globe"></i> 挂机窗口</span>
            <span class="hb-head-btns">
                <span id="hb_open_all" class="menu_button" title="按各自尺寸依次打开全部站点">全部打开</span>
                <span id="hb_panel_close" class="hb-x" title="收起面板（站点窗口不受影响）">&times;</span>
            </span>
        </div>
        <div class="hb-hint">
            打开的是应用内独立浏览器窗口，关掉面板/酒馆重启前都会持续运行。
            需要"不挡视野又想稳定挂机"时，用「迷你」尺寸并把它拖到屏幕角落——最小化会被系统降频，迷你尺寸不会。
        </div>
        <div id="hb_list" class="hb-list"></div>
        <div class="hb-add">
            <input id="hb_new_name" class="text_pole" maxlength="40" placeholder="名称（可留空）">
            <input id="hb_new_url" class="text_pole" placeholder="网址，如 https://example.com">
            <div class="hb-add-row">
                <select id="hb_new_size" class="text_pole">${sizeOptions('normal')}</select>
                <span id="hb_add_btn" class="menu_button">添加站点</span>
            </div>
        </div>
    </div>`;
}

function siteRowHtml(site) {
    const name = site.name?.trim() || site.url;
    return `
    <div class="hb-item" data-site-id="${esc(site.id)}">
        <div class="hb-item-main">
            <div class="hb-item-name" title="${esc(site.name || '')}">${esc(name)}</div>
            <div class="hb-item-url" title="${esc(site.url)}">${esc(site.url)}</div>
        </div>
        <div class="hb-item-actions">
            <select class="hb-item-size text_pole" data-site-id="${esc(site.id)}">${sizeOptions(site.size)}</select>
            <span class="menu_button hb-open" data-site-id="${esc(site.id)}">打开</span>
            <span class="hb-del" data-site-id="${esc(site.id)}" title="删除">&times;</span>
        </div>
    </div>`;
}

function renderList() {
    const s = getHangSettings();
    const $list = $('#hb_list');
    if (!$list.length) return;
    if (!s.sites.length) {
        $list.html('<div class="hb-empty">还没有站点。在下面填一个网址，添加后点「打开」就能在应用内浏览器里挂机。</div>');
        return;
    }
    $list.html(s.sites.map(siteRowHtml).join(''));
}

/**
 * 打开站点窗口。
 * 关键：features 必须带 width/height —— TauriTavern 主窗口的 on_new_window 处理器
 * 只有在窗口特征带尺寸/坐标时才在应用内创建 WebviewWindow，否则会把链接交给系统浏览器。
 * name 用站点 id，同名复用同一窗口，重复点击等于聚焦。
 */
export function openSiteWindow(site) {
    const url = normalizeUrl(site?.url);
    if (!url) {
        toastr.error('网址为空', TOAST_TITLE);
        return null;
    }
    const mode = SIZE_MODES[site.size] ?? SIZE_MODES.normal;
    const availW = Number(window.screen?.availWidth) || 1280;
    const availH = Number(window.screen?.availHeight) || 800;
    const left = Math.max(0, Math.round((availW - mode.w) / 2));
    const top = Math.max(0, Math.round((availH - mode.h) / 2));
    const features = `width=${mode.w},height=${mode.h},left=${left},top=${top},resizable=yes,scrollbars=yes`;

    let win = null;
    try {
        win = window.open(url, `hb_${site.id}`, features);
    } catch (e) {
        console.error(LOG, 'window.open 异常', e);
    }
    if (!win) {
        toastr.warning('窗口没能打开（可能被拦截）。再点一次，或先点一下页面任意位置后重试', TOAST_TITLE);
        return null;
    }
    return win;
}

function addSite() {
    const name = String($('#hb_new_name').val() ?? '').trim();
    const rawUrl = String($('#hb_new_url').val() ?? '').trim();
    const size = String($('#hb_new_size').val() ?? 'normal');
    const url = normalizeUrl(rawUrl);
    if (!url) {
        toastr.error('请填写网址', TOAST_TITLE);
        return;
    }
    const site = { id: newId(), name, url, size: SIZE_MODES[size] ? size : 'normal' };
    upsertSite(site);
    $('#hb_new_name').val('');
    $('#hb_new_url').val('');
    renderList();
    toastr.success(`已添加「${name || url}」`, TOAST_TITLE);
}

function togglePanel(force) {
    const $panel = $('#hb_panel');
    if (!$panel.length) return;
    const willShow = typeof force === 'boolean' ? force : $panel.hasClass('hb-hidden');
    $panel.toggleClass('hb-hidden', !willShow);
    if (willShow) renderList();
}

function applyLauncherVisibility() {
    const s = getHangSettings();
    $('#hb_launcher').toggle(Boolean(s.launcherVisible));
}

function wireEvents() {
    const $doc = $(document);
    // 用小圆球作为唯一入口：点它开/关面板，面板本身可自由收起，不影响已开的挂机窗口
    $doc.on('click', '#hb_launcher', function (e) {
        e.preventDefault();
        e.stopPropagation();
        togglePanel();
    });
    $doc.on('click', '#hb_panel_close', function (e) {
        e.preventDefault();
        togglePanel(false);
    });
    $doc.on('click', '#hb_add_btn', function (e) {
        e.preventDefault();
        try {
            addSite();
        } catch (err) {
            console.error(LOG, '添加站点失败', err);
            toastr.error(`添加失败：${err?.message ?? err}`, TOAST_TITLE);
        }
    });
    $doc.on('keydown', '#hb_new_url, #hb_new_name', function (e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            $('#hb_add_btn').trigger('click');
        }
    });
    $doc.on('click', '.hb-open', function (e) {
        e.preventDefault();
        e.stopPropagation();
        const id = String($(this).attr('data-site-id') ?? '');
        const site = getHangSettings().sites.find(x => x.id === id);
        if (!site) return;
        openSiteWindow(site);
    });
    $doc.on('change', '.hb-item-size', function () {
        const id = String($(this).attr('data-site-id') ?? '');
        setSiteSize(id, String($(this).val() ?? 'normal'));
    });
    $doc.on('click', '.hb-del', function (e) {
        e.preventDefault();
        e.stopPropagation();
        const id = String($(this).attr('data-site-id') ?? '');
        const site = getHangSettings().sites.find(x => x.id === id);
        if (!site) return;
        const label = site.name?.trim() || site.url;
        if (!window.confirm(`删除站点「${label}」？（已打开的那个窗口需要你手动关）`)) return;
        removeSite(id);
        renderList();
    });
    $doc.on('click', '#hb_open_all', function (e) {
        e.preventDefault();
        const sites = getHangSettings().sites;
        if (!sites.length) {
            toastr.info('还没有站点', TOAST_TITLE);
            return;
        }
        // 逐个错开：一次性连续开多个窗口容易被当成弹窗拦截
        sites.forEach((site, i) => setTimeout(() => openSiteWindow(site), i * 450));
    });
    $doc.on('click', function (e) {
        const $panel = $('#hb_panel');
        if ($panel.hasClass('hb-hidden')) return;
        if ($(e.target).closest('#hb_panel, #hb_launcher').length) return;
        togglePanel(false);
    });
    $doc.on('keydown', function (e) {
        if (e.key === 'Escape') togglePanel(false);
    });
}

export function initHangPanel() {
    if (mounted) return;
    mounted = true;
    try {
        if (!document.querySelector('#hb_launcher')) {
            $('body').append(launcherHtml());
        }
        wireEvents();
        applyLauncherVisibility();
        renderList();
        console.log(LOG, '已挂载（右下角地球图标）');
    } catch (e) {
        mounted = false;
        console.error(LOG, '挂载失败', e);
    }
}

/** 供设置面板/其他模块切换入口显隐 */
export function setHangLauncherVisible(visible) {
    setLauncherVisible(visible);
    applyLauncherVisibility();
    if (!visible) togglePanel(false);
    saveHangSettings();
}
