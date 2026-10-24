import { getSettings, saveSettings, newId } from '../core/store.js';
import { getSourceLabel, isCustomLikeSource } from '../core/sources.js';
import { openApmDialog } from './dialogs.js';
import { copyToClipboard } from './clipboard.js';

const TOAST_TITLE = '多API管理';
const LOG = '[多API管理]';
const EXPORT_FORMAT = 'apim-presets';
const EXPORT_VERSION = 1;

function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

/* ================= 导出 ================= */

/** 序列化预设：只保留可移植字段（不含 id/secretId 等本地运行时信息） */
function serializePreset(p) {
    return {
        name: String(p.name ?? ''),
        source: String(p.source ?? 'custom'),
        apiUrl: String(p.apiUrl ?? ''),
        defaultModel: String(p.defaultModel ?? ''),
        keys: (p.keys ?? []).map(k => ({
            name: String(k.name ?? ''),
            value: String(k.value ?? ''),
        })),
    };
}

/** Blob + <a download> 保存为 JSON 文件（浏览器 / Tauri WebView 均可用） */
function downloadJson(payload) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `apim-presets-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** 导出弹窗：上半区选导出方式（剪贴板/文件），下半区勾选预设；返回 true 表示已执行导出 */
export async function openExportDialog() {
    const presets = getSettings().presets;
    if (!presets.length) {
        toastr.info('还没有可导出的预设', TOAST_TITLE);
        return null;
    }

    let target = 'clipboard'; // 'clipboard' | 'file'

    const itemsHtml = presets.map(p => `
        <label class="apm-io-item">
            <input type="checkbox" class="apm-io-chk" data-id="${esc(p.id)}" checked>
            <span class="apm-io-name">${esc(p.name)}</span>
            <span class="apm-io-sub">${esc(isCustomLikeSource(p.source) ? (p.apiUrl || '未填地址') : getSourceLabel(p.source))} · ${p.keys.length} 个 Key</span>
        </label>`).join('');

    const ok = await openApmDialog({
        title: '导出配置预设',
        bodyHtml: `
        <div class="apm-io">
            <div class="apm-io-sec">
                <div class="apm-io-sec-title">导出到</div>
                <div class="apm-io-targets">
                    <div class="menu_button apm-io-target apm-active" data-target="clipboard" title="把 JSON 复制到剪贴板">复制到剪贴板</div>
                    <div class="menu_button apm-io-target" data-target="file" title="保存为 .json 文件">保存为文件</div>
                </div>
            </div>
            <div class="apm-io-sec">
                <div class="apm-io-sec-title"><span>选择要导出的预设</span>
                    <label class="apm-io-all"><input type="checkbox" id="apm_io_all" checked>全选</label>
                </div>
                <div id="apm_io_list" class="apm-io-list">${itemsHtml}</div>
            </div>
            <div class="apm-note">导出内容包含 Key 明文，复制/保存后请注意保管。</div>
        </div>`,
        okText: `导出 (${presets.length})`,
        cancelText: '取消',
        onOpen: (overlay) => {
            const $dlg = $(overlay);
            const updateOkBtn = () => {
                const n = $dlg.find('.apm-io-chk:checked').length;
                const okBtn = overlay.querySelector('.apm-dlg-ok');
                if (okBtn) {
                    okBtn.textContent = `导出 (${n})`;
                    okBtn.classList.toggle('apm-disabled', n === 0);
                }
            };
            $dlg.on('click', '.apm-io-target', function () {
                $dlg.find('.apm-io-target').removeClass('apm-active');
                $(this).addClass('apm-active');
                target = String($(this).attr('data-target') ?? 'clipboard');
            });
            $dlg.on('change', '.apm-io-chk', () => {
                const all = $dlg.find('.apm-io-chk');
                const on = all.filter(':checked').length;
                $dlg.find('#apm_io_all').prop('checked', on === all.length && on > 0);
                updateOkBtn();
            });
            $dlg.on('change', '#apm_io_all', function () {
                $dlg.find('.apm-io-chk').prop('checked', this.checked);
                updateOkBtn();
            });
        },
        onBeforeOk: async (overlay) => {
            const ids = new Set(
                $(overlay).find('.apm-io-chk:checked').map(function () { return this.dataset.id; }).get(),
            );
            if (!ids.size) {
                toastr.error('请至少勾选一个预设', TOAST_TITLE);
                return false;
            }
            const payload = {
                format: EXPORT_FORMAT,
                version: EXPORT_VERSION,
                exportedAt: new Date().toISOString(),
                presets: getSettings().presets.filter(p => ids.has(p.id)).map(serializePreset),
            };
            try {
                if (target === 'file') {
                    downloadJson(payload);
                    toastr.success(`已导出 ${payload.presets.length} 个预设到文件`, TOAST_TITLE);
                } else {
                    await copyToClipboard(JSON.stringify(payload, null, 2));
                    toastr.success(`已复制 ${payload.presets.length} 个预设的 JSON 到剪贴板`, TOAST_TITLE);
                }
            } catch (e) {
                console.error(LOG, '导出失败', e);
                toastr.error(`导出失败：${e?.message ?? e}`, TOAST_TITLE);
                return false;
            }
            return true;
        },
    });
    return ok === true;
}

/* ================= 导入 ================= */

/** 解析并清洗单个导入预设：分配全新 id/secretId=null，字段类型兜底 */
function sanitizeImportedPreset(raw, index) {
    if (!raw || typeof raw !== 'object') throw new Error(`第 ${index + 1} 个预设不是有效对象`);
    const keys = (Array.isArray(raw.keys) ? raw.keys : [])
        .filter(k => k && typeof k.value === 'string' && k.value.trim())
        .map(k => ({
            id: newId('k'),
            secretId: null,
            name: String(k.name ?? '').trim(),
            value: k.value.trim(),
        }));
    return {
        id: newId('p'),
        name: (typeof raw.name === 'string' && raw.name.trim()) || '未命名预设',
        source: (typeof raw.source === 'string' && raw.source.trim()) || 'custom',
        apiUrl: typeof raw.apiUrl === 'string' ? raw.apiUrl.trim() : '',
        defaultModel: typeof raw.defaultModel === 'string' ? raw.defaultModel.trim() : '',
        keys,
        activeKeyId: keys[0]?.id ?? null,
    };
}

/** 解析导入文本：接受 {format:apim-presets,presets:[]} 或裸预设数组；失败抛错 */
function parseImportPayload(text) {
    let obj = null;
    try { obj = JSON.parse(text); } catch { throw new Error('JSON 解析失败，请检查内容是否完整'); }
    const list = Array.isArray(obj) ? obj : (obj && Array.isArray(obj.presets) ? obj.presets : null);
    if (!list) throw new Error('未找到预设列表（应为 apim-presets 格式的 JSON，或预设对象数组）');
    if (!list.length) throw new Error('预设列表为空');
    return list.map(sanitizeImportedPreset);
}

/** 入库：不覆盖现有预设，同名自动追加「(导入)」后缀；返回改名数量 */
function importIntoSettings(incoming) {
    const s = getSettings();
    let renamed = 0;
    for (const p of incoming) {
        const base = p.name;
        if (s.presets.some(x => x.name === p.name)) {
            let n = 1;
            let candidate = `${base} (导入)`;
            while (s.presets.some(x => x.name === candidate)) {
                n += 1;
                candidate = `${base} (导入${n})`;
            }
            p.name = candidate;
            renamed += 1;
        }
        s.presets.push(p);
    }
    saveSettings();
    return renamed;
}

/** 导入弹窗：上半区选 JSON 文件，下半区粘贴文本，二选一；返回 { added, renamed } 或 null */
export async function openImportDialog() {
    let fileText = null;
    let result = null;

    const ok = await openApmDialog({
        title: '导入配置预设',
        bodyHtml: `
        <div class="apm-io">
            <div class="apm-io-sec">
                <div class="apm-io-sec-title">从文件导入</div>
                <div class="apm-io-filerow">
                    <div id="apm_io_pick" class="menu_button" title="选择本地的 apm-presets JSON 文件">选择 JSON 文件</div>
                    <span id="apm_io_fileinfo" style="display:none;"></span>
                    <span id="apm_io_clear" class="fa-solid fa-circle-xmark apm-io-clear" style="display:none;" title="清除已选文件"></span>
                </div>
            </div>
            <div class="apm-io-sec">
                <div class="apm-io-sec-title">从文本导入</div>
                <textarea id="apm_io_text" class="text_pole apm-io-text" placeholder="粘贴导出的 JSON 内容…" spellcheck="false"></textarea>
            </div>
            <div class="apm-note">文件与文本二选一；导入不会覆盖现有预设，同名预设自动加「(导入)」后缀；导入后不自动切换当前预设。</div>
        </div>`,
        okText: '导入',
        cancelText: '取消',
        onOpen: (overlay) => {
            const $dlg = $(overlay);
            // 隐藏的原生 file input（挂在 overlay 上，随弹窗销毁）
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json,application/json';
            input.style.display = 'none';
            overlay.appendChild(input);

            $dlg.on('click', '#apm_io_pick', () => input.click());
            input.addEventListener('change', async () => {
                const f = input.files?.[0];
                input.value = '';
                if (!f) return;
                try {
                    fileText = await f.text();
                    const n = parseImportPayload(fileText).length; // 顺带校验
                    $dlg.find('#apm_io_fileinfo')
                        .text(`已读取 ${n} 个预设（${f.name}）`)
                        .css('color', '')
                        .show();
                    $dlg.find('#apm_io_clear').show();
                } catch (e) {
                    fileText = null;
                    console.warn(LOG, '文件解析失败', e);
                    $dlg.find('#apm_io_fileinfo')
                        .text(`读取失败：${e.message}`)
                        .css('color', 'var(--SmartThemeEmColor, #e06060)')
                        .show();
                    $dlg.find('#apm_io_clear').hide();
                }
            });
            $dlg.on('click', '#apm_io_clear', () => {
                fileText = null;
                $dlg.find('#apm_io_fileinfo').hide().text('');
                $dlg.find('#apm_io_clear').hide();
            });
        },
        onBeforeOk: async (overlay) => {
            const textVal = String($(overlay).find('#apm_io_text').val() ?? '').trim();
            if (fileText && textVal) {
                toastr.error('文件与文本都有内容，请先清除其一', TOAST_TITLE);
                return false;
            }
            const text = fileText ?? textVal;
            if (!text) {
                toastr.error('请选择 JSON 文件或粘贴 JSON 文本', TOAST_TITLE);
                return false;
            }
            let incoming;
            try {
                incoming = parseImportPayload(text);
            } catch (e) {
                toastr.error(e.message, TOAST_TITLE);
                return false;
            }
            const renamed = importIntoSettings(incoming);
            result = { added: incoming.length, renamed };
            toastr.success(`已导入 ${incoming.length} 个预设${renamed ? `，其中 ${renamed} 个因重名加了后缀` : ''}`, TOAST_TITLE);
            return true;
        },
    });
    return ok === true ? result : null;
}
