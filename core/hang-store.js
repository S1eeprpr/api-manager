import { extension_settings } from '/scripts/extensions.js';
import { saveSettingsDebounced } from '/script.js';

/** 独立存储键：与 API 预设数据完全隔离，互不影响 */
export const HANG_KEY = 'hang_browser';

/** 窗口尺寸档位（必须带 width/height 才会被宿主当作应用内窗口） */
export const SIZE_MODES = {
    mini: { label: '迷你 320×220', w: 320, h: 220 },
    normal: { label: '标准 1000×760', w: 1000, h: 760 },
    large: { label: '大 1440×900', w: 1440, h: 900 },
};

function defaults() {
    return {
        version: 1,
        sites: [],
        launcherVisible: true,
        launcherSide: 'right',
    };
}

export function getHangSettings() {
    if (!extension_settings[HANG_KEY] || typeof extension_settings[HANG_KEY] !== 'object') {
        extension_settings[HANG_KEY] = defaults();
    }
    const s = extension_settings[HANG_KEY];
    if (!Array.isArray(s.sites)) s.sites = [];
    if (typeof s.launcherVisible !== 'boolean') s.launcherVisible = true;
    for (const site of s.sites) {
        if (typeof site.id !== 'string' || !site.id) site.id = newId();
        if (typeof site.name !== 'string') site.name = '';
        if (typeof site.url !== 'string') site.url = '';
        if (!SIZE_MODES[site.size]) site.size = 'normal';
    }
    return s;
}

export function saveHangSettings() {
    saveSettingsDebounced();
}

export function newId() {
    const rnd = globalThis.crypto?.randomUUID?.()
        ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    return `site_${rnd}`;
}

export function upsertSite(site) {
    const s = getHangSettings();
    const idx = s.sites.findIndex(x => x.id === site.id);
    if (idx >= 0) s.sites[idx] = site;
    else s.sites.push(site);
    saveHangSettings();
}

export function removeSite(id) {
    const s = getHangSettings();
    s.sites = s.sites.filter(x => x.id !== id);
    saveHangSettings();
}

export function setSiteSize(id, size) {
    const s = getHangSettings();
    const site = s.sites.find(x => x.id === id);
    if (!site) return;
    site.size = SIZE_MODES[size] ? size : 'normal';
    saveHangSettings();
}

export function setLauncherVisible(visible) {
    const s = getHangSettings();
    s.launcherVisible = Boolean(visible);
    saveHangSettings();
}

/** 补全协议：用户常漏写 https:// */
export function normalizeUrl(raw) {
    const v = String(raw ?? '').trim();
    if (!v) return '';
    if (/^https?:\/\//i.test(v)) return v;
    return `https://${v}`;
}
