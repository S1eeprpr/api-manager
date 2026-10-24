import { eventSource, event_types } from '/scripts/events.js';
import { oai_settings } from '/scripts/openai.js';
import { getSecretKeyName, isCustomLikeSource, getSourceLabel, getModelControl, normalizeSource } from './sources.js';
import { activateKey } from './secrets-bridge.js';

const LOG = '[多API管理]';
const delay = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * 应用预设：换 API 地址 + 投放 Key + 同步默认模型 + 触发连接。
 * 来源：归一化后与当前相同则完全不动（不触发正则/破甲级联刷新）；
 *       不同才自动切换来源（此时官方会级联刷新一次正则/破甲，属预期代价）。
 * 模型控件只设值（change/input 仅更新模型选择，不触发来源级联刷新，无副作用）。
 */
export async function applyPreset(preset, { connect = true } = {}) {
    // 1. 来源：归一化比较（custom_xxx 变体与 custom 同槽，视为相同不动）
    const currentSource = String($('#chat_completion_source').val() ?? '');
    if (normalizeSource(currentSource) !== normalizeSource(preset.source)) {
        toastr.info(`预设来源不同，正在切换到「${getSourceLabel(preset.source)}」…`, '多API管理');
        $('#chat_completion_source').val(preset.source).trigger('change');
        await delay(1200); // 等官方来源切换的异步初始化完成（表单加载/清旧值等）
    }

    // 2. API 地址（仅 custom 系来源）
    if (isCustomLikeSource(preset.source) && preset.apiUrl) {
        const urlEl = $('#custom_api_url_text');
        if (urlEl.length) {
            urlEl.val(preset.apiUrl).trigger('input');
        }
    }

    // 3. Key 投放（rotateSecret 内部会触发重连）
    const secretKeyName = getSecretKeyName(preset.source);
    const key = preset.keys.find(k => k.id === preset.activeKeyId) ?? preset.keys[0] ?? null;
    let reconnected = false;
    if (key?.value && secretKeyName) {
        preset.activeKeyId = key.id;
        reconnected = await activateKey(preset, key, secretKeyName);
        if (!reconnected) {
            toastr.warning('Key 投放失败，请检查官方密钥库或切换到原生界面排查', '多API管理');
        }
    }

    // 4. 默认模型（只设模型控件值，不触发来源级联，无正则/破甲副作用）
    applyDefaultModel(preset);

    // 5. 无 Key 可投（免密预设等）→ 手动触发官方 Connect
    if (connect && !reconnected) {
        $('#api_button_openai').trigger('click');
    }
}

/** 预设内秒换 Key：只投放 + 重连，不动来源/地址/模型 */
export async function applyKey(preset, key) {
    const secretKeyName = getSecretKeyName(preset.source);
    if (!secretKeyName) {
        toastr.warning('该来源没有可用的密钥槽', '多API管理');
        return false;
    }
    preset.activeKeyId = key.id;
    return await activateKey(preset, key, secretKeyName);
}

/**
 * 默认模型：先写 oai_settings 持久化；DOM 控件能设则设，
 * select 选项未加载时等 ONLINE_STATUS_CHANGED 后再同步一次。
 * 模型控件 change/input 只更新模型选择，不触发来源级联刷新（无正则/破甲副作用）。
 * 预设无默认模型时主动清空模型名（不保留上一个预设的模型）。
 */
export function applyDefaultModel(preset) {
    const control = getModelControl(preset.source);
    if (!control) return;

    const model = String(preset.defaultModel ?? '').trim();

    // 无默认模型 → 清空模型名（oai_settings + 控件）
    if (!model) {
        try { oai_settings[control.settingKey] = ''; } catch { /* 忽略 */ }
        const el = $(control.selector);
        if (!el.length) return;
        if (!el.is('select')) {
            el.val('').trigger('input');
        } else {
            // select：选中占位项（官方模型下拉的占位 option value 为空字符串）
            el.val('').trigger('change');
        }
        return;
    }

    try { oai_settings[control.settingKey] = model; } catch { /* 忽略 */ }

    const el = $(control.selector);
    if (!el.length) return;

    if (!el.is('select')) {
        el.val(model).trigger('input');
        return;
    }

    const trySet = () => {
        const fresh = $(control.selector);
        if (!fresh.length) return;
        const hasOption = fresh.find('option').toArray().some(o => o.value === model);
        if (hasOption) fresh.val(model).trigger('change');
    };
    trySet();
    const handler = () => trySet();
    try {
        eventSource.once(event_types.ONLINE_STATUS_CHANGED, handler);
        setTimeout(() => {
            try { eventSource.removeListener(event_types.ONLINE_STATUS_CHANGED, handler); } catch { /* 忽略 */ }
        }, 30000);
    } catch (e) {
        console.warn(LOG, '默认模型延时同步注册失败', e);
    }
}
