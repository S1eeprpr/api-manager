import { extension_settings } from '/scripts/extensions.js';
import { saveSettingsDebounced } from '/script.js';

export const EXT_KEY = 'api_preset_manager';

function defaults() {
    return {
        version: 2,
        mode: 'preset',          // 'preset' | 'native'
        activePresetId: null,
        presets: [],
    };
}

export function getSettings() {
    if (!extension_settings[EXT_KEY] || typeof extension_settings[EXT_KEY] !== 'object') {
        extension_settings[EXT_KEY] = defaults();
    }
    const s = extension_settings[EXT_KEY];
    if (s.mode !== 'native' && s.mode !== 'preset') s.mode = 'preset';
    if (!Array.isArray(s.presets)) s.presets = [];
    for (const p of s.presets) {
        if (!Array.isArray(p.keys)) p.keys = [];
        if (typeof p.name !== 'string') p.name = '未命名预设';
        if (typeof p.source !== 'string') p.source = 'custom';
        if (typeof p.apiUrl !== 'string') p.apiUrl = '';
        if (typeof p.defaultModel !== 'string') p.defaultModel = '';
    }
    if (s.activePresetId && !s.presets.some(p => p.id === s.activePresetId)) {
        s.activePresetId = null;
    }
    return s;
}

export function saveSettings() {
    saveSettingsDebounced();
}

export function newId(prefix) {
    const rnd = globalThis.crypto?.randomUUID?.()
        ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    return `${prefix}_${rnd}`;
}

export function getPreset(id) {
    return getSettings().presets.find(p => p.id === id) ?? null;
}

export function getActivePreset() {
    const s = getSettings();
    return s.presets.find(p => p.id === s.activePresetId) ?? null;
}

export function upsertPreset(preset) {
    const s = getSettings();
    const idx = s.presets.findIndex(p => p.id === preset.id);
    if (idx >= 0) s.presets[idx] = preset;
    else s.presets.push(preset);
    saveSettings();
}

export function removePreset(id) {
    const s = getSettings();
    s.presets = s.presets.filter(p => p.id !== id);
    if (s.activePresetId === id) s.activePresetId = null;
    saveSettings();
}

export function setMode(mode) {
    const s = getSettings();
    s.mode = mode === 'native' ? 'native' : 'preset';
    saveSettings();
}

/** 脱敏：末 4 位可见，其余星号（不足 8 位全星号） */
export function maskSecret(value) {
    const v = String(value ?? '');
    if (!v) return '';
    if (v.length <= 8) return '*'.repeat(Math.max(v.length, 4));
    return '********' + v.slice(-4);
}
