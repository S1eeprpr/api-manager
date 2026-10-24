import { extension_settings } from '/scripts/extensions.js';
import { saveSettingsDebounced } from '/script.js';

export const EXT_KEY = 'api_preset_manager';

function defaults() {
    return {
        version: 2,
        mode: 'preset',          // 'preset' | 'native'
        activePresetId: null,
        presets: [],
        floatWindow: {           // 悬浮复制窗状态
            enabled: false,        // 主面板开关
            collapsed: true,       // 收起态(true=圆钮 false=展开卡片)
            hidden: false,         // 被隐藏键整个隐藏（需回主面板开关重开）
            x: null,               // 位置（null=默认右下角）
            y: null,
            selectedPresetId: null,// 悬浮窗选中的预设（null=跟随当前激活预设）
            selectedKeyId: null,   // 悬浮窗选中的 Key（null=跟随预设激活Key）
        },
    };
}

/** 兜底悬浮窗设置字段（老用户升级时补全） */
function ensureFloatWindow(s) {
    if (!s.floatWindow || typeof s.floatWindow !== 'object') s.floatWindow = {};
    const fw = s.floatWindow;
    if (typeof fw.enabled !== 'boolean') fw.enabled = false;
    if (typeof fw.collapsed !== 'boolean') fw.collapsed = true;
    if (typeof fw.hidden !== 'boolean') fw.hidden = false;
    if (fw.x != null && typeof fw.x !== 'number') fw.x = null;
    if (fw.y != null && typeof fw.y !== 'number') fw.y = null;
    if (fw.selectedPresetId != null && typeof fw.selectedPresetId !== 'string') fw.selectedPresetId = null;
    if (fw.selectedKeyId != null && typeof fw.selectedKeyId !== 'string') fw.selectedKeyId = null;
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
    ensureFloatWindow(s);
    // 悬浮窗选中项指向已删预设/Key 时清空
    if (s.floatWindow.selectedPresetId && !s.presets.some(p => p.id === s.floatWindow.selectedPresetId)) {
        s.floatWindow.selectedPresetId = null;
        s.floatWindow.selectedKeyId = null;
    } else if (s.floatWindow.selectedPresetId) {
        const p = s.presets.find(x => x.id === s.floatWindow.selectedPresetId);
        if (p && s.floatWindow.selectedKeyId && !p.keys.some(k => k.id === s.floatWindow.selectedKeyId)) {
            s.floatWindow.selectedKeyId = null;
        }
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
    if (s.floatWindow.selectedPresetId === id) {
        s.floatWindow.selectedPresetId = null;
        s.floatWindow.selectedKeyId = null;
    }
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
