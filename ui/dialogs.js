import { getSettings, getPreset, upsertPreset, removePreset, newId } from '../core/store.js';
import { getSourceOptions, getSourceLabel, isCustomLikeSource, normalizeSource, getSecretKeyName } from '../core/sources.js';
import { removeKeyFromVault, activateKey } from '../core/secrets-bridge.js';
import { writeSecret, rotateSecret, deleteSecret } from '/scripts/secrets.js';
import { eventSource, event_types } from '/scripts/events.js';

const TOAST_TITLE = 'API 预设管家';
const LOG = '[API预设管家]';
const delay = (ms) => new Promise(r => setTimeout(r, ms));
const TEMP_KEY_LABEL = 'APIM · 临时拉取';

function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

/* ================= 自绘弹窗基础（不依赖官方 Popup 类，规避宿主版本差异） ================= */

/**
 * 打开一个自绘模态弹窗。
 * @returns {Promise<boolean|null>} true=确定；null=取消/关闭
 */
function openApmDialog({ title, bodyHtml, okText = '确定', cancelText = '取消', onOpen = null, onBeforeOk = null }) {
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
        if (onOpen) {
            try { onOpen(overlay); } catch (e) { console.error(LOG, '弹窗初始化失败', e); }
        }

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
                    if (!ok) return;
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

/**
 * Key 行：默认只有 Key 值输入框 + 一个圆圈加号按钮（命名开关）。
 * 点击加号 → 展开 Key 名称输入框（apm-naming class）。
 * 已有名称的 Key 编辑时初始即为命名态。
 */
function keyRowHtml(key = {}) {
    const hasName = Boolean(key.name);
    return `
    <div class="apm-key-row${hasName ? ' apm-naming' : ''}" data-key-id="${esc(key.id ?? '')}" data-secret-id="${esc(key.secretId ?? '')}">
        <span class="apm-key-naming-toggle fa-solid fa-circle-plus" title="${hasName ? '收起命名' : '为这个 Key 命名'}"></span>
        <input class="text_pole apm-key-name" type="text" placeholder="Key 名称（可选）" value="${esc(key.name ?? '')}">
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
        <div class="apm-form-row apm-keys-head">
            <label>API Keys</label>
            <span id="apm_f_addkey" class="apm-link">+ 添加 Key</span>
        </div>
        <div id="apm_f_keys"></div>
        <div class="apm-form-row">
            <label>默认模型（可选）</label>
            <div class="apm-model-row">
                <select id="apm_f_model" class="text_pole"><option value="">（拉取后选择）</option></select>
                <div id="apm_f_fetch_models" class="menu_button" title="用当前表单的地址和 Key 连接一次 API，拉取可用模型列表">拉取模型</div>
            </div>
        </div>
        ${isEdit ? '<div class="apm-form-foot"><span id="apm_f_delete" class="apm-link apm-danger">删除此预设</span></div>' : ''}
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
    // 默认模型 select：若值不在选项里，补一个临时 option 再选中
    const $model = $dlg.find('#apm_f_model');
    const dm = String(preset?.defaultModel ?? '').trim();
    if (dm && !$model.find(`option[value="${esc(dm)}"]`).length) {
        $model.append(`<option value="${esc(dm)}">${esc(dm)}</option>`);
    }
    $model.val(dm);
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
            name, // 允许为空（未命名 Key）
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
    if (noValue) return `Key「${noValue.name || '未命名'}」未填写 Key 值`;
    return null;
}

/* ================= 拉取模型 ================= */

/** 读官方"可用模型"控件的选项列表 */
function readOfficialModelOptions(source) {
    const normalized = normalizeSource(source);
    const selector = normalized === 'custom' ? '#model_custom_select' : `#model_${normalized}_select`;
    const out = [];
    $(selector).find('option').each(function () {
        const v = String(this.value ?? '').trim();
        if (v) out.push(v);
    });
    return [...new Set(out)];
}

/**
 * 用表单当前的 地址+Key 拉取模型列表。
 * 关键：直接 writeSecret 表单 Key（临时 label，不复用任何已有 secretId），
 *       保证用的是表单里的 Key 值，而不是当前激活预设的旧 Key。
 * 拉取完自动删除临时密钥条目，不污染密钥库。
 */
async function fetchModelsIntoForm(overlay) {
    const data = collectForm(overlay);
    if (isCustomLikeSource(data.source)) {
        if (!/^https?:\/\//i.test(data.apiUrl)) {
            toastr.error('请先填写有效的 API 地址（http(s):// 开头）', TOAST_TITLE);
            return;
        }
    }
    const formKey = data.keys.find(k => k.value);
    if (!formKey) {
        toastr.error('请先填写至少一个 Key', TOAST_TITLE);
        return;
    }

    const secretKeyName = getSecretKeyName(data.source);
    if (!secretKeyName) {
        toastr.error('该来源没有可用的密钥槽，无法拉取', TOAST_TITLE);
        return;
    }

    const $btn = $(overlay).find('#apm_f_fetch_models');
    const originalText = $btn.text();
    $btn.text('拉取中…').addClass('apm-disabled');
    let tempSecretId = null;

    try {
        // 来源不同 → 必须切换（否则 secretKeyName 不对，Key 投放到错误槽）
        const currentSource = String($('#chat_completion_source').val() ?? '');
        if (currentSource !== data.source) {
            toastr.info(`拉取需要切换来源到「${getSourceLabel(data.source)}」`, TOAST_TITLE);
            $('#chat_completion_source').val(data.source).trigger('change');
            await delay(700);
        }
        // 写 API 地址
        if (isCustomLikeSource(data.source) && data.apiUrl) {
            $('#custom_api_url_text').val(data.apiUrl).trigger('input');
            await delay(200);
        }

        // 用表单 Key 投放临时密钥（强制新写入，不复用旧 secretId）
        toastr.info('正在用表单的地址和 Key 连接 API…', TOAST_TITLE);
        tempSecretId = await writeSecret(secretKeyName, formKey.value, TEMP_KEY_LABEL);
        if (!tempSecretId) {
            toastr.error('临时密钥写入失败', TOAST_TITLE);
            return;
        }
        let reconnected = false;
        try {
            reconnected = await rotateSecret(secretKeyName, tempSecretId);
        } catch (e) {
            console.warn(LOG, 'rotateSecret 异常，尝试手动触发连接', e);
        }
        if (!reconnected) {
            $('#api_button_openai').trigger('click');
        }

        // 等连接结果（ONLINE_STATUS_CHANGED，25s 超时兜底）
        await new Promise((resolve) => {
            let done = false;
            const finish = () => { if (!done) { done = true; resolve(); } };
            try { eventSource.once(event_types.ONLINE_STATUS_CHANGED, finish); } catch { /* 忽略 */ }
            setTimeout(finish, 25000);
        });
        await delay(400);

        // 读官方模型列表
        const models = readOfficialModelOptions(data.source);
        if (!models.length) {
            toastr.warning('未获取到模型列表：请检查地址/Key 是否正确', TOAST_TITLE);
            return;
        }
        // 填充 select
        const $sel = $(overlay).find('#apm_f_model');
        const currentVal = $sel.val();
        $sel.html('<option value="">（不指定）</option>' + models.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join(''));
        if (currentVal && models.includes(currentVal)) {
            $sel.val(currentVal);
        } else if (formKey && !currentVal) {
            // 若官方当前已选中某模型且表单 select 为空，自动带入
            const normalized = normalizeSource(data.source);
            const selSelector = normalized === 'custom' ? '#custom_model_id' : `#model_${normalized}_select`;
            const official = String($(selSelector).val() ?? '').trim();
            if (official && models.includes(official)) $sel.val(official);
        }
        toastr.success(`已拉取 ${models.length} 个模型，点击下拉选取`, TOAST_TITLE);
    } catch (e) {
        console.error(LOG, '拉取模型失败', e);
        toastr.error(`拉取模型失败：${e?.message ?? e}`, TOAST_TITLE);
    } finally {
        $btn.text(originalText).removeClass('apm-disabled');
        // 清理临时密钥（无论成功失败都清理，避免污染密钥库）
        if (tempSecretId) {
            try { await deleteSecret(secretKeyName, tempSecretId); } catch (e) { console.warn(LOG, '清理临时密钥失败', e); }
        }
    }
}

/* ================= 弹窗内公共事件 ================= */

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
    // 命名开关：点击圆圈加号 → 展开/收起 Key 名称输入框
    $dlg.on('click', '.apm-key-naming-toggle', function () {
        const $row = $(this).closest('.apm-key-row');
        $row.toggleClass('apm-naming');
        const isNaming = $row.hasClass('apm-naming');
        $(this).toggleClass('fa-circle-plus', !isNaming).toggleClass('fa-circle-minus', isNaming);
        $(this).attr('title', isNaming ? '收起命名（名称将清空）' : '为这个 Key 命名');
        if (!isNaming) {
            $row.find('.apm-key-name').val(''); // 收起时清空名称
        }
    });
    $dlg.on('click', '#apm_f_fetch_models', () => { fetchModelsIntoForm(overlay); });
}

/** 新建预设弹窗；保存成功返回预设对象，取消返回 null（不自动切换） */
export async function openNewPresetDialog() {
    console.log(LOG, 'openNewPresetDialog 被调用');
    let collected = null;
    const ok = await openApmDialog({
        title: '新建配置预设',
        bodyHtml: buildFormHtml({ isEdit: false }),
        okText: '保存',
        cancelText: '取消',
        onOpen: (overlay) => {
            wireCommon(overlay);
            fillForm(overlay, null);
        },
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
