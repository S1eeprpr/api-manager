import { secret_state, writeSecret, rotateSecret, deleteSecret } from '/scripts/secrets.js';

export const LABEL_PREFIX = 'APIM · ';
const LOG = '[多API管理]';

export function buildLabel(preset, key) {
    return `${LABEL_PREFIX}${preset.name} / ${key.name}`;
}

/**
 * 激活预设内某个 Key：优先复用已投放的密钥库条目（rotate 自带重连），
 * 否则按固定 label 约定写入新条目后再轮换。
 * @returns {Promise<boolean>} 是否成功（成功意味着官方已用新 Key 触发重连）
 */
export async function activateKey(preset, key, secretKeyName) {
    if (!secretKeyName || !key?.value) return false;
    try {
        const entries = Array.isArray(secret_state[secretKeyName]) ? secret_state[secretKeyName] : [];

        // 快速路径：记录的 secretId 仍存在
        if (key.secretId && entries.some(e => e.id === key.secretId)) {
            return await rotateSecret(secretKeyName, key.secretId);
        }
        // 按 label 复用已有条目
        const label = buildLabel(preset, key);
        const existing = entries.find(e => e.label === label);
        if (existing) {
            key.secretId = existing.id;
            return await rotateSecret(secretKeyName, existing.id);
        }
        // 新写入
        const id = await writeSecret(secretKeyName, key.value, label);
        if (!id) return false;
        key.secretId = id;
        return await rotateSecret(secretKeyName, id);
    } catch (e) {
        console.error(LOG, 'Key 投放失败', e);
        return false;
    }
}

/** Key 值已变化：写入新条目 → 轮换 → 删除旧条目 */
export async function reprojectKey(preset, key, secretKeyName) {
    const oldId = key.secretId;
    key.secretId = null;
    const ok = await activateKey(preset, key, secretKeyName);
    if (ok && oldId && oldId !== key.secretId) {
        try { await deleteSecret(secretKeyName, oldId); } catch { /* 忽略 */ }
    }
    return ok;
}

/** 从密钥库删除某个 Key 的投放副本 */
export async function removeKeyFromVault(secretKeyName, key) {
    if (!secretKeyName || !key?.secretId) return;
    try { await deleteSecret(secretKeyName, key.secretId); } catch { /* 忽略 */ }
    key.secretId = null;
}

/** 清理孤儿条目：label 以 APIM · 开头但已不被任何预设引用 */
export async function cleanupOrphanEntries(presets) {
    const aliveIds = new Set();
    for (const p of presets ?? []) {
        for (const k of p.keys ?? []) {
            if (k.secretId) aliveIds.add(k.secretId);
        }
    }
    let removed = 0;
    for (const [keyName, entries] of Object.entries(secret_state ?? {})) {
        if (!Array.isArray(entries)) continue;
        for (const e of entries) {
            if (typeof e.label === 'string' && e.label.startsWith(LABEL_PREFIX) && !aliveIds.has(e.id)) {
                try { await deleteSecret(keyName, e.id); removed++; } catch { /* 忽略 */ }
            }
        }
    }
    return removed;
}
