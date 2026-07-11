# AdminPack Explorer

> 一个基于 Tauri 2.0 的桌面应用，用于浏览、查询 Logicalis NMS 中各厂商的 **AdminPack 监控定义**（SNMP / API / Agent 三种采集方式的厂商级监控模板）。

![Tauri](https://img.shields.io/badge/Tauri-2.0-orange?logo=tauri)
![Rust](https://img.shields.io/badge/Rust-1.77+-dea584?logo=rust)
![License](https://img.shields.io/badge/license-MIT-blue)
![GitHub release](https://img.shields.io/github/v/release/Ryuuzaki1412/adminpack-explorer)

## ✨ 功能

### 📋 厂商浏览器
- **76 个 AdminPack 厂商**，按类别分组（网络设备 / 安全 / 无线 / 云 / 服务器 / 存储 / 数据库 / 系统 Agent / AI / 其他）
- **实时搜索 + 中英文别名映射**：`华三 ↔ H3C` / `防火墙 ↔ Fortigate` / `无线 ↔ 无线 AP` 等
- **一键缓存全部 76 个厂商**（8 路并发预拉取，带进度条 overlay，约 30 秒完成）

### 🔍 详情视图
- **Header**：版本 + 监控方式（SNMP / API / Agent 单选或多选）+ 监控项总数
- **状态类型 Tab**：基于状态轮询的监控（如 `apStatus` / `Fan Status`）
- **图表类型 Tab**：基于统计的监控 + 关联的统计点（StatisticsData）和图表（Chart）名称
- **阈值类型 Tab**：基于阈值的监控，自动从 JSON 解析 L1 / L2 / L3 级别
- **Trap 告警 Tab**：SNMP Trap 模板
- **原始 JSON Tab**：完整 AdminPackDataJson
- **多 Approach 支持**：同时具有 SNMP + API 的厂商（如 Aruba），会同时显示两个 pill

### 🤖 全局 AI 助手（多 Provider）
- 右下角浮动按钮，**全局可访问**，无需先选厂商
- **智能匹配**：输入 "我有一台 Cisco 2911 路由器" 自动定位到相关厂商的监控项
- **跨厂商问答**：输入 "Linux 服务器怎么监控" 会推荐 Server + Linux Agent + Windows Agent
- **8 个 Provider 可选**（设置面板）：
  - 🌋 火山方舟 Ark (豆包 Coding) — Anthropic 兼容
  - 🤖 Anthropic Claude
  - 🧠 OpenAI (GPT-4o, GPT-4 Vision)
  - 🔍 DeepSeek
  - 🇨🇳 通义千问 (Qwen / DashScope)
  - 🏠 Ollama (本地)
  - 💻 LM Studio (本地)
  - ⚙️ 自定义 (OpenAI 兼容)
- **图片附件**支持：📎 按钮 / 拖拽上传，对话中可附带截图给多模态模型
- **Markdown 渲染**：表格、代码块、列表、标题、加粗
- **快捷问题 chip**

### ⚙️ 设置
- **NMS 端点**（AdminPack 数据源）：Base URL + API Key + Cookie
- **AI 助手**：Provider + Base URL + API Key + Model ID + Timeout
- "测试连接" 按钮先验证后保存
- 通过 `tauri-plugin-store` 持久化到本地（`adminpack-settings.json`）
- 跨重启保留

## 🔐 安全设计

- **二进制零硬编码凭证**：NMS API Key、AI Token 全部从设置面板读取，没有任何 demo fallback 烧死在源码里
- **不依赖环境变量**：用户配一次设置就够，不需要配 shell env 或 .env
- **可独立分发给客户**：开发者构建 → 自己配 NMS 客户 key + AI key → 分发给客户使用

## 📦 下载

最新 release 在 [GitHub Releases](https://github.com/Ryuuzaki1412/adminpack-explorer/releases)。

| 平台 | 文件 |
|---|---|
| **macOS (Apple Silicon)** | `AdminPack-Explorer-v2-AppleSilicon.dmg` |
| macOS (直接运行 .app) | `AdminPack-Explorer-v2-AppleSilicon.app.zip` |

> Windows / Linux 二进制需要各自平台构建（仓库提供完整源码）。

## 🚀 快速开始

### 1. 下载安装

macOS 用户直接双击 `.dmg`，把 `AdminPack Explorer.app` 拖进 Applications。

### 2. 首次配置

打开 app → 点右上角 ⚙：

- **NMS 端点**（必填）
  - Base URL：`https://your-nms.example.com`
  - API Key：你的 NMS 凭证
  - Cookie：（可选，部分 NMS 需要）
- **AI 助手**（必填）
  - Provider：选你要用的（豆包 Coding / Claude / GPT-4o / DeepSeek / Ollama / 自定义）
  - 选 provider 后会自动填 Base URL 和 Model ID，可改
  - 填 API Key
  - 点 **测试连接**，看到 ✅ 后保存

### 3. 缓存全部厂商

点右上角 🔄，会弹出进度条 overlay，约 30 秒拉完所有 76 个厂商的完整数据。

### 4. 开始用

- **左侧列表**：浏览 / 搜索厂商
- **右侧详情**：查看该厂商的所有监控项，按 SNMP / API / 状态 / 图表 / 阈值 / Trap 分类
- **右下角 💬**：问 AI 助手（支持图片附件）

## 🛠️ 从源码构建

### 前置条件
- macOS / Windows / Linux
- Node.js ≥ 18
- Rust ≥ 1.77
- (Windows / Linux 平台) 各自的 Tauri 系统依赖

### 开发模式
```bash
git clone https://github.com/Ryuuzaki1412/adminpack-explorer.git
cd adminpack-explorer
npm install
npm run tauri dev
```

### 构建发布版
```bash
npm run tauri build
```

构建产物在 `src-tauri/target/release/bundle/` 下。

## ⚙️ 配置

AdminPack Explorer 的所有配置都在 app 内 ⚙ 设置面板，**不需要碰代码或环境变量**。

设置保存在：
- **macOS**: `~/Library/Application Support/com.logicalis.adminpack-explorer/adminpack-settings.json`
- **Windows**: `%APPDATA%\com.logicalis.adminpack-explorer\adminpack-settings.json`
- **Linux**: `~/.config/com.logicalis.adminpack-explorer/adminpack-settings.json`

## 🏗️ 技术栈

| 层 | 技术 |
|---|---|
| 桌面壳 | Tauri 2.0 (Rust + WebView) |
| 后端 | Rust + reqwest + tokio + serde + serde_json |
| 前端 | 原生 HTML/CSS/JS（无打包器、无框架）|
| 状态存储 | tauri-plugin-store (本地 JSON) |
| AI 协议 | Anthropic Messages API + OpenAI Chat Completions API（按 provider 切换） |
| 配置注入 | 完全从设置读取，无硬编码 fallback |

## 📂 项目结构

```
adminpack-explorer/
├── .env.example             # 模板（dev 用）
├── .gitignore
├── LICENSE                  # MIT
├── README.md                # 本文件
├── RELEASE_NOTES.md         # 各版本详细更新日志
├── package.json
├── src/                     # 前端（无 bundler）
│   ├── index.html
│   ├── main.js              # 业务逻辑 + 多 Provider 路由 + 图片附件
│   └── styles.css
└── src-tauri/               # Rust 后端
    ├── Cargo.toml
    ├── tauri.conf.json
    ├── build.rs
    ├── capabilities/
    ├── icons/
    └── src/
        ├── main.rs
        ├── lib.rs           # Tauri commands
        └── api.rs           # HTTP 客户端 + AI provider dispatch
```

## 🔌 后端 Tauri 命令

| Command | 用途 |
|---|---|
| `list_admin_packs(nms)` | 拉取厂商列表（需 NMS config） |
| `get_pack_data(pack_id, nms)` | 拉单个厂商的完整定义 |
| `preload_all(nms)` | 并发预拉所有 76 个厂商 |
| `cache_stats()` | 当前缓存数 |
| `clear_cache()` | 清空缓存 |
| `cmd_test_ai(provider, base_url, api_key, model_id)` | 测试 AI 连接 |
| `cmd_ai_chat_global(...)` | 全局 AI 对话（支持多模态图片） |

## 🚧 已知限制

- 当前只构建了 macOS Apple Silicon 二进制。Windows / Linux 需要各自平台执行 `npm run tauri build`
- 监控方式（0/1/2）的精确语义由 NMS 后端定义，本地按 `SnmpActionPollingSystem` 等字段名匹配。某些特殊包可能没有该字段，会归类为 "empty"
- 统计点 / 图表关联使用名称匹配（`StatisticsData.Name` ↔ `Chart.Name`）。名称不一致的会显示"无关联图表"

## ❓ 常见问题

### macOS 下载后提示"已损坏，无法打开"

这是 **macOS Gatekeeper** 的正常防护机制——不是真的损坏。原因是：
- DMG 通过浏览器下载时，macOS 自动添加 `com.apple.quarantine` 扩展属性
- App 没有 Apple Developer ID 正式签名（未公证）

**解决方法**（任选其一，最快 5 秒）：

#### 方案 A：右键打开（最常用）
1. 双击 DMG 挂载，弹出"已损坏"对话框
2. 点 **"取消"**（不要移到废纸篓）
3. 在 Finder 里找到 `AdminPack Explorer.app`
4. **右键 → 打开**
5. 弹出的确认框点 **"打开"**
6. ✅ 以后双击就正常了

#### 方案 B：终端一行命令
```bash
xattr -d com.apple.quarantine /Applications/AdminPack\ Explorer.app
```
下载 dmg 后用这个命令清除 quarantine 属性，然后正常打开。

#### 方案 C：系统设置里允许
1. 双击 dmg → 弹"已损坏"对话框 → **取消**
2. 打开 **系统设置 → 隐私与安全**
3. 往下滚到底部，会看到"AdminPack Explorer 被阻止"
4. 点 **"仍要打开"** → 输密码 → 打开

> **关于代码签名**：当前 release 是 **ad-hoc 签名**（免费），没有 Apple Developer ID 正式签名。  
> 如果你想彻底消除这个警告，需要：
> 1. 注册 [Apple Developer Program](https://developer.apple.com/programs/)（$99/年）
> 2. 在 `tauri.conf.json` 的 `bundle.macOS.signingIdentity` 填你的 Team ID
> 3. 配置 `APPLE_ID` / `APPLE_PASSWORD`（App-specific password）环境变量
> 4. 在 `tauri build` 完成后会自动 `notarytool submit` 进行 Apple 公证
> 5. 公证后双击直接打开，无需任何用户操作
> 
> 适合：正式产品化、对外发布、大规模分发  
> 不适合：内部工具、demo、小规模试用

### 设置项不生效 / API 调用失败
检查 ⚙ 设置里：
- **NMS Base URL** 是否正确（注意末尾不要有 `/`，比如 `https://nms.example.com` 不是 `https://nms.example.com/`）
- **API Key** 是否有访问 AdminPack 端点的权限
- 点 **测试连接** 验证 AI 配置是否可达
- 端口或路径写错会得到 `404` 或 `401` 错误（看 toast 提示）

### Windows / Linux 怎么装
当前 release 只构建了 macOS Apple Silicon。要装其他平台：
- **Windows**: 在 Windows 上 clone 源码 + `npm install` + `npm run tauri build`
- **Linux**: 同上，需要装 webkit2gtk 等系统依赖（参考 [Tauri 文档](https://tauri.app/start/prerequisites/)）
- 也可以用 GitHub Actions 在 CI 里交叉构建（需要额外配置）

## 📝 更新日志

详见 [RELEASE_NOTES.md](./RELEASE_NOTES.md)。

## 📄 License

[MIT](./LICENSE) — Copyright (c) 2026 ryuuzaki1412
