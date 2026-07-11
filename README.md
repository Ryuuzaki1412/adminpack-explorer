# AdminPack Explorer

A Tauri 2.0 desktop app for browsing and inspecting **Logicalis NMS AdminPack** monitoring definitions — vendor-specific SNMP/API/Agent polling templates that define what metrics a device can report.

![Tauri](https://img.shields.io/badge/Tauri-2.0-orange?logo=tauri)
![Rust](https://img.shields.io/badge/Rust-1.77+-dea584?logo=rust)
![License](https://img.shields.io/badge/license-MIT-blue)

## Features

### Vendor browser
- Browse all 76 AdminPack vendors grouped by category (network, security, wireless, cloud, server, storage, database, agent, AI, other)
- Live search with CN/EN alias map (`华三` ↔ `H3C`, `防火墙` ↔ firewall vendors, etc.)
- 8-way concurrent prefetch — cache all 76 vendors' full data in ~30 s with a progress overlay

### Detail view
- **Header** — version + monitoring approach (SNMP / API / Agent / Trap) + total monitor count
- **Tab: 状态类型** — state-based monitoring (e.g. `apStatus`, `Fan Status`)
- **Tab: 图表类型** — statistics-based monitoring with associated statistics + chart names
- **Tab: 阈值类型** — threshold-based monitoring with L1 / L2 / L3 levels extracted from JSON
- **Tab: Trap 告警** — SNMP trap profiles
- **Tab: 原始 JSON** — full AdminPackDataJson for inspection
- Multi-approach packs (e.g. Aruba has both SNMP and API) shown side-by-side

### Global AI assistant
- Floating chat button (bottom-right) accessible from anywhere
- Smart matching across all 76 vendors — ask "我有 Cisco 2911 路由器能监控什么" without pre-selecting a vendor
- Cross-vendor answers using the MiniMax Coding Plan (Anthropic-compatible API at `api.minimaxi.com`)
- Markdown rendering for tables, code blocks, lists, headings
- Suggested question chips on first open

### Settings
- ⚙ settings panel for MiniMax token / base URL / model ID
- "测试连接" button verifies credentials before saving
- Persisted to disk via `tauri-plugin-store` (`adminpack-settings.json`)

## Tech stack

| Layer | Tech |
|---|---|
| Desktop shell | **Tauri 2.0** (Rust + WebView) |
| Backend | Rust + `reqwest` + `tokio` + `serde_json` |
| Frontend | Vanilla HTML/CSS/JS — no bundler, no framework |
| State | In-memory cache + tauri-plugin-store for persistence |
| AI | MiniMax Anthropic-compatible API |

## Quick start

### Prerequisites
- macOS / Windows / Linux
- Node.js ≥ 18
- Rust ≥ 1.77
- (Optional) GitHub CLI or SSH key for git push

### Install & run
```bash
# Install JS deps
npm install

# Run in dev mode (hot-reload)
npm run tauri dev

# Build release binary
npm run tauri build
```

The release binary is at:
- macOS: `src-tauri/target/release/bundle/macos/AdminPack Explorer.app`
- Windows: `src-tauri/target/release/bundle/msi/...`
- Linux: `src-tauri/target/release/bundle/deb/...`

## Configuration

The app uses a public demo API by default. To point at your own NMS:

```bash
cp .env.example .env
# edit .env, then restart
ADMINPACK_BASE_URL=https://your-nms.example.com
ADMINPACK_API_KEY=your-real-key
ADMINPACK_COOKIE=optional-cookie
```

Or set environment variables before launching the binary:

```bash
ADMINPACK_API_KEY=xxx ./AdminPack\ Explorer.app/Contents/MacOS/AdminPack\ Explorer
```

Settings (MiniMax API for AI chat) are configured in-app via ⚙ and saved to `adminpack-settings.json`.

## Project layout

```
adminpack-explorer/
├── .env.example             # Template for AdminPack API env vars
├── .gitignore
├── LICENSE                  # MIT
├── README.md
├── package.json             # Tauri CLI
├── src/                     # Frontend (no bundler, vanilla JS)
│   ├── index.html
│   ├── main.js
│   └── styles.css
└── src-tauri/               # Rust backend
    ├── Cargo.toml
    ├── tauri.conf.json
    ├── build.rs
    ├── capabilities/
    │   └── default.json
    ├── icons/               # PNG / ICO / ICNS
    └── src/
        ├── main.rs
        ├── lib.rs           # Tauri commands
        └── api.rs           # HTTP client + concurrent prefetcher + AI chat
```

## API endpoints used

| Tauri command | HTTP endpoint |
|---|---|
| `list_admin_packs` | `GET /Api/SystemAdmin/AdminPacks` |
| `get_pack_data` | `GET /Api/SystemAdmin/AdminPacks/{id}/AdminPackData` |
| `preload_all` | fan-out of `get_pack_data` (8-way concurrent) |
| `cmd_test_minimax` | `POST {base}/v1/messages` (Anthropic) |
| `cmd_ai_chat_global` | `POST {base}/v1/messages` (Anthropic) |

## Known limitations

- Statistics/chart association uses name matching (`StatisticsData.Name` ↔ `Chart.Name`). Some packs may show "no associated chart" if names diverge.
- Multi-approach detection uses heuristics on field name prefixes (`Snmp*` / `Api*` / `DeviceAgent*`). New approach types would need a code update.
- The WebView cannot directly access the public network without the configured base URL; offline mode is not supported.
- Tauri 2 webview limits clipboard paste of large payloads (>5 MB) — large pack data should be opened via the in-app "下载 JSON" button.

## License

[MIT](./LICENSE)
