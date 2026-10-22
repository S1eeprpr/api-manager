# API 预设管家（api-preset-manager）

TauriTavern / SillyTavern 第三方前端扩展：把官方 API 连接面板改造成**预设驱动**的连接管理界面。

## 功能

- **配置预设**：一个预设 = 聊天补全来源 + API 地址 + 一至多个可命名的 Key + 默认模型（可空）
- **一键切换预设**：来源、地址、Key、默认模型全链路自动应用并自动连接
- **预设内秒换 Key**：Key 下拉（左名称、右脱敏 `********w4a`），点行即切换并自动重连；只显示当前预设的 Key
- **改版 / 原生界面自由切换**：面板顶部按钮随时切回原生界面排查问题；安装后默认使用改版界面
- **原生控件保留**：聊天补全来源、可用模型、提示词后处理保持原生，官方逻辑零改动
- **捕获当前连接**：新建弹窗内一键把当前连接（来源/地址/模型/Key）填入表单
- **密钥库维护**：Key 以 `APIM · 预设名 / Key名` 标签投放到官方密钥库，复用轮换不堆积；支持清理残留条目

## 安装

### 方式一：应用内 Git 安装（推荐，可一键更新）

1. 把本目录推送到一个 Git 仓库（GitHub / Gitee 均可）
2. TauriTavern → 扩展（拼图图标）→ Install extension → 粘贴仓库地址
3. 之后在扩展列表点 Update 即可更新

### 方式二：手动放置

把整个 `api-preset-manager` 文件夹复制到：

- 全局：`TauriTavern数据目录/extensions/third-party/api-preset-manager/`
- 或单用户：`TauriTavern数据目录/default-user/extensions/api-preset-manager/`

然后重启应用或在扩展列表刷新。

## 使用

1. 打开左栏 **API 连接**（插头图标），进入 **Chat Completion** 面板
2. 默认显示预设界面：点 **新建** → 弹窗中填名称、来源、API 地址、默认模型（可空）、Key 列表 → **保存并切换**
3. 之后切换预设 = 选下拉；换 Key = 点 Key 下拉里的行
4. 点 **原生界面** 可随时切回官方面板；原生面板顶部有 **使用预设界面** 按钮切回

## 安全提示

- Key 以**明文**保存在扩展设置（`settings.json`）中，用于切换与脱敏展示——**请勿分享该文件**
- 官方密钥库中的副本以 `APIM · ` 前缀标签标识，可在官方「View hidden API keys」弹窗中查看，也可用编辑弹窗里的「清理密钥库残留」移除孤儿条目

## 兼容性

- 面向 **TauriTavern**（SillyTavern 1.18+ 前端镜像）开发；官方 SillyTavern 新版理论上兼容（同源 ES 模块 + 相同 DOM 锚点），未实测
- 仅覆盖 **Chat Completion**（`main_api = openai`）；Text Completion 不在支持范围
