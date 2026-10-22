import { getSettings, getPreset, getActivePreset, saveSettings, setMode, maskSecret } from '../core/store.js';
import { getSourceLabel, isCustomLikeSource } from '../core/sources.js';
import { applyPreset, applyKey } from '../core/apply.js';
import { openNewPresetDialog, openEditPresetDialog } from './dialogs.js';

const TOAST_TITLE = 'API 预设管家';
const LOG = '[API预设管家]';
let applying = false;
let wired = false;

function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

function panelHtml() {
    return `
    <div id="apm_panel" style="display:none;">
        <div class="apm-row">
            <span class="apm-label">配置预设</span>
            <select id="apm_preset_select" class="text_pole"></select>
            <div id="apm_btn_new" class="menu_button" title="新建配置预设">新建</div>
            <div id="apm_btn_edit" class="menu_button" title="编辑预设">编辑</div>
        </div>
        <div class="apm-row" id="apm_key_row">
            <span class="apm-label">Key</span>
            <div id="apm_key_dd" class="apm-dd">
                <div id="apm_key_dd_toggle" class="apm-dd-toggle">
                    <span class="apm-dd-name" id="apm_key_name"></span>
                    <span class="apm-dd-mask" id="apm_key_mask"></span>
                    <span class="fa-solid fa-chevron-down apm-dd-caret"></span>
                </div>
                <div id="apm_key_dd_list" class="apm-dd-list" style="display:none;"></div>
            </div>
        </div>
        <div class="apm-info" id="apm_info"></div>
        <div id="apm_empty" style="display:none;">
            <div class="apm-empty-text">还没有配置预设。一个预设 = 一个 API 地址 + 一至多个可命名的 Key。</div>
            <div id="apm_empty_new" class="menu_button">新建你的第一个预设</div>
        </div>
    </div>`;
}

/** 改版模式下需要隐藏的原生控件（地址/Key 输入区；来源/模型/后处理保留） */
function tagNativeHideables(root) {
    const tag = (el) => { if (el) el.classList.add('apm-native-hide'); };

    // Custom 地址输入行：h4 + 输入框行 + 预览小字
    const urlInput = root.querySelector('#custom_api_url_text');
    if (urlInput) {
        const row = urlInput.closest('.flex-container');
        tag(row);
        const h4 = row?.previousElementSibling;
        if (h4?.tagName === 'H4') tag(h4);
        const preview = row?.nextElementSibling;
        if (preview?.querySelector?.('#custom_endpoint_preview')) tag(preview);
    }

    // 各来源 Key 输入行：h4 + 输入框行 + 隐私提示
    root.querySelectorAll('input[id^="api_key_"]').forEach(input => {
        const row = input.closest('.flex-container');
        if (!row) return;
        tag(row);
        const h4 = row.previousElementSibling;
        if (h4?.tagName === 'H4') tag(h4);
        const warn = row.nextElementSibling;
        if (warn?.classList?.contains('neutral_warning')) tag(warn);
    });
}

async function switchToPreset(presetId) {
    if (applying) return;
    const preset = getPreset(presetId);
    if (!preset) return;
    applying = true;
    try {
        const s = getSettings();
        s.activePresetId = preset.id;
        saveSettings();
        refreshPanel();
        await applyPreset(preset);
        saveSettings();
        toastr.success(`已切换到「${preset.name}」`, TOAST_TITLE);
    } catch (e) {
        console.error(LOG, '切换预设失败', e);
        toastr.error(`切换预设失败：${e?.message ?? e}`, TOAST_TITLE);
    } finally {
        applying = false;
        refreshPanel();
    }
}

async function switchKey(keyId) {
    if (applying) return;
    const preset = getActivePreset();
    const key = preset?.keys.find(k => k.id === keyId);
    if (!preset || !key || key.id === preset.activeKeyId) return;
    applying = true;
    try {
        preset.activeKeyId = key.id;
        saveSettings();
        refreshPanel();
        const ok = await applyKey(preset, key);
        saveSettings();
        if (ok) toastr.success(`已切换到 Key「${key.name}」`, TOAST_TITLE);
        else toastr.warning('Key 切换未完成，请检查官方密钥库', TOAST_TITLE);
    } catch (e) {
        console.error(LOG, '切换 Key 失败', e);
        toastr.error(`切换 Key 失败：${e?.message ?? e}`, TOAST_TITLE);
    } finally {
        applying = false;
        refreshPanel();
    }
}

function closeKeyList() {
    $('#apm_key_dd_list').hide();
}

/** 全部用 document 级事件委托，避免元素注入时序导致绑定失败 */
function wirePanelEvents() {
    if (wired) return;
    wired = true;
    const $doc = $(document);

    $doc.on('change', '#apm_preset_select', function () {
        switchToPreset(String($(this).val()));
    });

    $doc.on('click', '#apm_btn_new, #apm_empty_new', async function (e) {
        e.preventDefault();
        if (applying) return;
        try {
            const preset = await openNewPresetDialog();
            if (!preset) return;
            getSettings().activePresetId = preset.id;
            saveSettings();
            refreshPanel();
            try {
                await applyPreset(preset);
                saveSettings();
                toastr.success(`预设「${preset.name}」已创建并切换`, TOAST_TITLE);
            } catch (e2) {
                console.error(LOG, '应用新预设失败', e2);
                toastr.error(`应用新预设失败：${e2?.message ?? e2}`, TOAST_TITLE);
            }
            refreshPanel();
        } catch (err) {
            console.error(LOG, '新建预设失败', err);
            toastr.error(`新建预设失败：${err?.message ?? err}`, TOAST_TITLE);
        }
    });

    $doc.on('click', '#apm_btn_edit', async function (e) {
        e.preventDefault();
        try {
            const preset = await openEditPresetDialog();
            refreshPanel();
            if (!preset) return;
            const s = getSettings();
            if (s.activePresetId === preset.id) {
                try {
                    await applyPreset(preset);
                    saveSettings();
                    toastr.success('预设已保存并重新应用', TOAST_TITLE);
                } catch (e2) {
                    console.error(LOG, '重新应用预设失败', e2);
                    toastr.error(`重新应用失败：${e2?.message ?? e2}`, TOAST_TITLE);
                }
            } else {
                toastr.success('预设已保存', TOAST_TITLE);
            }
            refreshPanel();
        } catch (err) {
            console.error(LOG, '编辑预设失败', err);
            toastr.error(`编辑预设失败：${err?.message ?? err}`, TOAST_TITLE);
        }
    });

    $doc.on('click', '#apm_mode_toggle', function (e) {
        e.preventDefault();
        try {
            const cur = getSettings().mode;
            const next = cur === 'preset' ? 'native' : 'preset';
            setMode(next);
            applyMode();
            if (next === 'preset') refreshPanel();
            toastr.info(next === 'preset' ? '已切换到预设界面' : '已切换到原生界面', TOAST_TITLE);
        } catch (err) {
            console.error(LOG, '切换模式失败', err);
            toastr.error(`切换模式失败：${err?.message ?? err}`, TOAST_TITLE);
        }
    });

    $doc.on('click', '#apm_key_dd_toggle', function (e) {
        e.stopPropagation();
        $('#apm_key_dd_list').toggle();
    });
    $doc.on('click', '.apm-dd-item', function (e) {
        e.stopPropagation();
        closeKeyList();
        switchKey(String($(this).attr('data-key-id')));
    });
    $doc.on('click', function (e) {
        const dd = document.querySelector('#apm_key_dd');
        if (dd && !dd.contains(e.target)) closeKeyList();
    });
}

export function initPanel() {
    // 1. 主面板：注入到「聊天补全来源」选择器之后，使来源保持在最上面
    if (!document.querySelector('#apm_panel')) {
        const sourceSelect = document.querySelector('#chat_completion_source');
        if (sourceSelect) {
            sourceSelect.insertAdjacentHTML('afterend', panelHtml());
        } else {
            const root = document.querySelector('#openai_api');
            if (root) root.insertAdjacentHTML('afterbegin', panelHtml());
        }
    }
    // 2. 模式切换按钮：注入到 Test Message 按钮右边
    if (!document.querySelector('#apm_mode_toggle')) {
        const testBtn = document.querySelector('#test_api_button');
        if (testBtn) {
            testBtn.insertAdjacentHTML('afterend',
                '<div id="apm_mode_toggle" class="menu_button menu_button_icon" style="display:none;" title="切换 API 连接界面">原生界面</div>');
        }
    }
    const root = document.querySelector('#openai_api');
    if (root) tagNativeHideables(root);
    wirePanelEvents();
    refreshPanel();
}

/** 按 settings.mode 切换 改版/原生 界面（纯显隐，不触发连接动作） */
export function applyMode() {
    const mode = getSettings().mode;
    const root = document.querySelector('#openai_api');
    if (root) root.classList.toggle('apm-preset-mode', mode === 'preset');
    const showPanel = mode === 'preset';
    $('#apm_panel').toggle(showPanel);
    const toggle = document.querySelector('#apm_mode_toggle');
    if (toggle) {
        toggle.style.display = '';
        toggle.textContent = showPanel ? '原生界面' : '预设界面';
        toggle.title = showPanel ? '切换到原生 API 连接界面' : '切换到预设管理界面';
    }
}

export function refreshPanel() {
    const s = getSettings();
    const active = getActivePreset();
    const has = s.presets.length > 0;

    const sel = document.querySelector('#apm_preset_select');
    if (sel) {
        sel.innerHTML = s.presets.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
        if (active) sel.value = active.id;
    }

    $('#apm_preset_select, #apm_btn_edit').toggle(has);
    $('#apm_empty').toggle(!has);
    $('#apm_key_row').toggle(Boolean(active && active.keys.length > 0));
    $('#apm_info').toggle(Boolean(active));

    if (!active) return;

    const parts = [getSourceLabel(active.source)];
    if (isCustomLikeSource(active.source)) parts.push(active.apiUrl || '未填地址');
    if (active.defaultModel) parts.push(`默认模型：${active.defaultModel}`);
    $('#apm_info').text(parts.join(' · '));

    const key = active.keys.find(k => k.id === active.activeKeyId) ?? active.keys[0];
    $('#apm_key_name').text(key?.name ?? '');
    $('#apm_key_mask').text(key ? maskSecret(key.value) : '');
    $('#apm_key_dd_list').html(active.keys.map(k => `
        <div class="apm-dd-item${k.id === active.activeKeyId ? ' apm-active' : ''}" data-key-id="${esc(k.id)}">
            <span class="apm-dd-name">${esc(k.name)}</span>
            <span class="apm-dd-mask">${esc(maskSecret(k.value))}</span>
        </div>`).join(''));
}
