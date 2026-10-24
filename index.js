import { eventSource, event_types } from '/scripts/events.js';
import { saveSettings } from '/script.js';
import { getSettings } from './core/store.js';
import { initPanel, applyMode, refreshPanel } from './ui/panel.js';

const LOG = '[多API管理]';
let initialized = false;

async function waitForHostDom() {
    try {
        await (window.__TAURITAVERN__?.ready ?? window.__TAURITAVERN_MAIN_READY__);
    } catch { /* 非 TauriTavern 环境或异常时继续 DOM 轮询 */ }
    for (let i = 0; i < 120; i++) {
        if (document.querySelector('#openai_api') && document.querySelector('#chat_completion_source')) {
            return true;
        }
        await new Promise(r => setTimeout(r, 250));
    }
    return false;
}

async function init() {
    if (initialized) return;
    initialized = true;
    try {
        const ok = await waitForHostDom();
        if (!ok) {
            console.warn(LOG, '未找到 API 连接面板，扩展未激活');
            initialized = false;
            return;
        }
        getSettings();
        initPanel();
        applyMode();
        try {
            if (event_types.CHATCOMPLETION_SOURCE_CHANGED) {
                eventSource.on(event_types.CHATCOMPLETION_SOURCE_CHANGED, () => refreshPanel());
            }
        } catch { /* 忽略 */ }
        console.log(LOG, '已加载（默认使用预设界面，可在面板顶部切回原生界面）');
    } catch (e) {
        initialized = false;
        console.error(LOG, '初始化失败', e);
    }
}

/**
 * 酒馆扩展更新完成后由宿主自动调用（manifest.json hooks.update 声明，
 * 官方机制：extensions.js 在 git 拉取完成后 callExtensionHook(name, 'update')）。
 * 回调跑在【旧版本】代码里：先把防抖中的设置落盘，再刷新页面加载新代码。
 * 注意：从装上含本 hook 的版本起，之后的每次更新才会自动刷新。
 */
export async function onExtensionUpdate() {
    console.log(LOG, '扩展已更新，正在自动刷新页面…');
    try {
        toastr.info('「多API管理」已更新，正在自动刷新页面…', '多API管理');
    } catch { /* 忽略 */ }
    try {
        await saveSettings(); // 立即落盘，防止防抖中的修改被刷新丢掉
    } catch (e) {
        console.warn(LOG, '更新后保存设置失败', e);
    }
    setTimeout(() => location.reload(), 600); // 小延时让 toast 可见、保存完成
}

try {
    eventSource.on(event_types.APP_READY, () => { init(); });
} catch { /* 忽略 */ }

// 兜底：扩展模块可能在 APP_READY 之后才被求值
setTimeout(() => { init(); }, 2000);
