import { SECRET_KEYS } from '/scripts/secrets.js';
import { getChatCompletionModelControl } from '/scripts/openai.js';

export const CUSTOM_SOURCE = 'custom';

/**
 * custom 变体（custom_openai_responses / custom_claude_messages / custom_gemini_*）
 * 在宿主内部都会被归一化为 source='custom' + custom_api_format，
 * 密钥槽与模型控件也一律走 custom。
 */
export function isCustomLikeSource(source) {
    const s = String(source ?? '');
    return s === CUSTOM_SOURCE || s.startsWith('custom_');
}

export function normalizeSource(source) {
    return isCustomLikeSource(source) ? CUSTOM_SOURCE : String(source ?? '');
}

/** 运行时从官方来源下拉读取可选值（跟随上游新增来源） */
export function getSourceOptions() {
    const out = [];
    document.querySelectorAll('#chat_completion_source option').forEach(op => {
        if (op.value) out.push({ value: op.value, label: op.textContent.trim() });
    });
    return out;
}

export function getSourceLabel(source) {
    const op = document.querySelector(`#chat_completion_source option[value="${CSS.escape(String(source))}"]`);
    return op ? op.textContent.trim() : String(source);
}

/** 来源 → 官方密钥槽（api_key_<source>；custom 系 → api_key_custom） */
export function getSecretKeyName(source) {
    const normalized = normalizeSource(source);
    const candidate = `api_key_${normalized}`;
    if (Object.values(SECRET_KEYS).includes(candidate)) return candidate;
    const enumKey = normalized.toUpperCase();
    if (SECRET_KEYS[enumKey]) return SECRET_KEYS[enumKey];
    return null;
}

/** 来源 → 官方模型控件 { selector, settingKey, supportsCustomModels } */
export function getModelControl(source) {
    try {
        return getChatCompletionModelControl(normalizeSource(source));
    } catch {
        return null;
    }
}
