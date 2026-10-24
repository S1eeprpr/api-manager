/**
 * 悬浮复制窗：顶层常驻小窗，收起为 💤 圆钮，展开可切任意预设复制 API/Key。
 * 不依赖打开 API 面板；位置记忆；收起(蓝/最小化)常驻，隐藏(红/眼斜杠)整个消失。
 */
import { getSettings, getActivePreset, saveSettings, maskSecret } from '../core/store.js';
import { isCustomLikeSource } from '../core/sources.js';
import { copyToClipboard } from './clipboard.js';

const TOAST_TITLE = '多API管理';
const LOG = '[多API管理]';

let rootEl = null;     // 悬浮窗根容器
let bubbleEl = null;   // 收起态圆钮
let cardEl = null;     // 展开态卡片
let dragState = null;  // 拖动状态

function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

/** 取悬浮窗当前选中的预设（selectedPresetId 为空则跟随激活预设） */
function getSelectedPreset() {
    const s = getSettings();
    const fw = s.floatWindow;
    if (fw.selectedPresetId) {
        const p = s.presets.find(x => x.id === fw.selectedPresetId);
        if (p) return p;
    }
    return getActivePreset();
}

/** 取悬浮窗当前选中的 Key */
function getSelectedKey(preset) {
    if (!preset || !preset.keys.length) return null;
    const fw = getSettings().floatWindow;
    let k = fw.selectedKeyId ? preset.keys.find(x => x.id === fw.selectedKeyId) : null;
    if (!k) k = preset.keys.find(x => x.id === preset.activeKeyId) ?? preset.keys[0];
    return k;
}

function buildHtml() {
    return `
    <div id="apm_float" class="apm-float-root" style="display:none;">
        <div id="apm_float_bubble" class="apm-float-bubble" title="点击展开 / 按住可拖动">💤</div>
        <div id="apm_float_card" class="apm-float-card" style="display:none;">
            <div class="apm-float-dragbar" title="按住可拖动悬浮窗">
                <span class="apm-float-grip"></span>
            </div>
            <div class="apm-float-titlebar">
                <select id="apm_float_preset" class="apm-float-select"></select>
                <span id="apm_float_hide" class="apm-float-btn apm-float-btn-hide" title="隐藏悬浮窗（需回主面板开关重开）">
                    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                        <ellipse cx="8" cy="8" rx="6.5" ry="3.5" fill="none" stroke="currentColor" stroke-width="1.2"/>
                        <circle cx="8" cy="8" r="1.4" fill="currentColor"/>
                        <line x1="2.4" y1="2.4" x2="13.6" y2="13.6" stroke="currentColor" stroke-width="1.5"/>
                    </svg>
                </span>
                <span id="apm_float_collapse" class="apm-float-btn apm-float-btn-collapse" title="收起成圆钮（常驻）">
                    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                        <rect x="3" y="11.4" width="10" height="1.6" fill="currentColor"/>
                    </svg>
                </span>
            </div>
            <div class="apm-float-row">
                <span class="apm-float-label">API</span>
                <span class="apm-float-value apm-mono" id="apm_float_api"></span>
                <span id="apm_float_copy_api" class="apm-float-iconbtn" title="复制 API 地址"><i class="fa-solid fa-copy"></i></span>
            </div>
            <div class="apm-float-row">
                <span class="apm-float-label">Key</span>
                <div id="apm_float_key_dd" class="apm-float-dd">
                    <div id="apm_float_key_toggle" class="apm-float-dd-toggle">
                        <span class="apm-float-dd-mask" id="apm_float_key_mask"></span>
                        <span class="fa-solid fa-chevron-down apm-float-dd-caret"></span>
                    </div>
                    <div id="apm_float_key_list" class="apm-float-dd-list" style="display:none;"></div>
                </div>
                <span id="apm_float_copy_key" class="apm-float-iconbtn" title="复制当前 Key"><i class="fa-solid fa-copy"></i></span>
            </div>
        </div>
    </div>`;
}

function applyPosition() {
    if (!rootEl) return;
    const fw = getSettings().floatWindow;
    rootEl.style.right = 'auto';
    rootEl.style.bottom = 'auto';
    if (fw.x != null && fw.y != null) {
        rootEl.style.left = fw.x + 'px';
        rootEl.style.top = fw.y + 'px';
    } else {
        rootEl.style.right = '20px';
        rootEl.style.bottom = '20px';
        rootEl.style.left = 'auto';
        rootEl.style.top = 'auto';
    }
}

function applyCollapsedState() {
    if (!rootEl) return;
    const fw = getSettings().floatWindow;
    const show = !fw.hidden;
    bubbleEl.style.display = (fw.collapsed && show) ? '' : 'none';
    cardEl.style.display = (!fw.collapsed && show) ? '' : 'none';
}

function refreshPresetSelect() {
    const sel = rootEl?.querySelector('#apm_float_preset');
    if (!sel) return;
    const s = getSettings();
    sel.innerHTML = s.presets.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
    const cur = getSelectedPreset();
    if (cur) sel.value = cur.id;
}

function refreshContent() {
    if (!rootEl) return;
    const s = getSettings();
    // 无预设时悬浮窗内容置空
    if (!s.presets.length) {
        rootEl.querySelector('#apm_float_preset').innerHTML = '';
        rootEl.querySelector('#apm_float_api').textContent = '（无预设）';
        rootEl.querySelector('#apm_float_key_mask').textContent = '（无 Key）';
        rootEl.querySelector('#apm_float_key_list').innerHTML = '';
        return;
    }
    refreshPresetSelect();
    const preset = getSelectedPreset();
    const hasUrl = Boolean(preset && isCustomLikeSource(preset.source) && preset.apiUrl);
    rootEl.querySelector('#apm_float_api').textContent = hasUrl ? preset.apiUrl : (preset ? '（无地址）' : '（无预设）');

    const key = getSelectedKey(preset);
    rootEl.querySelector('#apm_float_key_mask').textContent = key ? maskSecret(key.value) : '（无 Key）';

    const list = rootEl.querySelector('#apm_float_key_list');
    if (preset && preset.keys.length) {
        const curId = key?.id;
        list.innerHTML = preset.keys.map(k => `
            <div class="apm-float-dd-item${k.id === curId ? ' apm-active' : ''}" data-key-id="${esc(k.id)}">
                <span class="apm-float-dd-name">${esc(k.name || '未命名')}</span>
                <span class="apm-float-dd-mask">${esc(maskSecret(k.value))}</span>
            </div>`).join('');
    } else {
        list.innerHTML = '';
    }
}

/** 启用悬浮窗（主面板开关打开时调用） */
export function enable() {
    const fw = getSettings().floatWindow;
    fw.enabled = true;
    fw.hidden = false; // 开关重开时取消隐藏
    saveSettings();
    if (!rootEl) buildAndMount();
    rootEl.style.display = '';
    applyPosition();
    applyCollapsedState();
    refreshContent();
}

/** 禁用悬浮窗（主面板开关关闭时调用） */
export function disable() {
    const fw = getSettings().floatWindow;
    fw.enabled = false;
    saveSettings();
    if (rootEl) rootEl.style.display = 'none';
}

/** 刷新悬浮窗内容（预设增删改后由 panel.refreshPanel 调用） */
export function refresh() {
    if (!rootEl) return;
    const fw = getSettings().floatWindow;
    if (!fw.enabled || fw.hidden) return;
    refreshContent();
}

function buildAndMount() {
    document.body.insertAdjacentHTML('beforeend', buildHtml());
    rootEl = document.querySelector('#apm_float');
    bubbleEl = rootEl.querySelector('#apm_float_bubble');
    cardEl = rootEl.querySelector('#apm_float_card');
    wireEvents();
}

function expandBubble() {
    const fw = getSettings().floatWindow;
    fw.collapsed = false;
    saveSettings();
    applyCollapsedState();
    refreshContent();
}

function collapseToBubble() {
    const fw = getSettings().floatWindow;
    fw.collapsed = true;
    saveSettings();
    applyCollapsedState();
}

function hideFloat() {
    const fw = getSettings().floatWindow;
    fw.hidden = true;
    fw.enabled = false; // 同步主面板开关为关闭态（重开开关时 enable() 会清掉 hidden）
    saveSettings();
    rootEl.style.display = 'none';
    // 同步主面板开关 UI（避免开关还显示"开"但悬浮窗已隐藏）
    const toggle = document.querySelector('#apm_float_toggle');
    if (toggle) toggle.classList.remove('apm-on');
    try { toastr.info('悬浮窗已隐藏，可在主面板开关重新打开', TOAST_TITLE); } catch { /* 忽略 */ }
}

function wireEvents() {
    // 圆钮：拖动 or 点击展开
    setupDrag(bubbleEl, expandBubble);

    // 收起键 / 隐藏键
    rootEl.querySelector('#apm_float_collapse').addEventListener('click', collapseToBubble);
    rootEl.querySelector('#apm_float_hide').addEventListener('click', hideFloat);

    // 预设下拉切换
    rootEl.querySelector('#apm_float_preset').addEventListener('change', (e) => {
        const fw = getSettings().floatWindow;
        fw.selectedPresetId = e.target.value || null;
        fw.selectedKeyId = null; // 切预设重置 Key 选择
        saveSettings();
        refreshContent();
    });

    // Key 下拉
    const keyToggle = rootEl.querySelector('#apm_float_key_toggle');
    const keyList = rootEl.querySelector('#apm_float_key_list');
    keyToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        keyList.style.display = keyList.style.display === 'none' ? '' : 'none';
    });
    keyList.addEventListener('click', (e) => {
        const item = e.target.closest('.apm-float-dd-item');
        if (!item) return;
        e.stopPropagation();
        const fw = getSettings().floatWindow;
        fw.selectedKeyId = item.dataset.keyId;
        saveSettings();
        keyList.style.display = 'none';
        refreshContent();
    });
    document.addEventListener('click', (e) => {
        if (rootEl && !rootEl.contains(e.target)) keyList.style.display = 'none';
    });

    // 复制 API
    rootEl.querySelector('#apm_float_copy_api').addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
            const preset = getSelectedPreset();
            if (!preset || !preset.apiUrl) { try { toastr.warning('该预设没有 API 地址', TOAST_TITLE); } catch { /* */ } return; }
            await copyToClipboard(preset.apiUrl);
            try { toastr.success('API 地址已复制', TOAST_TITLE); } catch { /* */ }
        } catch (err) {
            console.error(LOG, '悬浮窗复制 API 失败', err);
        }
    });

    // 复制 Key
    rootEl.querySelector('#apm_float_copy_key').addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
            const preset = getSelectedPreset();
            const key = getSelectedKey(preset);
            if (!key) { try { toastr.warning('该预设没有 Key', TOAST_TITLE); } catch { /* */ } return; }
            await copyToClipboard(key.value);
            try { toastr.success(`Key「${key.name || '未命名'}」已复制`, TOAST_TITLE); } catch { /* */ }
        } catch (err) {
            console.error(LOG, '悬浮窗复制 Key 失败', err);
        }
    });

    // 专门的拖拽条：整窗拖动（纯空白区域，无交互元素，抓取区域充足）
    const dragbar = rootEl.querySelector('.apm-float-dragbar');
    setupDrag(dragbar, null);
}

/**
 * 通用拖动绑定。
 * @param handle 拖动手柄元素
 * @param onClick 未发生拖动时的点击回调（圆钮=展开；标题栏=null）
 * @param skipFn 返回 true 时本次不启动拖动（标题栏交互元素）
 */
function setupDrag(handle, onClick, skipFn = null) {
    if (!handle) return;
    handle.addEventListener('mousedown', (e) => startDrag(e, onClick, skipFn));
    handle.addEventListener('touchstart', (e) => startDrag(e, onClick, skipFn), { passive: true });
}

function startDrag(e, onClick, skipFn) {
    if (skipFn && skipFn(e.target)) return;
    const isTouch = e.type === 'touchstart';
    const pt = isTouch ? e.touches[0] : e;
    dragState = {
        startX: pt.clientX,
        startY: pt.clientY,
        baseLeft: 0,
        baseTop: 0,
        moved: false,
        isTouch,
        onClick,
        move: null,
        end: null,
    };
    const move = isTouch ? onTouchMove : onMouseMove;
    const end = isTouch ? onTouchEnd : onMouseUp;
    dragState.move = move;
    dragState.end = end;
    document.addEventListener(isTouch ? 'touchmove' : 'mousemove', move, isTouch ? { passive: false } : false);
    document.addEventListener(isTouch ? 'touchend' : 'mouseup', end);
}

function onMouseMove(e) { doDrag(e.clientX, e.clientY); }
function onTouchMove(e) {
    if (!dragState || !e.touches[0]) return;
    doDrag(e.touches[0].clientX, e.touches[0].clientY);
}
function onMouseUp() { endDrag(false); }
function onTouchEnd() { endDrag(true); }

function doDrag(cx, cy) {
    if (!dragState) return;
    const dx = cx - dragState.startX;
    const dy = cy - dragState.startY;
    if (!dragState.moved) {
        if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return; // 阈值，避免点击误触
        dragState.moved = true;
        const rect = rootEl.getBoundingClientRect();
        dragState.baseLeft = rect.left;
        dragState.baseTop = rect.top;
        rootEl.style.right = 'auto';
        rootEl.style.bottom = 'auto';
    }
    rootEl.style.left = (dragState.baseLeft + dx) + 'px';
    rootEl.style.top = (dragState.baseTop + dy) + 'px';
}

function endDrag(isTouch) {
    if (!dragState) return;
    document.removeEventListener(isTouch ? 'touchmove' : 'mousemove', dragState.move, isTouch ? { passive: false } : false);
    document.removeEventListener(isTouch ? 'touchend' : 'mouseup', dragState.end);
    const st = dragState;
    dragState = null;
    if (st.moved) {
        // 存位置（边界保护，不让拖出可视区）
        const rect = rootEl.getBoundingClientRect();
        const x = Math.max(4, Math.min(Math.round(rect.left), window.innerWidth - 20));
        const y = Math.max(4, Math.min(Math.round(rect.top), window.innerHeight - 20));
        const fw = getSettings().floatWindow;
        fw.x = x;
        fw.y = y;
        saveSettings();
    } else if (st.onClick) {
        // 未拖动 = 点击（如圆钮展开）
        try { st.onClick(); } catch (err) { console.error(LOG, '悬浮窗点击回调失败', err); }
        // 展开/收起后 UI 元素位置变化，紧接着的 click 可能误落在新出现的控件上
        // （如圆钮展开后 select 被点开下拉），用 capture 阶段吞掉这次 click
        const swallow = (ev) => {
            document.removeEventListener('click', swallow, true);
            ev.stopPropagation();
            ev.preventDefault();
        };
        document.addEventListener('click', swallow, true);
    }
}

/** 初始化：按设置决定是否显示（启动时由 index.js 调用） */
export function init() {
    const fw = getSettings().floatWindow;
    if (!fw.enabled || fw.hidden) return;
    if (!rootEl) buildAndMount();
    rootEl.style.display = '';
    applyPosition();
    applyCollapsedState();
    refreshContent();
}
