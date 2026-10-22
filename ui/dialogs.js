import { Popup, POPUP_TYPE, POPUP_RESULT, callGenericPopup } from '/scripts/popup.js';
import { findSecret } from '/scripts/secrets.js';
import { getSettings, getPreset, upsertPreset, removePreset, newId } from '../core/store.js';
import { getSourceOptions, getSourceLabel, isCustomLikeSource, getSecretKeyName, getModelControl } from '../core/sources.js';
import { removeKeyFromVault, cleanupOrphanEntries } from '../core/secrets-bridge.js';

const TOAST_TITLE = 'API 预设管家';

function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

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

function wireCommon(dlg) {
    const $dlg = $(dlg);
    $dlg.on('change', '#apm_f_source', () => toggleUrlRow(dlg));
    $dlg.on('click', '#apm_f_addkey', () => {
        $dlg.find('#apm_f_keys').append(keyRowHtml({}));
    });
    $dlg.on('click', '.apm-key-del', function () {
        $(this).closest('.apm-key-row').remove();
        if (!$dlg.find('#apm_f_keys .apm-key-row').length) {
            $dlg.find('#apm_f_keys').append(keyRowHtml({}));
        }
    });
    $dlg.on('click', '#apm_f_capture', () => { captureCurrent(dlg); });
    $dlg.on('click', '#apm_f_cleanup', async () => {
        const n = await cleanupOrphanEntries(getSettings().presets);
        if (n) toastr.success(`已清理 ${n} 条残留密钥条目`, TOAST_TITLE);
        else toastr.info('没有需要清理的残留条目', TOAST_TITLE);
    });
}

/** 新建预设弹窗；保存成功返回预设对象，取消返回 null */
export async function openNewPresetDialog() {
    let collected = null;
    const popup = new Popup(buildFormHtml({ isEdit: false }), POPUP_TYPE.CONFIRM, '', {
        okButton: '保存并切换',
        cancelButton: '取消',
        wide: true,
        onClosing: (p) => {
            if (p.result !== POPUP_RESULT.AFFIRMATIVE) return true;
            const data = collectForm(p.dlg);
            const err = validate(data);
            if (err) { toastr.error(err, TOAST_TITLE); return false; }
            collected = data;
            return true;
        },
    });
    wireCommon(popup.dlg);
    fillForm(popup.dlg, null);

    const result = await popup.show();
    if (result !== POPUP_RESULT.AFFIRMATIVE || !collected) return null;

    const preset = {
        id: newId('p'),
        ...collected,
        activeKeyId: collected.keys[0]?.id ?? null,
    };
    upsertPreset(preset);
    return preset;
}

/** 编辑预设弹窗；有保存返回被保存的预设，无变更返回 null */
export async function openEditPresetDialog() {
    const s = getSettings();
    if (!s.presets.length) {
        toastr.info('还没有可编辑的预设', TOAST_TITLE);
        return null;
    }

    let currentId = s.activePresetId ?? s.presets[0].id;
    let collected = null;

    const popup = new Popup(buildFormHtml({ isEdit: true }), POPUP_TYPE.CONFIRM, '', {
        okButton: '保存',
        cancelButton: '关闭',
        wide: true,
        onClosing: (p) => {
            if (p.result !== POPUP_RESULT.AFFIRMATIVE) return true;
            const data = collectForm(p.dlg);
            const err = validate(data);
            if (err) { toastr.error(err, TOAST_TITLE); return false; }
            collected = data;
            return true;
        },
    });

    const $dlg = $(popup.dlg);
    const refreshPresetOptions = () => {
        const st = getSettings();
        $dlg.find('#apm_f_preset').html(
            st.presets.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join(''),
        );
    };

    wireCommon(popup.dlg);
    refreshPresetOptions();
    $dlg.find('#apm_f_preset').val(currentId);
    fillForm(popup.dlg, getPreset(currentId));

    $dlg.on('change', '#apm_f_preset', function () {
        currentId = String($(this).val());
        fillForm(popup.dlg, getPreset(currentId));
    });

    $dlg.on('click', '#apm_f_delete', async () => {
        const preset = getPreset(currentId);
        if (!preset) return;
        const confirm = await callGenericPopup(
            `确定删除预设「${esc(preset.name)}」吗？其投放到官方密钥库的副本也会一并删除。`,
            POPUP_TYPE.CONFIRM,
        );
        if (confirm !== POPUP_RESULT.AFFIRMATIVE) return;
        const secretKeyName = getSecretKeyName(preset.source);
        for (const k of preset.keys) {
            await removeKeyFromVault(secretKeyName, k);
        }
        removePreset(preset.id);
        toastr.success(`预设「${preset.name}」已删除`, TOAST_TITLE);
        const st = getSettings();
        if (!st.presets.length) {
            await popup.complete(POPUP_RESULT.NEGATIVE);
            return;
        }
        currentId = st.presets[0].id;
        refreshPresetOptions();
        $dlg.find('#apm_f_preset').val(currentId);
        fillForm(popup.dlg, getPreset(currentId));
    });

    const result = await popup.show();
    if (result !== POPUP_RESULT.AFFIRMATIVE || !collected) return null;

    const preset = getPreset(currentId);
    if (!preset) return null;

    const oldKeys = preset.keys;
    const secretKeyName = getSecretKeyName(collected.source);

    // 被删除的 Key → 删除密钥库副本
    for (const ok of oldKeys) {
        if (!collected.keys.some(k => k.id === ok.id)) {
            await removeKeyFromVault(secretKeyName, ok);
        }
    }
    // 值变化或新增的 Key → 作废旧 secretId，下次激活时重新投放
    for (const nk of collected.keys) {
        const ok = oldKeys.find(k => k.id === nk.id);
        if (!ok || ok.value !== nk.value) nk.secretId = null;
    }

    Object.assign(preset, collected);
    if (!preset.keys.some(k => k.id === preset.activeKeyId)) {
        preset.activeKeyId = preset.keys[0]?.id ?? null;
    }
    upsertPreset(preset);
    return preset;
}
