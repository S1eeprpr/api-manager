import { eventSource, event_types } from '/scripts/events.js';
import { oai_settings } from '/scripts/openai.js';
import { getSecretKeyName, isCustomLikeSource, getSourceLabel, getModelControl } from './sources.js';
import { activateKey } from './secrets-bridge.js';

const LOG = '[API预设管家]';

/**
 * 应用预设：换 API 地址 + 投放 Key + 同步默认模型 + 触发连接。
 * 严格不动 main_api / 来源，避免触发正则、破甲预设等其他模块的刷新副作用。
 * 模型控件只设值（change/input 仅更新模型选择，不触发来源级联刷新，无副作用）。
 * 若预设来源与当前不同，Key 投放槽不一致会失败 → 提示用户手动切换来源。
 */
export async function applyPreset(preset, { connect = true } = {}) {
    // 1. 来源一致性提示（不自动切换，避免副作用）
    const currentSource = String($('#chat_completion_source').val() ?? '');
    if (currentSource !== preset.source) {
        toastr.warning(
            `该预设来源「${getSourceLabel(preset.source)}」与当前「${getSourceLabel(currentSource)}」不同，已更新地址但 Key 投放可能失败，请先手动切换来源再切换预设`,
            'API 预设管家',
        );
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
            toastr.warning('Key 投放失败，请检查官方密钥库或切换到原生界面排查', 'API 预设管家');
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
        toastr.warning('该来源没有可用的密钥槽', 'API 预设管家');
        return false;
    }
    preset.activeKeyId = key.id;
    return await activateKey(preset, key, secretKeyName);
}

/**
 * 默认模型：先写 oai_settings 持久化；DOM 控件能设则设，
 * select 选项未加载时等 ONLINE_STATUS_CHANGED 后再同步一次。
 * 模型控件 change/input 只更新模型选择，不触发来源级联刷新（无正则/破甲副作用）。
 * 预设无默认模型时不主动清空（避免连接失败），保持当前模型不动。
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
