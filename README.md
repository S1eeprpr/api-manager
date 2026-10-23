# 多API管理（api-manager）

TauriTavern / SillyTavern 第三方前端扩展：以**自绘改版界面**接管官方 API 连接面板，多套 API 预设一键切换，每个预设绑定一个 API 地址 + 一至多个可命名 Key + 默认模型。原生/改版界面自由切换（默认改版），通过应用内 Git 安装/更新，不 fork 不重编译。

## 核心特性

- **视觉替换、逻辑复用**：改版界面只是"皮"，连接逻辑 100% 走官方原生控件（`#main_api` / `#chat_completion_source` / `#custom_api_url_text` / 官方密钥库）。模型加载、流式输出、报错提示全部原生，出问题一键切回原生界面排查。
- **预设 = 来源 + API 地址 + 多个可命名 Key + 默认模型**：新建/编辑弹窗统一管理，取代原生"选预设 + 改后保存"的流程。
- **Key 命名可选**：Key 行默认只有 Key 值输入框 + 一个圆圈加号按钮；不点加号则 Key 名称留空不显示，点了才展开命名输入框。
- **拉取模型**：弹窗内点「拉取模型」会用表单里的地址和 Key 连接一次 API，拉到的模型列表填到下拉框，点击选取即可（直接用表单 Key，不复用旧预设的 Key）。
- **切换预设只换地址 + Key + 默认模型**：严格不碰来源 / 正则 / 破甲预设等其他模块（避免触发其刷新副作用）。来源不同时会提示手动切换。
- **信息行布局**：API 地址、默认模型各占一行显示（默认模型留空则该行隐藏）；聊天补全来源不在主面板显示，只在新建/编辑弹窗内选择。
- **三个快捷图标**：跳转站点（API 地址行末尾，去掉 `/v1` 后打开站点首页）、复制 API（「API」字样右侧）、复制当前选中 Key（「Key」字样右侧）。
- **自绘弹窗**：新建/编辑/删除确认全部用自绘模态框，不依赖官方 Popup 类，规避宿主发布版与仓库代码不一致导致的崩溃。
- **原生/改版一键切换**：切换按钮位于"发送测试消息"按钮右侧，改版模式显示「原生界面」，原生模式显示「预设界面」。

## 安装

### 方式一：Git 安装（推荐，支持一键更新）

1. 打开 TauriTavern → 侧栏扩展（拼图图标）→ **Install extension**
2. 仓库地址粘贴：`https://github.com/S1eeprpr/api-manager`
3. 安装后即默认进入预设界面；以后仓库有更新，在扩展列表点 **Update** 一键升级

### 方式二：手动放置

将本目录复制到 TauriTavern 数据目录的 `data/extensions/third-party/api-manager/` 下，重启即可。

## 预设结构

```
预设
├─ name          预设名称（如「DeepSeek 官方」）
├─ source        聊天补全来源（custom / openai / claude / ...）
├─ apiUrl        API 地址（仅 custom 系来源需要）
├─ defaultModel  默认模型（可选，切换预设时自动同步到官方模型控件）
├─ keys[]        一至多个 Key
│   ├─ name      Key 名称（可选，未命名则留空不显示）
│   ├─ value     Key 明文（存扩展设置用于切换与脱敏展示）
│   └─ secretId  官方密钥库条目 id（运行时载体）
└─ activeKeyId   当前激活的 Key
```

## Key 双轨存储

- **事实源**：`extension_settings.api_preset_manager`（明文 + 结构）——用于切换、脱敏展示、Key 下拉。
- **运行时载体**：官方密钥库——切换时以固定 label `APIM · {预设名} / {Key名}` 投放，`rotateSecret` 激活并自动重连。同 label 条目复用（防堆积），值变化时作废旧 secretId 重新投放。
- 删除预设时会清理其投放到官方密钥库的副本。

## 兼容性

- TauriTavern v2.4.0+（已核对全部依赖 DOM id 与密钥库 API）
- 兼容上游 SillyTavern 1.18.0 前端

## 文件结构

```
api-manager/
├─ manifest.json       扩展清单
├─ index.js            入口：等宿主就绪 → 面板注入 → 默认改版模式
├─ style.css           主面板 + 自绘弹窗样式
├─ README.md
├─ core/
│   ├─ store.js        设置存储（extension_settings）
│   ├─ sources.js      来源/密钥槽/模型控件映射
│   ├─ secrets-bridge.js  密钥库投放（writeSecret/rotateSecret/deleteSecret）
│   └─ apply.js        预设应用（只换地址+Key+模型，不动来源）
└─ ui/
    ├─ panel.js        主面板（预设下拉 + API/模型信息行 + Key 下拉 + 快捷图标）
    └─ dialogs.js      自绘弹窗（新建/编辑/删除确认）
```

## 注意事项

- Key 以明文保存在 `settings.json` 中，请勿分享该文件。
- 切换预设时若来源与当前不同，会提示手动切换来源（避免自动切换触发正则等模块刷新）。
- 拉取模型时若来源与当前不同，会自动切换来源并等待初始化完成后再连接。
