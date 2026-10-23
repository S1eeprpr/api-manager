# 多API管理（api-manager）

TauriTavern / SillyTavern 第三方前端扩展：以**自绘改版界面**接管官方 API 连接面板，多套 API 预设一键切换，每个预设绑定一个 API 地址 + 一至多个可命名 Key + 默认模型。原生/改版界面自由切换（默认改版），通过应用内 Git 安装/更新，不 fork 不重编译。

## 核心特性

- **视觉替换、逻辑复用**：改版界面只是"皮"，连接逻辑 100% 走官方原生控件（`#main_api` / `#chat_completion_source` / `#custom_api_url_text` / 官方密钥库）。模型加载、流式输出、报错提示全部原生，出问题一键切回原生界面排查。
- **预设 = 来源 + API 地址 + 多个可命名 Key + 默认模型**：新建/编辑弹窗统一管理，取代原生"选预设 + 改后保存"的流程。
- **Key 命名可选**：Key 行默认只有 Key 值输入框 + 一个圆圈加号按钮；不点加号则 Key 名称留空不显示，点了才展开命名输入框。
- **拉取模型**：弹窗内点「拉取模型」会用表单里的地址和 Key 连接一次 API，拉到的模型列表填到下拉框，点击选取即可（直接用表单 Key，不复用旧预设的 Key）。
- **切换预设只换地址 + Key + 默认模型**：严格不碰来源 / 正则 / 破甲预设等其他模块（避免触发其刷新副作用）。来源不同时会提示手动切换。
- **三个快捷按钮**：跳转站点（去掉 `/v1` 后打开站点首页）、复制 API 地址、复制当前选中的 Key 到剪贴板。
- **自绘弹窗**：新建/编辑/删除确认全部用自绘模态框，不依赖官方 Popup 类，规避宿主发布版与仓库代码不一致导致的崩溃。
- **原生/改版一键切换**：切换按钮位于"发送测试消息"按钮右侧，改版模式显示「原生界面」，原生模式显示「预设界面」。
- **挂机窗口（内置浏览器）**：界面右侧边缘的地球图标，管理常用挂机站点，一键在**应用内独立浏览器窗口**打开（不是系统浏览器，也不受站点禁止 iframe 限制）。

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

## 挂机窗口（内置浏览器）

界面上 **右侧边缘的竖条地球图标** → 点开站点面板 → 填网址 → 点「打开」，站点在**应用内独立浏览器窗口**里加载，可挂着不占用聊天视野。

**原理**：TauriTavern 主窗口安装了 `on_new_window` 处理器（`src-tauri/.../app/host/window.rs`）——`window.open` 的窗口特征里**带 width/height 时在应用内创建 webview 窗口**；不带尺寸则交给系统浏览器。扩展利用前者唤出应用内浏览器，因此任意站点都能加载（不受 `X-Frame-Options` / CSP `frame-ancestors` 限制）。

**三档尺寸**：迷你 320×220 / 标准 1000×760 / 大 1440×900。需要"不挡视野还要稳定挂机"时选迷你，把它拖到屏幕角落。

**关于"隐藏"**：站点窗口是真实的系统窗口，显示/隐藏由窗口按钮控制——扩展侧无法用代码隐藏它（capability 只授权了 main 窗口，Rust 端也没有开放窗口控制命令）。**建议用迷你尺寸代替最小化**：最小化后 webview 变成不可见页面，Chromium 会对定时器降频（普通 `setInterval` 降到约 1 秒精度，长时间后链式定时器进一步降频），靠页面 JS 心跳保活的站点可能掉线；保持窗口可见（哪怕很小）则不受此影响。

**限制**：
- 仅桌面端（macOS / Windows / Linux）；移动端无该处理器
- 窗口没有地址栏与前进后退，只能靠页面内导航
- 窗口不带 IPC 权限，扩展无法读取其 DOM / 自动点击（做不了自动签到类操作）
- cookie 与主窗口共用同一 WebView 数据目录，登录状态通常可保持

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
│   ├─ apply.js        预设应用（只换地址+Key+模型，不动来源）
│   └─ hang-store.js   挂机站点存储（独立键 hang_browser）
└─ ui/
    ├─ panel.js        主面板（预设下拉 + Key 下拉 + 三按钮）
    ├─ dialogs.js      自绘弹窗（新建/编辑/删除确认）
    └─ hang-panel.js   挂机窗口入口与站点面板
```

## 注意事项

- Key 以明文保存在 `settings.json` 中，请勿分享该文件。
- 切换预设时若来源与当前不同，会提示手动切换来源（避免自动切换触发正则等模块刷新）。
- 拉取模型时若来源与当前不同，会自动切换来源并等待初始化完成后再连接。
