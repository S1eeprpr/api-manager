import { getSettings, getPreset, getActivePreset, saveSettings, setMode, maskSecret } from '../core/store.js';
import { getSourceLabel, isCustomLikeSource } from '../core/sources.js';
import { applyPreset, applyKey } from '../core/apply.js';
import { openNewPresetDialog, openEditPresetDialog } from './dialogs.js';

const TOAST_TITLE = '多API管理';
const LOG = '[多API管理]';
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
        <div class="apm-row apm-row-presets">
            <span class="apm-label">配置预设</span>
            <select id="apm_preset_select" class="text_pole"></select>
            <div id="apm_btn_new" class="menu_button" title="新建配置预设">新建</div>
            <div id="apm_btn_edit" class="menu_button" title="编辑预设">编辑</div>
        </div>
        <div class="apm-row apm-info-row" id="apm_source_row">
            <span class="apm-label">聊天补全来源</span>
            <span class="apm-info-value" id="apm_source_text"></span>
        </div>
        <div class="apm-row apm-info-row" id="apm_api_row">
            <span class="apm-label">API<span id="apm_btn_copy_api" class="apm-icon-btn" title="复制当前预设的 API 地址到剪贴板"><i class="fa-solid fa-copy"></i></span></span>
            <span class="apm-info-value apm-mono" id="apm_api_text"></span>
            <span id="apm_btn_site" class="apm-icon-btn" title="在浏览器打开 API 对应的站点首页（自动去掉 /v1）"><i class="fa-solid fa-arrow-up-right-from-square"></i></span>
        </div>
        <div class="apm-row" id="apm_key_row">
            <span class="apm-label">Key<span id="apm_btn_copy_key" class="apm-icon-btn" title="复制当前选中的 Key 到剪贴板"><i class="fa-solid fa-copy"></i></span></span>
            <div id="apm_key_dd" class="apm-dd">
                <div id="apm_key_dd_toggle" class="apm-dd-toggle">
                    <span class="apm-dd-name" id="apm_key_name"></span>
                    <span class="apm-dd-mask" id="apm_key_mask"></span>
                    <span class="fa-solid fa-chevron-down apm-dd-caret"></span>
                </div>
                <div id="apm_key_dd_list" class="apm-dd-list" style="display:none;"></div>
            </div>
        </div>
        <div class="apm-row apm-info-row" id="apm_model_row">
            <span class="apm-label">默认模型</span>
            <span class="apm-info-value apm-mono" id="apm_model_text"></span>
        </div>
        <div id="apm_empty" style="display:none;">
            <div class="apm-empty-text">还没有配置预设。一个预设 = 一个 API 地址 + 一至多个可命名的 Key。</div>
            <div id="apm_empty_new" class="menu_button">新建你的第一个预设</div>
        </div>
    </div>`;
}

/** 改版模式下需要隐藏的原生控件（主 API 选择行 + 地址/Key 输入区；来源/模型/后处理保留） */
function tagNativeHideables() {
    const tag = (el) => { if (el) el.classList.add('apm-native-hide'); };
    const root = document.querySelector('#openai_api');

    // 主 API 选择行（#rm_api_block 内，不在 #openai_api 内）：h3 标题 + 选择器块
    // 只用聊天补全，无需主 API 选择
    tag(document.querySelector('#title_api'));
    tag(document.querySelector('#main-API-selector-block'));

    // 原生「API连接配置」（Connection Profile 内置扩展的 UI）——本扩展取代的就是它，隐藏。
    // 该扩展异步注入到 #rm_api_block 顶部，加载时机不定，用 MutationObserver 等它出现再打标。
    const tagConnectionProfileBlock = () => {
        const select = document.querySelector('#connection_profiles');
        if (!select) return false;
        tag(select.closest('.wide100p'));
        return true;
    };
    if (!tagConnectionProfileBlock()) {
        const rmBlock = document.querySelector('#rm_api_block');
        if (rmBlock) {
            const observer = new MutationObserver(() => {
                if (tagConnectionProfileBlock()) observer.disconnect();
            });
            observer.observe(rmBlock, { childList: true, subtree: true });
            setTimeout(() => observer.disconnect(), 30000); // 30s 兜底防泄漏
        }
    }

    // 注意：#openai_api-presets（Chat Completion 预设/破甲预设栏）保持显示，不要隐藏！

    if (!root) return;

    // 聊天补全来源行：h4 标题 + select（来源只在新建/编辑预设弹窗里选择，主面板不再显示）
    const sourceSelect = root.querySelector('#chat_completion_source');
    if (sourceSelect) {
        tag(sourceSelect);
        const h4 = sourceSelect.previousElementSibling;
        if (h4?.tagName === 'H4') tag(h4);
    }

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

/** 复制到剪贴板（优先 navigator.clipboard，降级 execCommand） */
async function copyToClipboard(text) {
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            return;
        }
    } catch { /* 降级 */ }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
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
            const hadActive = Boolean(getSettings().activePresetId);
            const preset = await openNewPresetDialog();
            if (!preset) return;
            // 保存不切换：已有激活预设时保持不变；仅首次（无任何激活预设）时选中新预设
            if (!hadActive) {
                getSettings().activePresetId = preset.id;
                saveSettings();
            }
            refreshPanel();
            toastr.success(`预设「${preset.name}」已保存，切换下拉即可应用`, TOAST_TITLE);
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

    // 跳转站点：去掉末尾 /v1 等版本段，打开站点首页
    $doc.on('click', '#apm_btn_site', function (e) {
        e.preventDefault();
        try {
            const active = getActivePreset();
            if (!active || !active.apiUrl) { toastr.warning('当前预设没有 API 地址', TOAST_TITLE); return; }
            let siteUrl = active.apiUrl.replace(/\/+$/, '').replace(/\/v\d+\/?$/, '').replace(/\/+$/, '');
            window.open(siteUrl, '_blank', 'noopener');
            toastr.info(`正在打开 ${siteUrl}`, TOAST_TITLE);
        } catch (err) {
            console.error(LOG, '跳转站点失败', err);
            toastr.error(`跳转站点失败：${err?.message ?? err}`, TOAST_TITLE);
        }
    });

    // 复制 API 地址
    $doc.on('click', '#apm_btn_copy_api', async function (e) {
        e.preventDefault();
        try {
            const active = getActivePreset();
            if (!active || !active.apiUrl) { toastr.warning('当前预设没有 API 地址', TOAST_TITLE); return; }
            await copyToClipboard(active.apiUrl);
            toastr.success('API 地址已复制到剪贴板', TOAST_TITLE);
        } catch (err) {
            console.error(LOG, '复制 API 失败', err);
            toastr.error(`复制失败：${err?.message ?? err}`, TOAST_TITLE);
        }
    });

    // 复制当前选中的 Key
    $doc.on('click', '#apm_btn_copy_key', async function (e) {
        e.preventDefault();
        try {
            const active = getActivePreset();
            if (!active) { toastr.warning('没有激活的预设', TOAST_TITLE); return; }
            const key = active.keys.find(k => k.id === active.activeKeyId) ?? active.keys[0];
            if (!key) { toastr.warning('该预设没有 Key', TOAST_TITLE); return; }
            await copyToClipboard(key.value);
            toastr.success(`Key「${key.name || '未命名'}」已复制到剪贴板`, TOAST_TITLE);
        } catch (err) {
            console.error(LOG, '复制 Key 失败', err);
            toastr.error(`复制失败：${err?.message ?? err}`, TOAST_TITLE);
        }
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
    tagNativeHideables();
    wirePanelEvents();
    refreshPanel();
}

/** 按 settings.mode 切换 改版/原生 界面（纯显隐，不触发连接动作） */
export function applyMode() {
    const mode = getSettings().mode;
    const root = document.querySelector('#openai_api');
    const showPanel = mode === 'preset';
    // body 级 class：需覆盖 #openai_api 之外的元素（如 #title_api、#main-API-selector-block）
    document.body.classList.toggle('apm-preset-mode', showPanel);
    if (root) root.classList.toggle('apm-preset-mode', showPanel);
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
    $('#apm_source_row').toggle(Boolean(active));
    $('#apm_key_row').toggle(Boolean(active && active.keys.length > 0));

    if (!active) return;

    // 信息三行：来源 / API（仅 custom 类来源有地址）/ 默认模型（留空则整行隐藏）
    $('#apm_source_text').text(getSourceLabel(active.source));

    const hasUrl = Boolean(isCustomLikeSource(active.source) && active.apiUrl);
    $('#apm_api_row').toggle(hasUrl);
    $('#apm_api_text').text(hasUrl ? active.apiUrl : '');

    $('#apm_model_row').toggle(Boolean(active.defaultModel));
    $('#apm_model_text').text(active.defaultModel || '');

    const key = active.keys.find(k => k.id === active.activeKeyId) ?? active.keys[0];
    const hasName = Boolean(key?.name);
    $('#apm_key_name').text(hasName ? key.name : '').toggle(hasName);
    $('#apm_key_mask').text(key ? maskSecret(key.value) : '');
    $('#apm_key_dd_list').html(active.keys.map(k => {
        const kn = Boolean(k.name);
        return `
        <div class="apm-dd-item${k.id === active.activeKeyId ? ' apm-active' : ''}" data-key-id="${esc(k.id)}">
            <span class="apm-dd-name"${kn ? '' : ' style="display:none;"'}>${esc(k.name ?? '')}</span>
            <span class="apm-dd-mask">${esc(maskSecret(k.value))}</span>
        </div>`;
    }).join(''));
}
