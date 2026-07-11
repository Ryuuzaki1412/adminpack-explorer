use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;

// ============================================================
// Configuration (passed in from JS, no hardcoded fallbacks)
// ============================================================

/// Configuration for the AdminPack NMS HTTP API.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NmsConfig {
    pub base_url: String,
    pub api_key: String,
    #[serde(default)]
    pub cookie: String,
}

impl NmsConfig {
    /// Read config from environment variables (for CLI / dev-mode fallback).
    #[allow(dead_code)]
    pub fn from_env() -> Self {
        Self {
            base_url: std::env::var("ADMINPACK_BASE_URL").unwrap_or_default(),
            api_key: std::env::var("ADMINPACK_API_KEY").unwrap_or_default(),
            cookie: std::env::var("ADMINPACK_COOKIE").unwrap_or_default(),
        }
    }
    /// Validate required fields. Returns Err if base_url or api_key is empty.
    pub fn validate(&self) -> Result<()> {
        if self.base_url.trim().is_empty() {
            return Err(anyhow!("NMS base_url 未配置"));
        }
        if self.api_key.trim().is_empty() {
            return Err(anyhow!("NMS api_key 未配置"));
        }
        Ok(())
    }
    fn cookie_header(&self) -> String {
        if self.cookie.trim().is_empty() {
            String::new()
        } else {
            self.cookie.clone()
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdminPack {
    #[serde(rename = "AdminPackId")]
    pub admin_pack_id: i64,
    #[serde(rename = "SourceSystemIdentifier")]
    pub source_system_identifier: String,
    #[serde(rename = "SourceAddress")]
    pub source_address: String,
    #[serde(rename = "UniqueId")]
    pub unique_id: String,
    #[serde(rename = "Version")]
    pub version: i64,
    #[serde(rename = "Name")]
    pub name: String,
    #[serde(rename = "Description")]
    pub description: String,
    #[serde(rename = "IsImported")]
    pub is_imported: bool,
    #[serde(rename = "IsPublic")]
    pub is_public: bool,
    #[serde(rename = "LatestVersionApplied")]
    pub latest_version_applied: bool,
    #[serde(rename = "MinimumPlatformVersion")]
    pub minimum_platform_version: Option<i64>,
    #[serde(rename = "CreatedUtc")]
    pub created_utc: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdminPackDataEnvelope {
    #[serde(rename = "AdminPackDataJson")]
    pub admin_pack_data_json: String,
}

fn build_client(timeout_secs: u64) -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout_secs.max(10)))
        .connect_timeout(Duration::from_secs(15))
        .build()
        .expect("reqwest client build")
}

pub async fn fetch_admin_packs(cfg: &NmsConfig) -> Result<Vec<AdminPack>> {
    cfg.validate()?;
    let url = format!("{}/Api/SystemAdmin/AdminPacks", cfg.base_url.trim_end_matches('/'));
    let client = build_client(60);
    let cookie = cfg.cookie_header();
    let mut req = client
        .get(&url)
        .header("apikey", &cfg.api_key)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json");
    if !cookie.is_empty() {
        req = req.header("Cookie", cookie);
    }
    let resp = req.send().await.context("send request")?
        .error_for_status().context("non-2xx status")?
        .json::<Vec<AdminPack>>().await.context("parse JSON")?;
    Ok(resp)
}

pub async fn fetch_admin_pack_data(cfg: &NmsConfig, admin_pack_id: i64) -> Result<Value> {
    cfg.validate()?;
    let url = format!(
        "{}/Api/SystemAdmin/AdminPacks/{}/AdminPackData",
        cfg.base_url.trim_end_matches('/'),
        admin_pack_id
    );
    let client = build_client(60);
    let cookie = cfg.cookie_header();
    let mut req = client
        .get(&url)
        .header("apikey", &cfg.api_key)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json");
    if !cookie.is_empty() {
        req = req.header("Cookie", cookie);
    }
    let envelope = req
        .send().await
        .with_context(|| format!("send request for {}", admin_pack_id))?
        .error_for_status()
        .with_context(|| format!("non-2xx for {}", admin_pack_id))?
        .json::<AdminPackDataEnvelope>().await
        .with_context(|| format!("parse envelope for {}", admin_pack_id))?;
    let parsed: Value = serde_json::from_str(&envelope.admin_pack_data_json)
        .with_context(|| format!("parse inner JSON for {}", admin_pack_id))?;
    Ok(parsed)
}

pub async fn fetch_all_pack_data<F>(
    cfg: NmsConfig,
    packs: Vec<AdminPack>,
    mut progress: F,
) -> Result<Vec<(AdminPack, Value)>>
where
    F: FnMut(usize, usize, &AdminPack) + Send,
{
    use futures::stream::{FuturesUnordered, StreamExt};
    let total = packs.len();
    let mut iter = packs.into_iter();
    let concurrency = 8;

    let mut inflight: FuturesUnordered<_> = FuturesUnordered::new();
    let mut done: Vec<(AdminPack, Value)> = Vec::with_capacity(total);
    let mut completed = 0usize;

    for _ in 0..concurrency {
        if let Some(p) = iter.next() {
            let cfg2 = cfg.clone();
            let p2 = p.clone();
            inflight.push(tokio::spawn(async move {
                let r = fetch_admin_pack_data(&cfg2, p.admin_pack_id).await;
                (p2, r)
            }));
        }
    }

    while let Some(joined) = inflight.next().await {
        match joined {
            Ok((pack, Ok(data))) => {
                completed += 1;
                progress(completed, total, &pack);
                done.push((pack, data));
            }
            Ok((pack, Err(e))) => {
                return Err(anyhow!("pack {} failed: {}", pack.name, e));
            }
            Err(e) => return Err(anyhow!("join error: {}", e)),
        }
        if let Some(p) = iter.next() {
            let cfg2 = cfg.clone();
            let p2 = p.clone();
            inflight.push(tokio::spawn(async move {
                let r = fetch_admin_pack_data(&cfg2, p.admin_pack_id).await;
                (p2, r)
            }));
        }
    }
    Ok(done)
}

// ============================================================
// AI CHAT — Multi-provider support
// ============================================================

/// A single message in the conversation. Content can be plain text
/// (string) or multimodal (array of content parts). When the JS side
/// passes attachments, the last user message becomes multimodal.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ChatMessageContent {
    Text(String),
    Parts(Vec<ContentPart>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ContentPart {
    Text { #[serde(rename = "type")] kind: String, text: String },
    ImageAnthropic { #[serde(rename = "type")] kind: String, source: ImageSourceAnthropic },
    ImageOpenAI { #[serde(rename = "type")] kind: String, image_url: ImageUrlOpenAI },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageSourceAnthropic {
    #[serde(rename = "type")] pub kind: String,   // "base64"
    pub media_type: String,                          // "image/jpeg", "image/png", etc.
    pub data: String,                                 // base64 string
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageUrlOpenAI {
    pub url: String,                                  // "data:image/jpeg;base64,..."
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: ChatMessageContent,
}

#[derive(Debug, Deserialize)]
struct AnthropicResponse {
    #[serde(default)]
    content: Vec<AnthropicContentBlock>,
    #[serde(default)]
    error: Option<ApiErrorBody>,
}

#[derive(Debug, Deserialize)]
struct AnthropicContentBlock {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    text: String,
}

#[derive(Debug, Deserialize)]
struct OpenAIResponse {
    #[serde(default)]
    choices: Vec<OpenAIChoice>,
    #[serde(default)]
    error: Option<ApiErrorBody>,
}

#[derive(Debug, Deserialize)]
struct OpenAIChoice {
    message: OpenAIRespMessage,
}

#[derive(Debug, Deserialize)]
struct OpenAIRespMessage {
    #[serde(default)]
    content: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ApiErrorBody {
    #[serde(default)]
    pub message: String,
    #[serde(rename = "type", default)]
    pub kind: String,
}

/// Provider kinds the user can pick in the settings panel.
pub fn is_anthropic_compatible(provider: &str) -> bool {
    matches!(provider, "ark" | "anthropic")
}
pub fn is_openai_compatible(provider: &str) -> bool {
    matches!(provider, "openai" | "deepseek" | "qwen" | "ollama" | "lmstudio" | "custom")
}

pub async fn ai_chat_complete(
    provider: String,
    base_url: String,
    api_key: String,
    model_id: String,
    timeout_secs: u64,
    system_prompt: String,
    messages: Vec<ChatMessage>,
) -> Result<String> {
    if base_url.trim().is_empty() {
        return Err(anyhow!("AI base_url 未配置"));
    }
    if model_id.trim().is_empty() {
        return Err(anyhow!("AI model_id 未配置"));
    }
    let client = build_client(timeout_secs);

    if is_anthropic_compatible(&provider) {
        chat_anthropic(&client, &base_url, &api_key, &model_id, &system_prompt, &messages).await
    } else if is_openai_compatible(&provider) {
        chat_openai(&client, &base_url, &api_key, &model_id, &system_prompt, &messages).await
    } else {
        Err(anyhow!("未知 provider: {}", provider))
    }
}

async fn chat_anthropic(
    client: &reqwest::Client,
    base_url: &str,
    api_key: &str,
    model_id: &str,
    system_prompt: &str,
    messages: &[ChatMessage],
) -> Result<String> {
    // Convert ChatMessage[] to Anthropic format
    let mut msgs: Vec<Value> = Vec::with_capacity(messages.len());
    for m in messages {
        let role = m.role.clone();
        let content = match &m.content {
            ChatMessageContent::Text(s) => json!(s),
            ChatMessageContent::Parts(parts) => {
                let arr: Vec<Value> = parts.iter().map(|p| match p {
                    ContentPart::Text { kind, text } => json!({"type": kind, "text": text}),
                    ContentPart::ImageAnthropic { kind, source } => json!({
                        "type": kind, "source": {
                            "type": source.kind,
                            "media_type": source.media_type,
                            "data": source.data,
                        }
                    }),
                    ContentPart::ImageOpenAI { .. } => {
                        // OpenAI-format image part passed to Anthropic endpoint — skip
                        // (we convert at the call site instead)
                        Value::Null
                    }
                }).filter(|v| !v.is_null()).collect();
                json!(arr)
            }
        };
        msgs.push(json!({"role": role, "content": content}));
    }

    let body = json!({
        "model": model_id,
        "max_tokens": 4096,
        "system": system_prompt,
        "messages": msgs,
    });
    let url = format!("{}/v1/messages", base_url.trim_end_matches('/'));
    let mut req = client.post(&url)
        .header("anthropic-version", "2023-06-01")
        .header("Content-Type", "application/json")
        .json(&body);
    if !api_key.is_empty() {
        req = req.header("x-api-key", api_key);
    }
    let resp = req.send().await.context("send anthropic request")?;
    let status = resp.status();
    let body_text = resp.text().await.context("read body")?;
    if !status.is_success() {
        return Err(anyhow!("HTTP {}: {}", status, body_text));
    }
    let parsed: AnthropicResponse = serde_json::from_str(&body_text).context("parse anthropic response")?;
    if let Some(err) = parsed.error {
        return Err(anyhow!("API error: {}", err.message));
    }
    let reply = parsed.content.into_iter()
        .filter(|c| c.kind == "text")
        .map(|c| c.text)
        .collect::<Vec<_>>()
        .join("");
    Ok(if reply.is_empty() { "(模型无回复)".to_string() } else { reply })
}

async fn chat_openai(
    client: &reqwest::Client,
    base_url: &str,
    api_key: &str,
    model_id: &str,
    system_prompt: &str,
    messages: &[ChatMessage],
) -> Result<String> {
    // Convert ChatMessage[] to OpenAI format. The system message becomes
    // an entry with role=system. Image parts use the `image_url` shape.
    let mut msgs: Vec<Value> = Vec::with_capacity(messages.len() + 1);
    msgs.push(json!({
        "role": "system",
        "content": system_prompt,
    }));
    for m in messages {
        let role = m.role.clone();
        let content = match &m.content {
            ChatMessageContent::Text(s) => json!(s),
            ChatMessageContent::Parts(parts) => {
                let arr: Vec<Value> = parts.iter().map(|p| match p {
                    ContentPart::Text { kind, text } => json!({"type": kind, "text": text}),
                    ContentPart::ImageOpenAI { kind, image_url } => json!({
                        "type": kind, "image_url": {"url": image_url.url}
                    }),
                    ContentPart::ImageAnthropic { .. } => Value::Null,
                }).filter(|v| !v.is_null()).collect();
                json!(arr)
            }
        };
        msgs.push(json!({"role": role, "content": content}));
    }
    let body = json!({
        "model": model_id,
        "messages": msgs,
    });
    let url = format!("{}/v1/chat/completions", base_url.trim_end_matches('/'));
    let mut req = client.post(&url)
        .header("Content-Type", "application/json")
        .json(&body);
    if !api_key.is_empty() {
        req = req.header("Authorization", format!("Bearer {}", api_key));
    }
    let resp = req.send().await.context("send openai request")?;
    let status = resp.status();
    let body_text = resp.text().await.context("read body")?;
    if !status.is_success() {
        return Err(anyhow!("HTTP {}: {}", status, body_text));
    }
    let parsed: OpenAIResponse = serde_json::from_str(&body_text).context("parse openai response")?;
    if let Some(err) = parsed.error {
        return Err(anyhow!("API error: {}", err.message));
    }
    let reply = parsed.choices.into_iter()
        .next()
        .map(|c| c.message.content)
        .unwrap_or_default();
    Ok(if reply.is_empty() { "(模型无回复)".to_string() } else { reply })
}

/// Test connection by sending a tiny "ping" message.
pub async fn ai_test_connection(
    provider: String,
    base_url: String,
    api_key: String,
    model_id: String,
) -> Result<String> {
    let ping_msg: ChatMessage = ChatMessage {
        role: "user".to_string(),
        content: ChatMessageContent::Text("ping".to_string()),
    };
    let reply = if is_anthropic_compatible(&provider) {
        chat_anthropic(
            &build_client(30),
            &base_url,
            &api_key,
            &model_id,
            "You are a connectivity test assistant. Reply with exactly: PONG",
            &[ping_msg],
        ).await?
    } else if is_openai_compatible(&provider) {
        chat_openai(
            &build_client(30),
            &base_url,
            &api_key,
            &model_id,
            "You are a connectivity test assistant. Reply with exactly: PONG",
            &[ping_msg],
        ).await?
    } else {
        return Err(anyhow!("未知 provider: {}", provider));
    };
    Ok(if reply.is_empty() { "(empty reply)".to_string() } else { reply })
}

