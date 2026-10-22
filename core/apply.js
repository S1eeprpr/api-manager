import { eventSource, event_types } from '/scripts/events.js';
import { oai_settings } from '/scripts/openai.js';
import { getSecretKeyName, getModelControl, isCustomLikeSource } from './sources.js';
import { activateKey } from './secrets-bridge.js';

const LOG = '[API预设管家]';
const delay = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * 应用预设：主 API → 来源 → 地址 → Key 投放（自带重连）→ 默认模型。
 * 全部通过驱动官方原生控件完成，不改任何官方内部状态机。
 */
export async function applyPreset(preset, { connect = true } = {}) {
    // 1. 主 API 切到 Chat Completion
    const mainApi = $('#main_api');
    if (mainApi.length && String(mainApi.val()) !== 'openai') {
        mainApi.val('openai').trigger('change');
        await delay(700);
    }

    // 2. 聊天补全来源
    const sourceEl = $('#chat_completion_source');
    if (!sourceEl.length) throw new Error('未找到聊天补全来源控件');
    if (String(sourceEl.val()) !== preset.source) {
        sourceEl.val(preset.source).trigger('change');
        await delay(700);
    }

    // 3. API 地址（仅 custom 系来源）
    if (isCustomLikeSource(preset.source) && preset.apiUrl) {
        const urlEl = $('#custom_api_url_text');
        if (urlEl.length) {
            urlEl.val(preset.apiUrl).trigger('input');
        }
    }

    // 4. Key 投放（rotateSecret 内部会触发重连）
    const secretKeyName = getSecretKeyName(preset.source);
    const key = preset.keys.find(k => k.id === preset.activeKeyId) ?? preset.keys[0] ?? null;
    let reconnected = false;
    if (key?.value && secretKeyName) {
        preset.activeKeyId = key.id;
        reconnected = await activateKey(preset, key, secretKeyName);
        if (!reconnected) {
            toastr.warning('Key 投放失败，请检查官方密钥库或切换到原生界面排查', 'API 预设管家');
        }
    }

    // 5. 默认模型
    applyDefaultModel(preset);

    // 6. 无 Key 可投（免密预设等）→ 手动触发官方 Connect
    if (connect && !reconnected) {
        $('#api_button_openai').trigger('click');
    }
}

/** 预设内秒换 Key：只投放 + 重连，不动来源/地址 */
export async function applyKey(preset, key) {
    const secretKeyName = getSecretKeyName(preset.source);
    if (!secretKeyName) {
        toastr.warning('该来源没有可用的密钥槽', 'API 预设管家');
        return false;
    }
    preset.activeKeyId = key.id;
    return await activateKey(preset, key, secretKeyName);
}

/**
 * 默认模型：先写 oai_settings 持久化；DOM 控件能设则设，
 * select 选项未加载时等 ONLINE_STATUS_CHANGED 后再同步一次。
 */
export function applyDefaultModel(preset) {
    const model = String(preset.defaultModel ?? '').trim();
    if (!model) return;
    const control = getModelControl(preset.source);
    if (!control) return;

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
