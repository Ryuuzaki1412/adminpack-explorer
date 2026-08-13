mod api;

use api::{
    ai_chat_complete, ai_test_connection, fetch_admin_pack_data, fetch_admin_packs, AdminPack,
    ChatMessage, ChatMessageContent, ContentPart, ImageSourceAnthropic, ImageUrlOpenAI, NmsConfig,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{Emitter, State};

#[derive(Default)]
struct AppState {
    cache: Mutex<HashMap<i64, Value>>,
    packs: Mutex<Vec<AdminPack>>,
}

#[derive(Serialize, Clone)]
struct ProgressPayload {
    completed: usize,
    total: usize,
    current: String,
}

#[tauri::command]
async fn list_admin_packs(
    nms: NmsConfig,
    state: State<'_, AppState>,
) -> Result<Vec<AdminPack>, String> {
    let packs = fetch_admin_packs(&nms).await.map_err(|e| e.to_string())?;
    *state.packs.lock().unwrap() = packs.clone();
    Ok(packs)
}

#[tauri::command]
async fn get_pack_data(
    pack_id: i64,
    nms: NmsConfig,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    if let Some(v) = state.cache.lock().unwrap().get(&pack_id) {
        return Ok(v.clone());
    }
    let v = fetch_admin_pack_data(&nms, pack_id)
        .await
        .map_err(|e| e.to_string())?;
    state.cache.lock().unwrap().insert(pack_id, v.clone());
    Ok(v)
}

#[tauri::command]
async fn preload_all(
    app: tauri::AppHandle,
    nms: NmsConfig,
    state: State<'_, AppState>,
) -> Result<usize, String> {
    let packs: Option<Vec<AdminPack>> = {
        let g = state.packs.lock().unwrap();
        if g.is_empty() { None } else { Some((*g).clone()) }
    };
    let packs = match packs {
        Some(p) => p,
        None => {
            let p = fetch_admin_packs(&nms).await.map_err(|e| e.to_string())?;
            *state.packs.lock().unwrap() = p.clone();
            p
        }
    };
    let total = packs.len();
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<ProgressPayload>();
    let app2 = app.clone();
    let forward = tokio::spawn(async move {
        while let Some(p) = rx.recv().await { let _ = app2.emit("preload:progress", p); }
    });

    let nms2 = nms.clone();
    let all = api::fetch_all_pack_data(nms, packs, move |completed, total, pack| {
        let _ = tx.send(ProgressPayload {
            completed, total, current: pack.name.clone(),
        });
    })
    .await
    .map_err(|e| e.to_string())?;
    drop(forward);

    {
        let mut cache = state.cache.lock().unwrap();
        for (p, v) in all { cache.insert(p.admin_pack_id, v); }
    }
    let _ = nms2; // suppress unused
    Ok(total)
}

#[tauri::command]
fn cache_stats(state: State<'_, AppState>) -> serde_json::Value {
    let g = state.cache.lock().unwrap();
    serde_json::json!({ "cached": g.len() })
}

#[tauri::command]
fn clear_cache(state: State<'_, AppState>) -> Result<(), String> {
    state.cache.lock().unwrap().clear();
    Ok(())
}

#[tauri::command]
async fn cmd_test_ai(
    provider: String,
    base_url: String,
    api_key: String,
    model_id: String,
) -> Result<String, String> {
    ai_test_connection(provider, base_url, api_key, model_id)
        .await
        .map_err(|e| e.to_string())
}

// ============================================================
// Update check (GitHub Releases API)
// ============================================================

const GITHUB_REPO: &str = "Ryuuzaki1412/adminpack-explorer";
const GITHUB_API_URL: &str = "https://api.github.com";

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct UpdateAsset {
    name: String,
    url: String,
    size: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct UpdateInfo {
    available: bool,
    current_version: String,
    latest_version: String,
    release_name: String,
    release_notes: String,
    release_url: String,
    published_at: String,
    assets: Vec<UpdateAsset>,
    /// True if the call hit GitHub successfully (false means network/error).
    reachable: bool,
    /// Human-readable error when reachable = false.
    error: Option<String>,
}

/// Simple semver compare: returns true if `latest` > `current`.
/// Handles `v0.1.3` / `0.1.3` / `0.1.3-beta.1` (pre-release < release).
fn is_newer_version(latest: &str, current: &str) -> bool {
    let strip = |v: &str| v.trim_start_matches('v').to_string();
    fn rank(pre: &str) -> u8 {
        // 0 = stable, 1 = pre-release, 2 = dev/rc/etc.
        if pre.is_empty() { 0 }
        else if pre.starts_with("rc") || pre.starts_with("dev") { 2 }
        else { 1 }
    }
    let parse = |v: &str| -> (Vec<u64>, String, u8) {
        let s = strip(v);
        // Split off pre-release (everything after '-')
        let (main, pre) = match s.split_once('-') {
            Some((m, p)) => (m, p.to_string()),
            None => (s.as_str(), String::new()),
        };
        let rk = rank(&pre);
        let nums: Vec<u64> = main.split('.').filter_map(|p| p.parse::<u64>().ok()).collect();
        (nums, pre, rk)
    };
    let (l_nums, l_pre, l_rank) = parse(latest);
    let (c_nums, c_pre, c_rank) = parse(current);
    let max = std::cmp::max(l_nums.len(), c_nums.len());
    for i in 0..max {
        let l = l_nums.get(i).copied().unwrap_or(0);
        let c = c_nums.get(i).copied().unwrap_or(0);
        if l > c { return true; }
        if l < c { return false; }
    }
    // Major.minor.patch equal: rank decides.
    // - both stable: equal → false
    // - latest is pre, current is stable: latest < current (not newer)
    // - latest is stable, current is pre: latest > current (newer)
    // - both pre: compare pre strings lexicographically as a tiebreaker
    if l_rank == c_rank {
        match (l_pre.is_empty(), c_pre.is_empty()) {
            (true, true) => false,
            (false, true) => false,   // latest is pre, current is stable → not newer
            (true, false) => true,    // latest is stable, current is pre → newer
            (false, false) => l_pre > c_pre,
        }
    } else {
        // Lower rank = more stable. A stable is "newer" than any pre-release of same M.m.p.
        l_rank < c_rank
    }
}

#[tauri::command]
async fn cmd_check_update(app: tauri::AppHandle) -> Result<UpdateInfo, String> {
    let current_version = app.package_info().version.to_string();
    let url = format!("{}/repos/{}/releases/latest", GITHUB_API_URL, GITHUB_REPO);

    let client = match reqwest::Client::builder()
        .user_agent(format!("AdminPack-Explorer/{}", current_version))
        .timeout(std::time::Duration::from_secs(15))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return Ok(UpdateInfo {
                available: false,
                current_version: current_version.clone(),
                latest_version: String::new(),
                release_name: String::new(),
                release_notes: String::new(),
                release_url: String::new(),
                published_at: String::new(),
                assets: vec![],
                reachable: false,
                error: Some(format!("构建 HTTP 客户端失败: {e}")),
            });
        }
    };

    let resp = match client.get(&url).send().await {
        Ok(r) => r,
        Err(e) => {
            return Ok(UpdateInfo {
                available: false,
                current_version: current_version.clone(),
                latest_version: String::new(),
                release_name: String::new(),
                release_notes: String::new(),
                release_url: String::new(),
                published_at: String::new(),
                assets: vec![],
                reachable: false,
                error: Some(format!("网络错误: {e}")),
            });
        }
    };

    let status = resp.status();
    if status == reqwest::StatusCode::NOT_FOUND {
        return Ok(UpdateInfo {
            available: false,
            current_version: current_version.clone(),
            latest_version: String::new(),
            release_name: String::new(),
            release_notes: String::new(),
            release_url: String::new(),
            published_at: String::new(),
            assets: vec![],
            reachable: true,
            error: Some("仓库尚无任何 release,请稍后再试。".to_string()),
        });
    }
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Ok(UpdateInfo {
            available: false,
            current_version: current_version.clone(),
            latest_version: String::new(),
            release_name: String::new(),
            release_notes: String::new(),
            release_url: String::new(),
            published_at: String::new(),
            assets: vec![],
            reachable: false,
            error: Some(format!("GitHub API 返回 {}: {}", status, body.chars().take(200).collect::<String>())),
        });
    }

    let body: Value = match resp.json().await {
        Ok(v) => v,
        Err(e) => {
            return Ok(UpdateInfo {
                available: false,
                current_version: current_version.clone(),
                latest_version: String::new(),
                release_name: String::new(),
                release_notes: String::new(),
                release_url: String::new(),
                published_at: String::new(),
                assets: vec![],
                reachable: false,
                error: Some(format!("解析响应失败: {e}")),
            });
        }
    };

    let tag = body.get("tag_name").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let latest_version = tag.trim_start_matches('v').to_string();
    let release_name = body.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let release_notes = body.get("body").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let release_url = body.get("html_url").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let published_at = body.get("published_at").and_then(|v| v.as_str()).unwrap_or("").to_string();

    let assets: Vec<UpdateAsset> = body
        .get("assets")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .map(|a| UpdateAsset {
                    name: a.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    url: a.get("browser_download_url").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    size: a.get("size").and_then(|v| v.as_u64()).unwrap_or(0),
                })
                .filter(|a| !a.name.is_empty() && !a.url.is_empty())
                .collect()
        })
        .unwrap_or_default();

    let available = !latest_version.is_empty() && is_newer_version(&latest_version, &current_version);

    Ok(UpdateInfo {
        available,
        current_version,
        latest_version,
        release_name,
        release_notes,
        release_url,
        published_at,
        assets,
        reachable: true,
        error: None,
    })
}

/// One image attachment sent from the JS chat UI.
/// Field names use `camelCase` on the wire (`mediaType`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatImage {
    /// base64 data (without the `data:image/...;base64,` prefix)
    pub data: String,
    /// mime type, e.g. "image/png", "image/jpeg", "image/webp", "image/gif"
    pub media_type: String,
}

#[tauri::command]
async fn cmd_ai_chat_global(
    user_message: String,
    history: Vec<ChatMessage>,
    images: Vec<ChatImage>,
    relevant_pack_ids: Vec<i64>,
    nms: NmsConfig,
    provider: String,
    base_url: String,
    api_key: String,
    model_id: String,
    timeout_secs: u64,
    state: State<'_, AppState>,
) -> Result<String, String> {
    // 1. Get all pack metadata
    let all_packs: Vec<AdminPack> = {
        let g = state.packs.lock().unwrap();
        (*g).clone()
    };

    // 2. Build relevant pack contexts
    let mut relevant_contexts: Vec<String> = Vec::new();
    for pack_id in &relevant_pack_ids {
        let pack = match all_packs.iter().find(|p| p.admin_pack_id == *pack_id) {
            Some(p) => p.clone(),
            None => continue,
        };
        let data = {
            let cache = state.cache.lock().unwrap();
            cache.get(pack_id).cloned()
        };
        let data = match data {
            Some(d) => d,
            None => match fetch_admin_pack_data(&nms, *pack_id).await {
                Ok(d) => d,
                Err(e) => { eprintln!("fetch pack {} failed: {}", pack_id, e); continue; }
            },
        };
        relevant_contexts.push(format!(
            "### {} (v{}, AdminPackId={})\n{}",
            pack.name, pack.version, pack.admin_pack_id, build_context(&pack, &data)
        ));
    }

    // 3. Per-pack counts
    let pack_counts: Vec<(String, i64, i64, i64, i64)> = all_packs
        .iter()
        .filter_map(|p| {
            let cache = state.cache.lock().unwrap();
            cache.get(&p.admin_pack_id).map(|d| (
                p.name.clone(),
                d.get("SnmpActionGroups").and_then(|v| v.as_array()).map(|a| a.len() as i64).unwrap_or(0),
                d.get("SnmpActionDefinitionInfos").and_then(|v| v.as_array()).map(|a| a.len() as i64).unwrap_or(0),
                d.get("StatisticsDataInfos").and_then(|v| v.as_array()).map(|a| a.len() as i64).unwrap_or(0),
                d.get("SnmpTrapProfileInfos").and_then(|v| v.as_array()).map(|a| a.len() as i64).unwrap_or(0),
            ))
        })
        .collect();

    let catalog_json = build_catalog(&all_packs);

    let relevant_block = if relevant_contexts.is_empty() {
        "(根据关键词未匹配到具体 AdminPack,仅目录可用)".to_string()
    } else {
        relevant_contexts.join("\n\n")
    };

    let counts_block = if pack_counts.is_empty() {
        String::new()
    } else {
        let rows: Vec<String> = pack_counts.iter()
            .map(|(n, g, a, s, t)| format!("- {}: {} 监控分组 / {} 监控项 / {} 统计点 / {} Trap", n, g, a, s, t))
            .collect();
        format!("\n## 已加载 AdminPack 的数量摘要\n{}\n", rows.join("\n"))
    };

    let system_prompt = format!(
        "你是 AdminPack Explorer 的全局 AI 助手。AdminPack 是 NMS(网络管理系统)中定义的对厂商/系统的监控包,每个包内含监控项、统计点、图表、Trap 模板等。\n\
         \n\
         ## 全部 AdminPack 目录(共 {n} 个)\n\
         ```json\n{catalog}\n```\n\
         {counts}\
         \n\
         ## 系统智能匹配出的相关 AdminPack 详细定义\n\
         {relevant}\n\
         \n\
         ## 回答规范\n\
         - 用中文回答,使用 Markdown 格式\n\
         - 引用数字时必须基于上方真实数据,**绝对不要**编造或硬编码具体数量\n\
         - 用户问\"我有 X 设备能监控什么\"时:指出对应的 AdminPack 名称+版本,列出该包真实存在的关键监控能力\n\
         - 用户问\"如何监控 Y 系统\"时:推荐合适的 AdminPack,说明理由\n\
         - 不要编造数据,如果当前匹配包没有相关信息,告知用户并建议加载更多 AdminPack(点 ⚡ 预加载全部)\n\
         - 引导用户:点击左侧对应厂商可查看该 AdminPack 完整定义\n\
         - 如果用户问题与 NMS 监控完全无关,礼貌说明本助手专注于 AdminPack 监控内容咨询",
        n = all_packs.len(),
        catalog = catalog_json,
        counts = counts_block,
        relevant = relevant_block,
    );

    // 4. Build user message (multimodal if images attached)
    let user_content: ChatMessageContent = if images.is_empty() {
        ChatMessageContent::Text(user_message)
    } else {
        let mut parts: Vec<ContentPart> = Vec::with_capacity(images.len() + 1);
        for img in &images {
            let mt = img.media_type.clone();
            let data = img.data.clone();
            if api::is_anthropic_compatible(&provider) {
                parts.push(ContentPart::ImageAnthropic {
                    kind: "image".to_string(),
                    source: ImageSourceAnthropic {
                        kind: "base64".to_string(),
                        media_type: mt,
                        data,
                    },
                });
            } else {
                parts.push(ContentPart::ImageOpenAI {
                    kind: "image_url".to_string(),
                    image_url: ImageUrlOpenAI {
                        url: format!("data:{};base64,{}", mt, data),
                    },
                });
            }
        }
        parts.push(ContentPart::Text {
            kind: "text".to_string(),
            text: user_message,
        });
        ChatMessageContent::Parts(parts)
    };

    // 5. Build messages: history + new user message
    let mut messages: Vec<ChatMessage> = history
        .into_iter()
        .filter(|m| m.role == "user" || m.role == "assistant")
        .collect();
    messages.push(ChatMessage { role: "user".to_string(), content: user_content });

    ai_chat_complete(provider, base_url, api_key, model_id, timeout_secs, system_prompt, messages)
        .await
        .map_err(|e| e.to_string())
}

fn build_catalog(packs: &[AdminPack]) -> String {
    use serde_json::json;
    let arr: Vec<_> = packs.iter().map(|p| json!({
        "id": p.admin_pack_id,
        "name": p.name,
        "description": p.description,
        "version": p.version,
    })).collect();
    serde_json::to_string(&arr).unwrap_or_else(|_| "[]".to_string())
}

fn build_context(pack: &AdminPack, data: &Value) -> String {
    use serde_json::json;
    let summary = json!({
        "Name": pack.name,
        "Description": pack.description,
        "Version": pack.version,
        "ActionGroups": data.get("SnmpActionGroups")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().map(|g| json!({
                "Name": g.get("Name").and_then(|v| v.as_str()).unwrap_or(""),
                "Description": g.get("Description").and_then(|v| v.as_str()).unwrap_or(""),
            })).collect::<Vec<_>>()),
        "Actions": data.get("SnmpActionDefinitionInfos")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().map(|a| json!({
                "Name": a.get("Name").and_then(|v| v.as_str()).unwrap_or(""),
                "Description": a.get("Description").and_then(|v| v.as_str()).unwrap_or(""),
            })).collect::<Vec<_>>()),
        "Statistics": data.get("StatisticsDataInfos")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().map(|s| json!({
                "Name": s.get("Name").and_then(|v| v.as_str()).unwrap_or(""),
                "Description": s.get("Description").and_then(|v| v.as_str()).unwrap_or(""),
            })).collect::<Vec<_>>()),
        "Traps": data.get("SnmpTrapProfileInfos")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().map(|t| json!({
                "Name": t.get("Name").and_then(|v| v.as_str()).unwrap_or(""),
                "Description": t.get("Description").and_then(|v| v.as_str()).unwrap_or(""),
                "TrapOid": t.get("TrapOid").and_then(|v| v.as_str()).unwrap_or(""),
            })).collect::<Vec<_>>()),
    });
    serde_json::to_string(&summary).unwrap_or_else(|_| "{}".to_string())
}

// ============================================================
// Auto-update (tauri-plugin-updater) — frontend-facing wrappers
// ============================================================
//
// Two commands are exposed so the JS side never has to touch
// tauri_plugin_updater directly:
//
//   • `cmd_install_update()`        — download + install + restart
//   • `cmd_postpone_update()`       — record "user declined" so we
//                                     can skip the badge until next
//                                     release
//
// Both go through the configured endpoint in tauri.conf.json
// (plugins.updater.endpoints) and use the pubkey there for signature
// verification. The Rust side does not need the private key — that
// lives in CI secrets only.

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct InstallUpdateProgress {
    /// bytes downloaded so far (0 when not started / on errors)
    bytes_downloaded: u64,
    /// total content length (0 when unknown)
    content_length: u64,
    /// Human-readable status: "downloading", "installing", "done", "error"
    status: String,
    /// Optional error message when status == "error"
    error: Option<String>,
}

#[tauri::command]
async fn cmd_install_update(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;

    // 1. Check (also re-verifies signature against embedded pubkey)
    let update = app
        .updater()
        .map_err(|e| format!("updater init failed: {e}"))?
        .check()
        .await
        .map_err(|e| format!("检查更新失败: {e}"))?;

    let Some(update) = update else {
        return Err("没有可用更新".to_string());
    };

    // 2. Download + install (emits "update:install:progress" events so
    //    the frontend can show a determinate progress bar).
    let app_chunk = app.clone();
    let app_finish = app.clone();
    update
        .download_and_install(
            move |chunk_len, content_len| {
                let _ = app_chunk.emit(
                    "update:install:progress",
                    InstallUpdateProgress {
                        bytes_downloaded: chunk_len as u64,
                        content_length: content_len.unwrap_or(0),
                        status: "downloading".to_string(),
                        error: None,
                    },
                );
            },
            move || {
                let _ = app_finish.emit(
                    "update:install:progress",
                    InstallUpdateProgress {
                        bytes_downloaded: 0,
                        content_length: 0,
                        status: "installing".to_string(),
                        error: None,
                    },
                );
            },
        )
        .await
        .map_err(|e| format!("下载/安装失败: {e}"))?;

    // 3. Tell the frontend we're about to restart, then restart.
    let _ = app.emit(
        "update:install:progress",
        InstallUpdateProgress {
            bytes_downloaded: 0,
            content_length: 0,
            status: "done".to_string(),
            error: None,
        },
    );
    app.restart();
}

#[tauri::command]
fn cmd_postpone_update() -> Result<(), String> {
    // Frontend persists the dismissal in its own tauri-plugin-store,
    // so this is a no-op for now. Exists so the UI has a stable hook
    // to call without throwing "command not found" if we ever want to
    // track server-side dismissals.
    Ok(())
}

#[tauri::command]
fn cmd_app_version(app: tauri::AppHandle) -> String {
    app.package_info().version.to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = dotenvy::dotenv();
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            list_admin_packs,
            get_pack_data,
            preload_all,
            cache_stats,
            clear_cache,
            cmd_test_ai,
            cmd_ai_chat_global,
            cmd_check_update,
            cmd_install_update,
            cmd_postpone_update,
            cmd_app_version,
        ])
        .setup(|_app| Ok(()))
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}