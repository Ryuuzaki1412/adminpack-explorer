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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = dotenvy::dotenv();
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            list_admin_packs,
            get_pack_data,
            preload_all,
            cache_stats,
            clear_cache,
            cmd_test_ai,
            cmd_ai_chat_global,
        ])
        .setup(|_app| Ok(()))
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}