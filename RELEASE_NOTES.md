# AdminPack Explorer 更新日志

## v0.2.0 — 2026-07-11

### 🔐 安全
- **完全移除硬编码 NMS 凭证**（之前 demo API key / URL / cookie 烧死在源码里）
- NMS 端点、API Key、Cookie 全部从设置面板读取
- 默认值为空，未配置时给出明确错误（不静默失败）
- **二进制零敏感信息** — 适合发给客户/公司内部使用
- 之前 v0.1.0 release 的二进制在 `strings` 后可见 demo key + URL，本次重传已彻底清干净

### ✨ 新功能
- **多 AI Provider 支持**（设置面板下拉切换）：
  - 火山方舟 Ark (豆包 Coding) - Anthropic 兼容
  - Anthropic Claude
  - OpenAI (GPT-4o 等)
  - DeepSeek
  - 通义千问 (Qwen / DashScope)
  - Ollama (本地)
  - LM Studio (本地)
  - 自定义 (OpenAI 兼容)
- **图片附件**：对话中可上传图片
  - 📎 按钮 / 拖拽上传
  - 多模态消息同时发给模型
  - 自动按 Provider 用对应格式（Anthropic image block / OpenAI image_url）
- **Provider 切换自动填充** Base URL 和 Model ID
- **NMS 设置分离**：NMS 配置（数据源）和 AI 配置（聊天模型）独立管理

### 🔧 内部改动
- Rust 后端重写：所有 NMS 调用从 `tauri.conf.json` env 改为 invoke 参数
- 新增 `NmsConfig` struct（base_url / api_key / cookie）
- 新增 `ChatImage` struct（base64 data + media_type）
- AI 命令拆分为 Anthropic 兼容和 OpenAI 兼容两条路径
- `ChatMessage.content` 改为 `enum { Text(String), Parts(Vec<ContentPart>) }` 支持多模态
- 设置项 `nms.*` 和 `ai.*` 在 `tauri-plugin-store` 中分两个 namespace 存储

### 🐛 修复
- AI 对话时 Base URL 修改能立即生效（之前是缓存的）
- 错误提示更明确（区分配置缺失 / 网络错误 / API 错误 / 鉴权错误）
- 切换 provider 时自动填默认值，避免手动输入错误

### 📦 部署变化
- **客户使用流程**（变更）：
  1. 开发者构建：源码 clone → `npm install` → `npm run tauri build`
  2. 启动 app，在 ⚙ 设置里输入 NMS 客户的 API key
  3. 把配好的 .app / .dmg 分发给客户
  4. 客户首次启动按需配置 AI（每个客户用自己的 AI 配额）
- 不再依赖 .env 文件 / 环境变量

### ⚠️ 破坏性变更
- v0.1.0 demo URL/key 不再内置；旧用户首次升级会看到 "NMS 未配置" 错误，需要在 ⚙ 设置里填入

---

## v0.1.0 — 2026-07-11 (initial)

### ✨ 核心功能
- 76 个 AdminPack 厂商浏览（按类别分组：网络设备 / 安全 / 无线 / 云 / 服务器 / 存储 / 数据库 / Agent / AI / 其他）
- 实时搜索 + 中英文别名映射
- 一键缓存全部 76 个厂商（8 路并发预拉取，带进度条 overlay）
- 4 类监控项视图：状态 / 图表 / 阈值 / Trap
- 多 approach 监控方式（SNMP / API / Agent）
- 全局 AI 助手（豆包 Coding / Anthropic 兼容 API）
- 设置面板（API token 持久化）
- 原始 JSON 导出

### 🛠 技术栈
- Tauri 2.0 (Rust + WebView)
- Vanilla HTML/CSS/JS 前端（无打包器）
- 跨平台：源码 + 单一 macOS Apple Silicon 二进制

### 🐛 已知问题
- Demo API key 硬编码在源码 → v0.2.0 修复
- 单一 AI provider → v0.2.0 修复
- 不支持图片附件 → v0.2.0 修复
