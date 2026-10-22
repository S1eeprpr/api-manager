import { findSecret } from '/scripts/secrets.js';
import { getSettings, getPreset, upsertPreset, removePreset, newId } from '../core/store.js';
import { getSourceOptions, getSourceLabel, isCustomLikeSource, getSecretKeyName, getModelControl } from '../core/sources.js';
import { removeKeyFromVault, cleanupOrphanEntries } from '../core/secrets-bridge.js';

const TOAST_TITLE = 'API 预设管家';
const LOG = '[API预设管家]';

function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

/* ================= 自绘弹窗基础（不依赖官方 Popup 类，规避宿主版本差异） ================= */

/**
 * 打开一个自绘模态弹窗。
 * @param {object} opts
 * @param {string} opts.title 标题
 * @param {string} opts.bodyHtml 正文 HTML
 * @param {string} [opts.okText] 确定按钮文案
 * @param {string} [opts.cancelText] 取消按钮文案
 * @param {(overlay: HTMLElement) => (boolean|Promise<boolean>)} [opts.onBeforeOk]
 *        点确定时回调；返回 false 则不关闭（用于表单校验）
 * @returns {Promise<boolean|null>} true=确定；null=取消/关闭
 */
function openApmDialog({ title, bodyHtml, okText = '确定', cancelText = '取消', onBeforeOk = null }) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'apm-dlg-overlay';
        overlay.innerHTML = `
            <div class="apm-dlg">
                <div class="apm-dlg-header">
                    <span class="apm-dlg-title"></span>
                    <span class="apm-dlg-close fa-solid fa-circle-xmark" title="关闭"></span>
                </div>
                <div class="apm-dlg-body"></div>
                <div class="apm-dlg-controls">
                    <div class="menu_button apm-dlg-cancel"></div>
                    <div class="menu_button menu_button_default apm-dlg-ok"></div>
                </div>
            </div>`;
        overlay.querySelector('.apm-dlg-title').textContent = title;
        overlay.querySelector('.apm-dlg-cancel').textContent = cancelText;
        overlay.querySelector('.apm-dlg-ok').textContent = okText;
        overlay.querySelector('.apm-dlg-body').innerHTML = bodyHtml;
        document.body.appendChild(overlay);
        console.log(LOG, '弹窗已创建：' + title);

        let closed = false;
        const close = (result) => {
            if (closed) return;
            closed = true;
            document.removeEventListener('keydown', keyHandler);
            overlay.remove();
            resolve(result);
        };
        const keyHandler = (e) => {
            if (e.key === 'Escape') { e.stopPropagation(); close(null); }
        };

        overlay.querySelector('.apm-dlg-close').addEventListener('click', () => close(null));
        overlay.querySelector('.apm-dlg-cancel').addEventListener('click', () => close(null));
        overlay.querySelector('.apm-dlg-ok').addEventListener('click', async () => {
            try {
                if (onBeforeOk) {
                    const ok = await onBeforeOk(overlay);
                    if (!ok) return; // 校验失败，弹窗保持打开
                }
                close(true);
            } catch (e) {
                console.error(LOG, '确定按钮处理失败', e);
                toastr.error(`操作失败：${e?.message ?? e}`, TOAST_TITLE);
            }
        });
        overlay.addEventListener('mousedown', (e) => {
            if (e.target === overlay) close(null);
        });
        document.addEventListener('keydown', keyHandler);
    });
}

/** 自绘确认框；返回 Promise<boolean> */
function apmConfirm(messageHtml) {
    return openApmDialog({
        title: '确认操作',
        bodyHtml: `<div class="apm-confirm-text">${messageHtml}</div>`,
        okText: '确定',
        cancelText: '取消',
    }).then(r => r === true);
}

/* ================= 表单 ================= */

function keyRowHtml(key = {}) {
    return `
    <div class="apm-key-row" data-key-id="${esc(key.id ?? '')}" data-secret-id="${esc(key.secretId ?? '')}">
        <input class="text_pole apm-key-name" type="text" placeholder="Key 名称" value="${esc(key.name ?? '')}">
        <input class="text_pole apm-key-value" type="text" placeholder="sk-..." value="${esc(key.value ?? '')}" autocomplete="off">
        <span class="apm-key-del fa-solid fa-trash" title="删除此 Key"></span>
    </div>`;
}

function buildFormHtml({ isEdit }) {
    const sourceOptions = getSourceOptions()
        .map(o => `<option value="${esc(o.value)}">${esc(o.label)}</option>`)
        .join('');
    return `
    <div class="apm-form">
        ${isEdit ? `
        <div class="apm-form-row">
            <label>选择预设</label>
            <select id="apm_f_preset" class="text_pole"></select>
        </div>` : ''}
        <div class="apm-form-row">
            <label>预设名称</label>
            <input id="apm_f_name" class="text_pole" type="text" placeholder="例如：DeepSeek 官方">
        </div>
        <div class="apm-form-row">
            <label>聊天补全来源</label>
            <select id="apm_f_source" class="text_pole">${sourceOptions}</select>
        </div>
        <div class="apm-form-row" id="apm_f_url_row">
            <label>API 地址</label>
            <input id="apm_f_url" class="text_pole" type="text" placeholder="https://api.example.com/v1" autocomplete="off">
        </div>
        <div class="apm-form-row">
            <label>默认模型（可空）</label>
            <input id="apm_f_model" class="text_pole" type="text" placeholder="例如：gpt-4o" autocomplete="off">
        </div>
        <div class="apm-form-row apm-keys-head">
            <label>API Keys</label>
            <span id="apm_f_addkey" class="apm-link">+ 添加 Key</span>
        </div>
        <div id="apm_f_keys"></div>
        <div class="apm-form-foot">
            <span id="apm_f_capture" class="apm-link" title="读取当前来源/地址/模型/Key 填入表单">填入当前连接</span>
            ${isEdit ? '<span id="apm_f_delete" class="apm-link apm-danger">删除此预设</span>' : ''}
            <span id="apm_f_cleanup" class="apm-link" title="删除官方密钥库中不再被任何预设使用的 APIM 条目">清理密钥库残留</span>
        </div>
        <div class="apm-note">Key 会以明文保存在扩展设置（settings.json）中用于切换与脱敏展示，请勿分享该文件。</div>
    </div>`;
}

function toggleUrlRow(dlg) {
    const source = String($(dlg).find('#apm_f_source').val() ?? 'custom');
    $(dlg).find('#apm_f_url_row').toggle(isCustomLikeSource(source));
}

function fillForm(dlg, preset) {
    const $dlg = $(dlg);
    $dlg.find('#apm_f_name').val(preset?.name ?? '');
    $dlg.find('#apm_f_source').val(preset?.source ?? 'custom');
    $dlg.find('#apm_f_url').val(preset?.apiUrl ?? '');
    $dlg.find('#apm_f_model').val(preset?.defaultModel ?? '');
    const keys = preset?.keys?.length ? preset.keys : [{}];
    $dlg.find('#apm_f_keys').html(keys.map(keyRowHtml).join(''));
    toggleUrlRow(dlg);
}

function collectForm(dlg) {
    const $dlg = $(dlg);
    const keys = [];
    $dlg.find('#apm_f_keys .apm-key-row').each(function () {
        const name = String($(this).find('.apm-key-name').val() ?? '').trim();
        const value = String($(this).find('.apm-key-value').val() ?? '').trim();
        if (!name && !value) return; // 跳过完全空的行
        keys.push({
            id: $(this).attr('data-key-id') || newId('k'),
            secretId: $(this).attr('data-secret-id') || null,
            name: name || `Key ${keys.length + 1}`,
            value,
        });
    });
    return {
        name: String($dlg.find('#apm_f_name').val() ?? '').trim(),
        source: String($dlg.find('#apm_f_source').val() ?? 'custom'),
        apiUrl: String($dlg.find('#apm_f_url').val() ?? '').trim(),
        defaultModel: String($dlg.find('#apm_f_model').val() ?? '').trim(),
        keys,
    };
}

function validate(data) {
    if (!data.name) return '请填写预设名称';
    if (isCustomLikeSource(data.source)) {
        if (!data.apiUrl) return '该来源需要填写 API 地址';
        if (!/^https?:\/\//i.test(data.apiUrl)) return 'API 地址须以 http:// 或 https:// 开头';
    }
    const noValue = data.keys.find(k => !k.value);
    if (noValue) return `Key「${noValue.name}」未填写 Key 值`;
    return null;
}

async function captureCurrent(dlg) {
    const $dlg = $(dlg);
    const source = String($('#chat_completion_source').val() ?? 'custom');
    $dlg.find('#apm_f_source').val(source);
    toggleUrlRow(dlg);
    if (isCustomLikeSource(source)) {
        $dlg.find('#apm_f_url').val(String($('#custom_api_url_text').val() ?? ''));
    }
    const control = getModelControl(source);
    if (control) {
        const cur = $(control.selector).val();
        if (cur) $dlg.find('#apm_f_model').val(String(cur));
    }
    const keyName = getSecretKeyName(source);
    if (keyName) {
        try {
            const value = await findSecret(keyName);
            if (value) {
                const emptyRow = $dlg.find('#apm_f_keys .apm-key-row').filter(function () {
                    return !String($(this).find('.apm-key-value').val() ?? '').trim();
                }).first();
                if (emptyRow.length) {
                    emptyRow.find('.apm-key-value').val(value);
                    if (!String(emptyRow.find('.apm-key-name').val() ?? '').trim()) {
                        emptyRow.find('.apm-key-name').val('当前 Key');
                    }
                } else {
                    $dlg.find('#apm_f_keys').append(keyRowHtml({ name: '当前 Key', value }));
                }
            } else {
                toastr.info('未能读取当前 Key（需在系统设置开启"允许查看密钥"），请手动粘贴一次', TOAST_TITLE);
            }
        } catch { /* 忽略 */ }
    }
    if (!String($dlg.find('#apm_f_name').val() ?? '').trim()) {
        $dlg.find('#apm_f_name').val(getSourceLabel(source));
    }
}

function wireCommon(overlay) {
    const $dlg = $(overlay);
    $dlg.on('change', '#apm_f_source', () => toggleUrlRow(overlay));
    $dlg.on('click', '#apm_f_addkey', () => {
        $dlg.find('#apm_f_keys').append(keyRowHtml({}));
    });
    $dlg.on('click', '.apm-key-del', function () {
        $(this).closest('.apm-key-row').remove();
        if (!$dlg.find('#apm_f_keys .apm-key-row').length) {
            $dlg.find('#apm_f_keys').append(keyRowHtml({}));
        }
    });
    $dlg.on('click', '#apm_f_capture', () => { captureCurrent(overlay); });
    $dlg.on('click', '#apm_f_cleanup', async () => {
        const n = await cleanupOrphanEntries(getSettings().presets);
        if (n) toastr.success(`已清理 ${n} 条残留密钥条目`, TOAST_TITLE);
        else toastr.info('没有需要清理的残留条目', TOAST_TITLE);
    });
}

/** 新建预设弹窗；保存成功返回预设对象，取消返回 null */
export async function openNewPresetDialog() {
    console.log(LOG, 'openNewPresetDialog 被调用');
    let collected = null;
    const ok = await openApmDialog({
        title: '新建配置预设',
        bodyHtml: buildFormHtml({ isEdit: false }),
        okText: '保存并切换',
        cancelText: '取消',
        onBeforeOk: (overlay) => {
            const data = collectForm(overlay);
            const err = validate(data);
            if (err) { toastr.error(err, TOAST_TITLE); return false; }
            collected = data;
            return true;
        },
    });
    if (!ok || !collected) return null;

    const preset = {
        id: newId('p'),
        ...collected,
        activeKeyId: collected.keys[0]?.id ?? null,
    };
    upsertPreset(preset);
    return preset;
}

/** 编辑预设弹窗；有保存返回被保存的预设，无变更/直接关闭返回 null */
export async function openEditPresetDialog() {
    const s = getSettings();
    if (!s.presets.length) {
        toastr.info('还没有可编辑的预设', TOAST_TITLE);
        return null;
    }
    console.log(LOG, 'openEditPresetDialog 被调用');

    let currentId = s.activePresetId ?? s.presets[0].id;

    const overlay = document.createElement('div');
    overlay.className = 'apm-dlg-overlay';
    overlay.innerHTML = `
        <div class="apm-dlg">
            <div class="apm-dlg-header">
                <span class="apm-dlg-title">编辑配置预设</span>
                <span class="apm-dlg-close fa-solid fa-circle-xmark" title="关闭"></span>
            </div>
            <div class="apm-dlg-body">${buildFormHtml({ isEdit: true })}</div>
            <div class="apm-dlg-controls">
                <div class="menu_button apm-dlg-cancel">关闭</div>
                <div class="menu_button menu_button_default apm-dlg-ok">保存</div>
            </div>
        </div>`;
    document.body.appendChild(overlay);

    const $dlg = $(overlay);
    const refreshPresetOptions = () => {
        const st = getSettings();
        $dlg.find('#apm_f_preset').html(
            st.presets.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join(''),
        );
    };

    wireCommon(overlay);
    refreshPresetOptions();
    $dlg.find('#apm_f_preset').val(currentId);
    fillForm(overlay, getPreset(currentId));

    $dlg.on('change', '#apm_f_preset', function () {
        currentId = String($(this).val());
        fillForm(overlay, getPreset(currentId));
    });

    $dlg.on('click', '#apm_f_delete', async () => {
        const preset = getPreset(currentId);
        if (!preset) return;
        const confirmed = await apmConfirm(
            `确定删除预设「${esc(preset.name)}」吗？其投放到官方密钥库的副本也会一并删除。`,
        );
        if (!confirmed) return;
        const secretKeyName = getSecretKeyName(preset.source);
        for (const k of preset.keys) {
            await removeKeyFromVault(secretKeyName, k);
        }
        removePreset(preset.id);
        toastr.success(`预设「${preset.name}」已删除`, TOAST_TITLE);
        const st = getSettings();
        if (!st.presets.length) {
            closeWith(null);
            return;
        }
        currentId = st.presets[0].id;
        refreshPresetOptions();
        $dlg.find('#apm_f_preset').val(currentId);
        fillForm(overlay, getPreset(currentId));
    });

    return await new Promise((resolve) => {
        let closed = false;
        const closeWith = (result) => {
            if (closed) return;
            closed = true;
            document.removeEventListener('keydown', keyHandler);
            overlay.remove();
            resolve(result);
        };
        const keyHandler = (e) => {
            if (e.key === 'Escape') { e.stopPropagation(); closeWith(null); }
        };

        overlay.querySelector('.apm-dlg-close').addEventListener('click', () => closeWith(null));
        overlay.querySelector('.apm-dlg-cancel').addEventListener('click', () => closeWith(null));
        overlay.querySelector('.apm-dlg-ok').addEventListener('click', async () => {
            try {
                const data = collectForm(overlay);
                const err = validate(data);
                if (err) { toastr.error(err, TOAST_TITLE); return; }

                const preset = getPreset(currentId);
                if (!preset) { closeWith(null); return; }

                const oldKeys = preset.keys;
                const secretKeyName = getSecretKeyName(data.source);

                // 被删除的 Key → 删除密钥库副本
                for (const ok of oldKeys) {
                    if (!data.keys.some(k => k.id === ok.id)) {
                        await removeKeyFromVault(secretKeyName, ok);
                    }
                }
                // 值变化或新增的 Key → 作废旧 secretId，下次激活时重新投放
                for (const nk of data.keys) {
                    const ok = oldKeys.find(k => k.id === nk.id);
                    if (!ok || ok.value !== nk.value) nk.secretId = null;
                }

                Object.assign(preset, data);
                if (!preset.keys.some(k => k.id === preset.activeKeyId)) {
                    preset.activeKeyId = preset.keys[0]?.id ?? null;
                }
                upsertPreset(preset);
                closeWith(preset);
            } catch (e) {
                console.error(LOG, '保存预设失败', e);
                toastr.error(`保存失败：${e?.message ?? e}`, TOAST_TITLE);
            }
        });
        overlay.addEventListener('mousedown', (e) => {
            if (e.target === overlay) closeWith(null);
        });
        document.addEventListener('keydown', keyHandler);
    });
}
