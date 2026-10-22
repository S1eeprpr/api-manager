import { getSecretKeyName, isCustomLikeSource, getSourceLabel } from './sources.js';
import { activateKey } from './secrets-bridge.js';

/**
 * 应用预设：只换 API 地址 + 投放 Key（自带重连）+ 触发连接。
 * 严格不动 main_api / 来源 / 模型，避免触发正则、破甲预设等其他模块的刷新副作用。
 * 若预设来源与当前不同，Key 投放槽不一致会失败 → 提示用户手动切换来源。
 */
export async function applyPreset(preset, { connect = true } = {}) {
    // 1. 校验来源一致性（不切换来源，只提示）
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

    // 4. 无 Key 可投（免密预设等）→ 手动触发官方 Connect
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
