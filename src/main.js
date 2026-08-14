/* ============================================================
   AdminPack Explorer — frontend logic (vanilla JS)
   ============================================================ */

// 1. ERROR HANDLERS — first thing, before anything that could throw
window.addEventListener('error', e => {
  _log(`ERROR: ${e.message} (${e.filename}:${e.lineno})`, true);
});
window.addEventListener('unhandledrejection', e => {
  _log(`UNHANDLED: ${e.reason && (e.reason.stack || e.reason.message || e.reason)}`, true);
});

// 2. Debug logger (works even before DOM ready by writing to a buffer)
const _logBuffer = [];
let _logEl = null;
function _log(msg, isErr = false) {
  const ts = new Date().toTimeString().slice(0, 8);
  const line = `[${ts}] ${msg}`;
  console.log(line);
  _logBuffer.push({ line, isErr });
  if (_logEl) {
    const d = document.createElement('div');
    d.style.color = isErr ? '#f55' : '#0f0';
    d.textContent = line;
    _logEl.appendChild(d);
    while (_logEl.childElementCount > 300) _logEl.removeChild(_logEl.firstChild);
    _logEl.scrollTop = _logEl.scrollHeight;
  }
  if (isErr) bumpLogBadge();
}
function _flushLogTo(el) {
  _logEl = el;
  for (const { line, isErr } of _logBuffer) {
    const d = document.createElement('div');
    d.style.color = isErr ? '#f55' : '#0f0';
    d.textContent = line;
    el.appendChild(d);
  }
  _logBuffer.length = 0;
  el.scrollTop = el.scrollHeight;
}

// 3. Safe __TAURI__ access
const _T = window.__TAURI__ || {};
const invoke = _T.core && _T.core.invoke ? _T.core.invoke : null;
const listen = _T.event && _T.event.listen ? _T.event.listen : null;
_log(`__TAURI__=${typeof _T}, invoke=${typeof invoke}, listen=${typeof listen}`);

// tauri-plugin-store (lazy-loaded)
let _store = null;
async function getStore() {
  if (_store) return _store;
  if (!_T.store || !_T.store.load || !_T.store.Store) return null;
  try {
    const Store = _T.store.Store || (_T.store.load && _T.store.load.Store);
    if (Store) {
      _store = await Store.load('adminpack-settings.json', { autoSave: false });
    }
  } catch (e) {
    _log('store load failed: ' + e, true);
  }
  return _store;
}

// Provider presets — each entry has a default base URL and a sample model id
const PROVIDER_PRESETS = {
  ark:        { baseUrl: 'https://api.minimaxi.com/anthropic',     modelId: 'MiniMax-M2.7',          protocol: 'anthropic' },
  anthropic:  { baseUrl: 'https://api.anthropic.com',             modelId: 'claude-3-5-sonnet-20241022', protocol: 'anthropic' },
  openai:     { baseUrl: 'https://api.openai.com/v1',             modelId: 'gpt-4o',               protocol: 'openai' },
  deepseek:   { baseUrl: 'https://api.deepseek.com/v1',           modelId: 'deepseek-chat',         protocol: 'openai' },
  qwen:       { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', modelId: 'qwen-vl-plus', protocol: 'openai' },
  ollama:     { baseUrl: 'http://localhost:11434/v1',             modelId: 'llava',                protocol: 'openai' },
  lmstudio:   { baseUrl: 'http://localhost:1234/v1',              modelId: 'qwen2-vl-7b-instruct', protocol: 'openai' },
  custom:     { baseUrl: '',                                       modelId: '',                     protocol: 'openai' },
};

const SETTINGS_DEFAULTS = {
  nms: {
    base_url: '',
    api_key: '',
    cookie: '',
  },
  ai: {
    provider: 'ark',
    base_url: PROVIDER_PRESETS.ark.baseUrl,
    api_key: '',
    model_id: PROVIDER_PRESETS.ark.modelId,
    timeout: 120,
  },
};

async function loadSettings() {
  const s = await getStore();
  if (!s) return JSON.parse(JSON.stringify(SETTINGS_DEFAULTS));
  try {
    const nmsBaseUrl = await s.get('nms.base_url') || '';
    const nmsApiKey  = await s.get('nms.api_key') || '';
    const nmsCookie  = await s.get('nms.cookie') || '';
    const aiProvider = await s.get('ai.provider') || SETTINGS_DEFAULTS.ai.provider;
    const aiBaseUrl  = await s.get('ai.base_url') || '';
    const aiApiKey   = await s.get('ai.api_key') || '';
    const aiModelId  = await s.get('ai.model_id') || '';
    const aiTimeout  = await s.get('ai.timeout');
    return {
      nms: { base_url: nmsBaseUrl, api_key: nmsApiKey, cookie: nmsCookie },
      ai: {
        provider: aiProvider,
        base_url: aiBaseUrl,
        api_key: aiApiKey,
        model_id: aiModelId,
        timeout: Number(aiTimeout ?? SETTINGS_DEFAULTS.ai.timeout),
      },
    };
  } catch (e) {
    _log('loadSettings failed: ' + e, true);
    return JSON.parse(JSON.stringify(SETTINGS_DEFAULTS));
  }
}

async function saveSettings(cfg) {
  const s = await getStore();
  if (!s) return false;
  try {
    await s.set('nms.base_url', cfg.nms?.base_url || '');
    await s.set('nms.api_key',  cfg.nms?.api_key  || '');
    await s.set('nms.cookie',   cfg.nms?.cookie   || '');
    await s.set('ai.provider',  cfg.ai?.provider  || SETTINGS_DEFAULTS.ai.provider);
    await s.set('ai.base_url',  cfg.ai?.base_url  || '');
    await s.set('ai.api_key',   cfg.ai?.api_key   || '');
    await s.set('ai.model_id',  cfg.ai?.model_id  || '');
    await s.set('ai.timeout',   Number(cfg.ai?.timeout) || 120);
    if (s.save) await s.save();
    return true;
  } catch (e) {
    _log('saveSettings failed: ' + e, true);
    return false;
  }
}


// Read the current app version from the Rust side (set in
// `tauri.conf.json` / `Cargo.toml`) and render it in the titlebar.
async function refreshAppVersion() {
  const el = document.getElementById('appVersion');
  if (!el) return;
  let v = '';
  try {
    if (invoke) v = await invoke('cmd_app_version');
  } catch (e) { _log('cmd_app_version failed: ' + e, true); }
  el.textContent = v ? `v${v}` : 'v?';
}

// Update the brand bar's NMS endpoint label from saved settings
async function refreshApiHost() {
  const el = document.getElementById('apiHost');
  if (!el) return;
  const cfg = await loadSettings();
  if (cfg.nms.base_url) {
    try {
      const u = new URL(cfg.nms.base_url);
      el.textContent = u.host;
    } catch {
      el.textContent = cfg.nms.base_url;
    }
  } else {
    el.textContent = '未配置 NMS';
  }
}

// Helper: build NmsConfig payload for backend invocations
function nmsConfigForBackend(cfg) {
  return {
    baseUrl: cfg.nms.base_url,
    apiKey: cfg.nms.api_key,
    cookie: cfg.nms.cookie || '',
  };
}

// 4. State
const state = {
  packs: [],
  selectedId: null,
  packData: {},
  loading: {},
  filterText: '',
};

// ============================================================
// CATEGORIZATION
// ============================================================
function categorize(name) {
  const n = (name || '').toLowerCase();
  if (/firewall|forti|palo alto|sonic|hillstone/.test(n)) return '网络安全';
  if (/wireless|wifi|meraki|ruckus/.test(n)) return '无线';
  if (/cisco|aruba|brocade|ruijie|juniper|huawei|h3c|sangfor|velocloud|viptela|siemens|schneider|zte/.test(n)) return '网络设备';
  if (/aws|azure|aliyun|google cloud|tencent|huawei cloud|appex cloud/.test(n)) return '云服务';
  if (/server|vmware|esx|vsphere|aria/.test(n)) return '服务器/虚拟化';
  if (/storage|netapp|pure|veeam|powervault|data domain|msa/.test(n)) return '存储/备份';
  if (/sql|mysql|exchange|iis|http/.test(n)) return '数据库/中间件';
  if (/agent|windows|linux|snmp mib|device polling|dhcp/.test(n)) return '系统/Agent';
  if (/ai nms/.test(n)) return 'AI';
  return '其他';
}

// ============================================================
// TOAST / STATUS
// ============================================================
function toast(message, kind = 'info', duration = 3000) {
  const c = document.getElementById('toastContainer');
  if (!c) return;
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  c.appendChild(el);
  setTimeout(() => {
    el.classList.add('removing');
    setTimeout(() => el.remove(), 200);
  }, duration);
}

function setStatus(text, kind = 'idle') {
  const ind = document.getElementById('statusIndicator');
  const txt = document.getElementById('statusText');
  if (!ind || !txt) return;
  ind.classList.remove('busy', 'error');
  if (kind === 'busy') ind.classList.add('busy');
  if (kind === 'error') ind.classList.add('error');
  txt.textContent = text;
}

function escapeHTML(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// ============================================================
// VENDOR ICON
// ============================================================
//
// Logo lookup is currently disabled — the trial Aruba logo rendered
// poorly inside the 44x44 square (wide rectangle, cropped badly).
// We fall back to the first letter of the vendor name (the original
// behaviour). Re-enable by restoring the VENDOR_LOGOS map + the
// <img> branch in setVendorIcon().

function setVendorIcon(name) {
  const el = document.getElementById('vendorIcon');
  if (!el) return;
  el.textContent = (name || '?').charAt(0).toUpperCase();
}

// ============================================================
// MARKDOWN RENDERER (lightweight, no deps)
// ============================================================
function renderInline(text) {
  // order matters: code first (no other formatting inside), then bold, italic, links
  return escapeHTML(text)
    .replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`)
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}

function renderMarkdown(md) {
  if (!md) return '';
  const lines = String(md).replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;

  const isTableSep = (s) => /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?$/.test(s.trim());

  while (i < lines.length) {
    const line = lines[i];

    // ---- code block ----
    if (/^```/.test(line)) {
      const lang = line.replace(/^```/, '').trim();
      const code = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) {
        code.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      out.push(`<pre><code class="lang-${escapeHTML(lang)}">${escapeHTML(code.join('\n'))}</code></pre>`);
      continue;
    }

    // ---- horizontal rule ----
    if (/^\s*---+\s*$/.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }

    // ---- heading ----
    let m = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (m) {
      const lvl = m[1].length;
      out.push(`<h${lvl}>${renderInline(m[2])}</h${lvl}>`);
      i++;
      continue;
    }

    // ---- blockquote (collect consecutive lines) ----
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      out.push(`<blockquote>${renderMarkdown(buf.join('\n'))}</blockquote>`);
      continue;
    }

    // ---- table ----
    if (/^\|/.test(line.trim()) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const splitRow = (s) =>
        s.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const headers = splitRow(line);
      i += 2; // skip header + separator
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i].trim())) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      let t = '<div class="md-table-wrap"><table><thead><tr>';
      for (const h of headers) t += `<th>${renderInline(h)}</th>`;
      t += '</tr></thead><tbody>';
      for (const r of rows) {
        t += '<tr>';
        for (const c of r) t += `<td>${renderInline(c)}</td>`;
        t += '</tr>';
      }
      t += '</tbody></table></div>';
      out.push(t);
      continue;
    }

    // ---- unordered list ----
    if (/^\s*[-*+]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ''));
        i++;
      }
      let u = '<ul>';
      for (const it of items) u += `<li>${renderInline(it)}</li>`;
      u += '</ul>';
      out.push(u);
      continue;
    }

    // ---- ordered list ----
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
        i++;
      }
      let o = '<ol>';
      for (const it of items) o += `<li>${renderInline(it)}</li>`;
      o += '</ol>';
      out.push(o);
      continue;
    }

    // ---- empty line ----
    if (!line.trim()) { i++; continue; }

    // ---- paragraph (collect until blank line or block element) ----
    const para = [line];
    i++;
    while (i < lines.length && lines[i].trim()
        && !/^(#{1,6}\s|>\s?|```|---+\s*$|\s*[-*+]\s+|\s*\d+\.\s+|\|)/.test(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    out.push(`<p>${renderInline(para.join(' '))}</p>`);
  }
  return out.join('\n');
}

// ============================================================
// SIDEBAR: vendor list
// ============================================================
// CJK → English vendor alias map for sidebar search (so "华为" finds "Huawei")
const SEARCH_ALIASES = {
  '华三': 'h3c', '华为': 'huawei', '思科': 'cisco', '阿鲁巴': 'aruba',
  '华睿': 'huawei', '戴尔': 'dell', '惠普': 'hpe', '惠普企业': 'hpe',
  '瞻博': 'juniper', '迈瑞': 'meraki', '迈赫迪': 'meraki',
  '派拓': 'palo alto', '派洛阿尔托': 'palo alto',
  '深信服': 'sangfor', '飞塔': 'fortigate', '飞塔科技': 'fortigate',
  '希尔': 'hillstone', '希尔石': 'hillstone',
  '微软': 'windows microsoft', '亚马逊': 'aws', '谷歌云': 'google cloud',
  '阿里云': 'aliyun', '腾讯云': 'tencent', '华为云': 'huawei cloud',
  '甲骨文': 'oracle', '赛门铁克': 'symantec', '迈克菲': 'mcafee',
  '无线': 'wireless ap wifi wlan', '防火墙': 'firewall fortigate palo sonic',
  '存储': 'storage netapp dell pure', '服务器': 'server windows linux',
  '数据库': 'sql mysql exchange', '云': 'aws azure cloud aliyun tencent',
  '思杰': 'citrix', '赛铁': 'cisco', '路由': 'cisco router', '交换': 'cisco switch',
  '数据库监控': 'sql mysql', '操作系统': 'agent windows linux server',
  '华三通信': 'h3c', '紫光华山': 'h3c', '锐捷': 'ruijie',
  '中兴': 'zte', '大华': 'dahua', '海康': 'hikvision',
  '山石': 'hillstone', '网神': 'hillstone',
  'sd-wan': 'sdwan viptela velocloud',
  '云灾备': 'veeam', '备份': 'veeam backup',
  '链路负载': 'load balancer', '广域网': 'sdwan wan',
};

function expandSearchFilter(filter) {
  const f = (filter || '').trim().toLowerCase();
  if (!f) return '';
  // Direct aliases
  const aliased = SEARCH_ALIASES[f];
  if (aliased) return `${f} ${aliased}`;
  return f;
}

function renderVendorList() {
  const root = document.getElementById('vendorList');
  if (!root) { _log('renderVendorList: #vendorList not found', true); return; }
  const rawFilter = (state.filterText || '').trim();
  if (!rawFilter) {
    // no filter — render full list
    renderVendorListFiltered(state.packs);
    return;
  }
  const expanded = expandSearchFilter(rawFilter).toLowerCase();
  const tokens = expanded.split(/\s+/).filter(Boolean);
  const filtered = state.packs.filter(p => {
    const name = (p.name || '').toLowerCase();
    const desc = (p.description || '').toLowerCase();
    // match: any token matches name OR description OR raw query (for exact contains)
    return tokens.some(t => name.includes(t) || desc.includes(t))
        || name.includes(rawFilter.toLowerCase())
        || desc.includes(rawFilter.toLowerCase());
  });
  renderVendorListFiltered(filtered);
}

function renderVendorListFiltered(filtered) {
  const root = document.getElementById('vendorList');
  if (!root) { _log('renderVendorListFiltered: #vendorList not found', true); return; }

  const groups = {};
  filtered.forEach(p => {
    const g = categorize(p.name);
    (groups[g] ||= []).push(p);
  });

  const groupOrder = ['网络设备', '网络安全', '无线', '云服务', '服务器/虚拟化',
    '存储/备份', '数据库/中间件', '系统/Agent', 'AI', '其他'];

  root.innerHTML = '';
  let hasAny = false;
  for (const g of groupOrder) {
    const items = groups[g];
    if (!items || !items.length) continue;
    hasAny = true;
    const label = document.createElement('div');
    label.className = 'vendor-group-label';
    label.textContent = `${g}  ${items.length}`;
    root.appendChild(label);
    items
      .sort((a, b) => String(a.name).localeCompare(String(b.name)))
      .forEach(p => root.appendChild(buildVendorItem(p)));
  }
  if (!hasAny) {
    root.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div><div>未找到匹配的厂商</div></div>`;
  }
  const vc = document.getElementById('vendorCount');
  if (vc) vc.textContent = state.packs.length;
}

function buildVendorItem(pack) {
  const item = document.createElement('div');
  item.className = 'vendor-item';
  const idRaw = pack.admin_pack_id ?? pack.AdminPackId ?? pack.adminPackId;
  item.dataset.id = String(idRaw);
  if (Number(state.selectedId) === Number(idRaw)) item.classList.add('active');
  if (state.loading[idRaw]) item.classList.add('loading-pack');

  const dot = document.createElement('span');
  dot.className = 'vendor-dot';

  const name = document.createElement('span');
  name.className = 'vendor-name';
  name.textContent = pack.name || '(unnamed)';

  const ver = document.createElement('span');
  ver.className = 'vendor-version';
  ver.textContent = `v${pack.version ?? '?'}`;

  item.appendChild(dot);
  item.appendChild(name);
  item.appendChild(ver);

  // Use mousedown + click for max reliability, also support touch
  const fire = (e) => {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    const id = Number(item.dataset.id);
    _log(`click → vendor ${pack.name} (id=${id})`);
    selectVendor(id);
  };
  item.addEventListener('click', fire);
  item.addEventListener('mousedown', (e) => {
    // Mark intent to click (some platforms need both)
    item._clickIntent = true;
  });

  return item;
}

// ============================================================
// VENDOR SELECTION — the main fix area
// ============================================================
async function selectVendor(packId) {
  packId = Number(packId);
  _log(`selectVendor(${packId}) sel=${state.selectedId} packs=${state.packs.length}`);

  if (state.selectedId === packId) {
    _log('skip same id');
    return;
  }

  state.selectedId = packId;

  // Update active class on sidebar
  document.querySelectorAll('.vendor-item').forEach(el => {
    el.classList.toggle('active', Number(el.dataset.id) === packId);
  });

  // Find pack
  const pack = state.packs.find(p => {
    const id = p.admin_pack_id ?? p.AdminPackId ?? p.adminPackId;
    return Number(id) === packId;
  });

  if (!pack) {
    _log(`pack ${packId} NOT found in state.packs (len=${state.packs.length})`, true);
    toast(`未找到厂商 #${packId}`, 'error');
    return;
  }
  _log(`pack found: ${pack.name}`);

  // Show loading state in detail panel IMMEDIATELY
  showDetailLoading(pack);

  // Fetch data
  let data = state.packData[packId];
  if (!data) {
    if (!invoke) {
      _log('invoke is not available!', true);
      toast('Tauri invoke 不可用', 'error');
      return;
    }
    state.loading[packId] = true;
    renderVendorList();
    try {
      _log(`invoke get_pack_data(${packId})`);
      const cfg = await loadSettings();
      data = await invoke('get_pack_data', { packId, nms: nmsConfigForBackend(cfg) });
      _log(`invoke OK (${data && typeof data === 'object' ? Object.keys(data).length + ' keys' : typeof data})`);
      state.packData[packId] = data;
    } catch (err) {
      _log(`invoke failed: ${err}`, true);
      toast(`加载失败: ${err}`, 'error', 5000);
      setStatus('加载失败', 'error');
      state.loading[packId] = false;
      renderVendorList();
      return;
    }
    state.loading[packId] = false;
    renderVendorList();
  }

  // Render detail content
  try {
    renderDetail(pack, data);
    _log('renderDetail OK');
  } catch (err) {
    _log(`renderDetail error: ${err && err.stack ? err.stack : err}`, true);
  }
  updateCacheStats();
}

function showDetailLoading(pack) {
  _log('showDetailLoading');
  const empty = document.getElementById('emptyContent');
  const detail = document.getElementById('detailContent');
  if (empty) empty.style.display = 'none';
  if (detail) detail.style.display = 'flex';

  const setText = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };

  setText('vendorName', pack.name || '');
  setText('vendorDesc', pack.description || '—');
  setText('vendorVersion', `v${pack.version ?? '?'}`);
  setVendorIcon(pack.name || '');

  // Reset approach pill + count to placeholder while data loads
  const approachEl = document.getElementById('vendorApproach');
  if (approachEl) approachEl.innerHTML = `<span class="approach-pill">—</span>`;
  const cntEl = document.getElementById('vendorApproachCount');
  if (cntEl) cntEl.textContent = '';

  const summary = document.getElementById('summaryRow');
  if (summary) summary.innerHTML =
    `<div class="summary-card"><div class="num">…</div><div class="label">加载中</div></div>`;
  document.querySelectorAll('.tab-panel').forEach(p => p.innerHTML = '');
  document.querySelectorAll('.tab-count').forEach(el => el.textContent = '…');
  setStatus(`加载 ${pack.name} …`, 'busy');
}

// ============================================================
// DETAIL RENDER
// ============================================================
function renderDetail(pack, data) {
  try {
    if (!data || typeof data !== 'object') {
      _log('renderDetail: data is not an object', true);
      return;
    }
    // Pre-compute categorization
    const ctxt = detectPackContext(data);

    // Count actions per kind (across all approaches)
    let stateTotal = 0, statTotal = 0, threshTotal = 0;
    for (const a of ctxt.actions) {
      if (a._stateCfgs.length) stateTotal++;
      if (a._statCfgs.length) statTotal++;
      if (a._threshCfgs.length) threshTotal++;
    }
    const trapTotal = ctxt.trapCount;

    // Update vendor header "监控方式"
    const approachEl = document.getElementById('vendorApproach');
    if (approachEl) {
      approachEl.innerHTML = renderApproachPills(ctxt);
    }
    // 监控项 = state + stat + threshold + trap (the user-requested total)
    const monitorItemCount = stateTotal + statTotal + threshTotal + trapTotal;
    const cntEl = document.getElementById('vendorApproachCount');
    if (cntEl) {
      cntEl.textContent = monitorItemCount > 0 ? `· ${monitorItemCount} 监控项` : '';
    }

    const summary = parseSummary(ctxt);
    const sr = document.getElementById('summaryRow');
    if (sr) sr.innerHTML = summary.map(cardHTML).join('');

    const setCount = (id, n) => {
      const el = document.getElementById(id);
      if (el) el.textContent = n;
    };
    setCount('cntState', stateTotal);
    setCount('cntStat', statTotal);
    setCount('cntThreshold', threshTotal);
    setCount('cntTraps', trapTotal);

    renderState(ctxt);
    renderStat(ctxt);
    renderThreshold(ctxt);
    renderTraps(data);
    renderRaw(data);

    setStatus(`已加载 ${pack.name}`, 'idle');
  } catch (e) {
    _log(`renderDetail FATAL: ${e.stack || e}`, true);
    toast(`加载详情失败: ${e.message || e}`, 'error', 5000);
    setStatus(`加载 ${pack.name} 失败`, 'error');
  }
}

function renderApproachPills(ctxt) {
  if (ctxt.approach === 'empty') {
    return `<span class="approach-pill">—</span>`;
  }
  if (ctxt.approach === 'trap-only') {
    return `<span class="approach-pill">${escapeHTML(APPROACH_LABELS['trap-only'].name)}</span>`;
  }
  if (ctxt.approaches.length === 1) {
    const a = APPROACH_LABELS[ctxt.approaches[0].name];
    return `<span class="approach-pill">${escapeHTML(a.name)}</span>`;
  }
  // multi
  return ctxt.approaches.map((ap, i) => {
    const a = APPROACH_LABELS[ap.name];
    const sep = i > 0 ? `<span class="approach-pill sep">+</span>` : '';
    return `${sep}<span class="approach-pill">${escapeHTML(a.name)} · ${ap.actionCount}</span>`;
  }).join('');
}

function cardHTML(c) {
  return `<div class="summary-card"><div class="num">${c.num}</div><div class="label">${c.label}</div></div>`;
}

function parseSummary(ctxt) {
  let stateTotal = 0, statTotal = 0, threshTotal = 0;
  for (const a of ctxt.actions) {
    if (a._stateCfgs.length) stateTotal++;
    if (a._statCfgs.length) statTotal++;
    if (a._threshCfgs.length) threshTotal++;
  }
  return [
    { num: stateTotal, label: '状态监控' },
    { num: statTotal, label: '图表监控' },
    { num: threshTotal, label: '阈值监控' },
    { num: ctxt.trapCount, label: 'Trap' },
  ];
}

// ============================================================
// TAB PANELS
// ============================================================

// ============================================================
// PACK CONTEXT DETECTION (SNMP / API / Agent / Trap-only)
// ============================================================
function detectPackContext(data) {
  // Detect ALL approaches present (a pack can have multiple — e.g. Aruba has SNMP + API)
  const approaches = [];
  const entityNameByUid = new Map();
  const allActions = [];
  const allActionIndex = new Map(); // "approach:UniqueId" -> index in allActions
  const stateUidsByAction = new Map(); // actionUniqueId -> Set(approach+uid composite)
  const threshUidsByAction = new Map();
  const statUidsByAction = new Map();
  const configsByActionApproach = new Map(); // actionUniqueId -> { state?, thresh?, stat? }
  const allStats = data.StatisticsDataInfos || [];
  const allCharts = data.ChartInfos || [];
  const statByUid = new Map(allStats.map(s => [s.UniqueId, s]));
  const chartByName = new Map();
  for (const c of allCharts) {
    if (c.Name) chartByName.set(c.Name, [...(chartByName.get(c.Name) || []), c]);
  }

  function register(prefix, approachName) {
    const actions = data[`${prefix}ActionDefinitionInfos`] || [];
    if (!actions.length) return;
    const stateConfigs = data[`${prefix}ActionDefinitionStateConfigDataInfos`] || [];
    const threshConfigs = data[`${prefix}ActionDefinitionThresholdConfigDataInfos`] || [];
    const statConfigs = data[`${prefix}ActionDefinitionStatisticsConfigInfos`] || [];
    const entityDefs = data[`${prefix}EntityDefinitionInfos`] || [];

    // Build per-action lookups for this approach
    const stateByAction = new Map();
    for (const c of stateConfigs) {
      const aid = c[`${prefix}ActionDefinitionUniqueId`];
      if (!aid) continue;
      if (!stateByAction.has(aid)) stateByAction.set(aid, []);
      stateByAction.get(aid).push(c);
    }
    const threshByAction = new Map();
    for (const c of threshConfigs) {
      const aid = c[`${prefix}ActionDefinitionUniqueId`];
      if (!aid) continue;
      if (!threshByAction.has(aid)) threshByAction.set(aid, []);
      threshByAction.get(aid).push(c);
    }
    const statByAction = new Map();
    for (const c of statConfigs) {
      const aid = c[`${prefix}ActionDefinitionUniqueId`];
      if (!aid) continue;
      if (!statByAction.has(aid)) statByAction.set(aid, []);
      statByAction.get(aid).push(c);
    }

    for (const e of entityDefs) {
      if (e.UniqueId) entityNameByUid.set(e.UniqueId, e.Name || '(unnamed)');
    }

    const approachInfo = {
      name: approachName,
      label: APPROACH_LABELS[approachName].name,
      icon: APPROACH_LABELS[approachName].icon,
      prefix,
      entityUidField: `${prefix}EntityDefinitionUniqueId`,
      configJsonField: `${prefix}ActionDefinitionThresholdConfigJson`,
      stateByAction, threshByAction, statByAction,
      actionCount: actions.length,
      stateCount: stateByAction.size,
      threshCount: threshByAction.size,
      statCount: statByAction.size,
    };
    approaches.push(approachInfo);

    // Flatten actions with approach tag
    for (const a of actions) {
      const tagged = {
        ...a,
        _approach: approachName,
        _entityUidField: approachInfo.entityUidField,
        _configJsonField: approachInfo.configJsonField,
        _stateCfgs: stateByAction.get(a.UniqueId) || [],
        _threshCfgs: threshByAction.get(a.UniqueId) || [],
        _statCfgs: statByAction.get(a.UniqueId) || [],
      };
      allActions.push(tagged);
      allActionIndex.set(`${approachName}:${a.UniqueId}`, allActions.length - 1);
      if (tagged._stateCfgs.length) stateUidsByAction.set(a.UniqueId, true);
      if (tagged._threshCfgs.length) threshUidsByAction.set(a.UniqueId, true);
      if (tagged._statCfgs.length) statUidsByAction.set(a.UniqueId, true);
    }
  }

  register('Snmp', 'snmp');
  register('Api', 'api');
  register('DeviceAgent', 'agent');

  const trapCount = (data.SnmpTrapProfileInfos || []).length;
  let approach;
  if (approaches.length === 0) {
    approach = trapCount > 0 ? 'trap-only' : 'empty';
  } else {
    approach = approaches.length === 1 ? approaches[0].name : 'multi';
  }

  return {
    approach,
    approaches,
    actions: allActions,
    stateUidsByAction,
    threshUidsByAction,
    statUidsByAction,
    entityNameByUid,
    trapCount,
    statByUid,
    chartByName,
    raw: data,
  };
}

const APPROACH_LABELS = {
  snmp:       { name: 'SNMP',       icon: '🛰️', desc: '基于 SNMP 协议轮询设备 OID' },
  api:        { name: 'API',        icon: '🌐', desc: '基于 REST/GraphQL 等 HTTP API 拉取' },
  agent:      { name: 'Agent',      icon: '🤖', desc: '通过部署在主机上的 Agent 上报' },
  'trap-only':{ name: 'SNMP Trap',  icon: '🔔', desc: '仅接收设备主动上报的 SNMP Trap 告警' },
  empty:      { name: '—',          icon: '∅', desc: '该 AdminPack 无监控项' },
};

function listItemHTML(item, extraMeta) {
  const name = item.Name || item.DisplayName || '(unnamed)';
  const desc = item.Description || '';
  return `
    <div class="list-item">
      <span class="list-item-bullet"></span>
      <div class="list-item-content">
        <div class="list-item-name">${escapeHTML(name)}</div>
        ${desc ? `<div class="list-item-desc">${escapeHTML(desc)}</div>` : ''}
        ${extraMeta ? `<div class="list-item-meta">${extraMeta}</div>` : ''}
      </div>
    </div>`;
}

function toggleSection(headerEl) {
  headerEl.parentElement.classList.toggle('collapsed');
}

function actionItemHTML(action, extraMeta) {
  const name = action.Name || action.DisplayName || '(unnamed)';
  const desc = action.Description || '';
  return `
    <div class="list-item">
      <span class="list-item-bullet"></span>
      <div class="list-item-content">
        <div class="list-item-name">${escapeHTML(name)}</div>
        ${desc ? `<div class="list-item-desc">${escapeHTML(desc)}</div>` : ''}
        ${extraMeta ? `<div class="list-item-meta">${extraMeta}</div>` : ''}
      </div>
    </div>`;
}

// (监控方式 render moved to vendor header — see renderDetail)

function labelForType(t) {
  return ({
    0: '状态',
    1: '图表',
    2: '阈值',
    3: '其他',
  })[t] ?? `${t}`;
}

// Helper: build meta string with entity context (no 轮询/状态 noise — just entity + extras)
function buildActionMeta(ctxt, action, extraParts = []) {
  const entName = ctxt.entityNameByUid.get(action[action._entityUidField]) || '';
  const parts = [];
  if (entName) parts.push(`实体: ${escapeHTML(entName)}`);
  if (extraParts.length) parts.push(...extraParts);
  return parts.join(' · ');
}

// Render one action item; hides description when it duplicates the name
function renderActionItemHTML(action, meta, dedupIndex) {
  const name = action.Name || action.DisplayName || '(unnamed)';
  const desc = action.Description || '';
  const showDesc = desc && desc !== name;
  const dupTag = dedupIndex != null ? ` <span class="dup-tag">重复 #${dedupIndex + 1}</span>` : '';
  return `
    <div class="list-item${dedupIndex != null ? ' duplicate' : ''}">
      <span class="list-item-bullet"></span>
      <div class="list-item-content">
        <div class="list-item-name">${escapeHTML(name)}${dupTag}</div>
        ${showDesc ? `<div class="list-item-desc">${escapeHTML(desc)}</div>` : ''}
        ${meta ? `<div class="list-item-meta">${meta}</div>` : ''}
      </div>
    </div>`;
}

// Helper: render an action list with dedup-by-(name, entity) hint
function renderActionListWithDedup(actions, ctxt, buildExtra) {
  const seen = new Map(); // "Name|entity" -> index
  return actions.map((a, idx) => {
    const name = a.Name || a.DisplayName || '(unnamed)';
    const ent = ctxt.entityNameByUid.get(a[a._entityUidField]) || '';
    const key = `${name}|${ent}`;
    const firstIdx = seen.get(key);
    const meta = buildActionMeta(ctxt, a, buildExtra(a));
    if (firstIdx !== undefined) {
      return renderActionItemHTML(a, meta, firstIdx);
    }
    seen.set(key, idx);
    return renderActionItemHTML(a, meta, null);
  }).join('');
}

// 2. 状态类型 — actions with state config (meta only shows 实体)
function renderState(ctxt) {
  const panel = document.querySelector('[data-panel="state"]');
  if (!panel) return;
  const actions = ctxt.actions.filter(a => a._stateCfgs.length > 0);
  panel.innerHTML = actions.length === 0
    ? `<div class="empty-state"><div class="empty-icon">📋</div><div>无状态类型监控</div></div>`
    : renderActionListWithDedup(actions, ctxt, () => []);
}

// 3. 图表类型 — actions with statistics config
function renderStat(ctxt) {
  const panel = document.querySelector('[data-panel="stat"]');
  if (!panel) return;
  const actions = ctxt.actions.filter(a => a._statCfgs.length > 0);
  if (actions.length === 0) {
    panel.innerHTML = `<div class="empty-state"><div class="empty-icon">📊</div><div>无图表类型监控</div></div>`;
    return;
  }
  panel.innerHTML = renderActionListWithDedup(actions, ctxt, a => {
    const relatedStats = a._statCfgs.map(c => ctxt.statByUid.get(c.StatisticsDataUniqueId)).filter(Boolean);
    const relatedCharts = relatedStats.flatMap(s => ctxt.chartByName.get(s.Name) || []);
    const parts = [];
    if (relatedStats.length) {
      parts.push(`统计点: ${relatedStats.slice(0, 3).map(s => escapeHTML(s.Name)).join(', ')}${relatedStats.length > 3 ? ` 等 ${relatedStats.length} 项` : ''}`);
    }
    if (relatedCharts.length) {
      parts.push(`图表: ${relatedCharts.slice(0, 2).map(c => escapeHTML(c.Name)).join(', ')}${relatedCharts.length > 2 ? ` 等 ${relatedCharts.length} 项` : ''}`);
    }
    return parts;
  });
}

// 4. 阈值类型 — actions with threshold config
function renderThreshold(ctxt) {
  const panel = document.querySelector('[data-panel="threshold"]');
  if (!panel) return;
  const actions = ctxt.actions.filter(a => a._threshCfgs.length > 0);
  if (actions.length === 0) {
    panel.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div>无阈值类型监控</div></div>`;
    return;
  }
  panel.innerHTML = renderActionListWithDedup(actions, ctxt, a => {
    const cfgs = a._threshCfgs;
    if (!cfgs.length || !cfgs[0][a._configJsonField]) return [];
    try {
      const parsed = JSON.parse(cfgs[0][a._configJsonField]);
      const v1 = parsed.Value1, v2 = parsed.Value2, v3 = parsed.Value3;
      const parts = [];
      if (v1 != null) parts.push(`L1 ≥ ${v1}`);
      if (v2 != null) parts.push(`L2 ≥ ${v2}`);
      if (v3 != null) parts.push(`L3 ≥ ${v3}`);
      if (parts.length) return [`阈值: ${parts.join(' / ')}`];
    } catch (e) { /* ignore */ }
    return [];
  });
}

// 5. Trap 告警
function renderTraps(data) {
  const panel = document.querySelector('[data-panel="traps"]');
  if (!panel) return;
  const items = data.SnmpTrapProfileInfos || [];
  panel.innerHTML = items.length === 0
    ? `<div class="empty-state"><div class="empty-icon">🔔</div><div>无 Trap 模板</div></div>`
    : items.map(t => actionItemHTML(t, t.TrapOid ? `OID: ${escapeHTML(t.TrapOid)}` : null)).join('');
}

function renderRaw(data) {
  const el = document.getElementById('rawJson');
  if (el) el.textContent = JSON.stringify(data, null, 2);
}

// ============================================================
// TABS / SEARCH / CACHE
// ============================================================
function setupTabs() {
  document.querySelectorAll('.content-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      document.querySelectorAll('.content-tab').forEach(t => t.classList.toggle('active', t === tab));
      document.querySelectorAll('.tab-panel').forEach(p => {
        p.classList.toggle('active', p.dataset.panel === target);
      });
    });
  });
}

function setupSidebarTabs() {
  document.querySelectorAll('[data-sidebar-tab]').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('[data-sidebar-tab]').forEach(t => t.classList.toggle('active', t === tab));
      if (tab.dataset.sidebarTab === 'search') {
        const i = document.getElementById('searchInput');
        if (i) i.focus();
      }
    });
  });
}

function setupSearch() {
  const input = document.getElementById('searchInput');
  if (!input) return;
  let t;
  input.addEventListener('input', e => {
    clearTimeout(t);
    t = setTimeout(() => {
      state.filterText = e.target.value || '';
      renderVendorList();
    }, 120);
  });
}

function setupStatusTabs() {
  const tabs = document.querySelectorAll('.status-tab');
  const panel = document.getElementById('logPanel');
  const body = document.getElementById('logPanelBody');
  const closeBtn = document.getElementById('logCloseBtn');
  const clearBtn = document.getElementById('logClearBtn');
  const copyBtn = document.getElementById('logCopyBtn');

  tabs.forEach(t => {
    t.addEventListener('click', () => {
      tabs.forEach(s => s.classList.toggle('active', s === t));
      const which = t.dataset.status;
      if (which === 'log') {
        if (panel) {
          panel.style.display = 'flex';
          // First time opening → flush buffered log lines into the panel.
          if (!_logEl && body) _flushLogTo(body);
          _logEl = body;
          if (body) body.scrollTop = body.scrollHeight;
          clearLogBadge();
        }
      } else {
        if (panel) panel.style.display = 'none';
      }
    });
  });

  if (closeBtn) closeBtn.addEventListener('click', () => {
    if (panel) panel.style.display = 'none';
    tabs.forEach(s => s.classList.toggle('active', s.dataset.status === 'info'));
  });
  if (clearBtn) clearBtn.addEventListener('click', () => {
    if (body) body.innerHTML = '';
  });
  if (copyBtn) copyBtn.addEventListener('click', async () => {
    if (!body) return;
    const text = Array.from(body.children).map(n => n.textContent).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast('日志已复制', 'success', 1500);
    } catch (e) {
      _log('copy log failed: ' + e, true);
      toast('复制失败', 'error');
    }
  });
}

// Red badge on the 日志 tab — shows count of error lines since last open.
let _logErrCount = 0;
function bumpLogBadge() {
  _logErrCount += 1;
  const badge = document.getElementById('statusLogBadge');
  if (!badge) return;
  badge.style.display = 'inline-block';
  badge.textContent = _logErrCount > 99 ? '99+' : String(_logErrCount);
}
function clearLogBadge() {
  _logErrCount = 0;
  const badge = document.getElementById('statusLogBadge');
  if (badge) { badge.style.display = 'none'; badge.textContent = '0'; }
}

function setupRawActions() {
  const c = document.getElementById('btnCopyRaw');
  if (c) c.addEventListener('click', async () => {
    const text = document.getElementById('rawJson')?.textContent || '';
    try {
      await navigator.clipboard.writeText(text);
      toast('已复制到剪贴板', 'success', 1500);
    } catch {
      toast('复制失败', 'error');
    }
  });
  const d = document.getElementById('btnDownloadRaw');
  if (d) d.addEventListener('click', () => {
    if (!state.selectedId) return;
    const pack = state.packs.find(p => Number(p.admin_pack_id ?? p.AdminPackId) === Number(state.selectedId));
    if (!pack) return;
    const text = document.getElementById('rawJson')?.textContent || '';
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(pack.name || 'pack').replace(/\s+/g, '_')}_v${pack.version}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('已下载', 'success', 1500);
  });
}

// ============================================================
// UPDATE CHECK
// ============================================================
const UPDATE_REPO_URL = 'https://github.com/Ryuuzaki1412/adminpack-explorer';
const UPDATE_AUTO_CHECK_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6h

function formatBytes(n) {
  if (!n || n <= 0) return '';
  const u = ['B','KB','MB','GB','TB'];
  let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${u[i]}`;
}

function formatDateTime(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch { return ''; }
}

function openExternalLink(url) {
  // Tauri 2 webview blocks window.open(); use a synthetic anchor with
  // target=_blank — the webview will delegate the user-initiated
  // navigation to the OS default browser. Falls back to copy if that
  // somehow doesn't trigger.
  if (!url) return;
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => a.remove(), 0);
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch { return false; }
  }
}

let _updateBusy = false;
let _updateLastInfo = null;

function setUpdateBadgeVisible(show) {
  const dot = document.getElementById('updateDot');
  if (dot) dot.style.display = show ? 'block' : 'none';
}

function setUpdateState(which) {
  // which = 'loading' | 'uptodate' | 'available' | 'error'
  const ids = {
    loading:   'updateLoading',
    uptodate:  'updateUptodate',
    available: 'updateAvailable',
    error:     'updateError',
  };
  for (const [k, id] of Object.entries(ids)) {
    const el = document.getElementById(id);
    if (el) el.style.display = k === which ? '' : 'none';
  }
}

function showUpdateModal() {
  const modal = document.getElementById('updateModal');
  if (modal) modal.style.display = 'flex';
}
function hideUpdateModal() {
  const modal = document.getElementById('updateModal');
  if (modal) modal.style.display = 'none';
}

function renderUpdateInfo(info) {
  if (!info || !info.reachable) {
    setUpdateState('error');
    const detail = document.getElementById('updateErrorDetail');
    if (detail) detail.textContent = (info && info.error) || '未知错误';
    return;
  }
  if (info.available) {
    setUpdateState('available');
    const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v || ''; };
    setText('updateLatestVersion',   info.latestVersion);
    setText('updateCurrentVersion2', info.currentVersion);
    setText('updateLatestVersion2',  info.latestVersion);
    setText('updatePublishedAt2',    formatDateTime(info.publishedAt));
    setText('updateReleaseName',     info.releaseName || `(v${info.latestVersion})`);

    // Release notes — render as markdown for nice formatting
    const notesEl = document.getElementById('updateNotes');
    if (notesEl) {
      notesEl.innerHTML = info.releaseNotes
        ? renderMarkdown(info.releaseNotes)
        : '';
    }

    // Assets
    const assetsEl  = document.getElementById('updateAssets');
    const sectionEl = document.getElementById('updateAssetsSection');
    if (assetsEl && sectionEl) {
      if (info.assets && info.assets.length) {
        sectionEl.style.display = '';
        assetsEl.innerHTML = info.assets.map(a => `
          <li>
            <span class="update-asset-name" title="${escapeHTML(a.url)}">${escapeHTML(a.name)}</span>
            <span class="update-asset-size">${escapeHTML(formatBytes(a.size))}</span>
          </li>
        `).join('');
      } else {
        sectionEl.style.display = 'none';
      }
    }

    // Action buttons
    const openBtn = document.getElementById('updateOpen');
    if (openBtn) {
      openBtn.onclick = () => {
        const url = info.releaseUrl || `${UPDATE_REPO_URL}/releases/tag/v${info.latestVersion}`;
        openExternalLink(url);
      };
    }
    const copyBtn = document.getElementById('updateCopyLink');
    if (copyBtn) {
      copyBtn.onclick = async () => {
        const url = info.releaseUrl || `${UPDATE_REPO_URL}/releases/tag/v${info.latestVersion}`;
        const ok = await copyToClipboard(url);
        toast(ok ? '已复制 release 链接' : '复制失败', ok ? 'success' : 'error');
      };
    }
    setUpdateBadgeVisible(true);
  } else {
    setUpdateState('uptodate');
    const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v || ''; };
    setText('updateCurrentVersion', info.currentVersion);
    setText('updateLatestVersionEq',
      info.latestVersion ? info.latestVersion : info.currentVersion);
    setText('updatePublishedAt', info.publishedAt ? `发布于 ${formatDateTime(info.publishedAt)}` : '');
    setUpdateBadgeVisible(false);
  }
}

async function runCheckUpdate({ showModal = true } = {}) {
  if (_updateBusy) return;
  if (!invoke) {
    if (showModal) {
      showUpdateModal();
      setUpdateState('error');
      const detail = document.getElementById('updateErrorDetail');
      if (detail) detail.textContent = 'Tauri invoke 不可用';
    }
    return;
  }
  _updateBusy = true;
  const btn = document.getElementById('btnCheckUpdate');
  if (btn) btn.classList.add('loading');
  if (showModal) {
    showUpdateModal();
    setUpdateState('loading');
  }
  try {
    const info = await invoke('cmd_check_update');
    _updateLastInfo = info;
    renderUpdateInfo(info);
    // Persist last-check info so we can show a badge across restarts
    try {
      const s = await getStore();
      if (s) {
        await s.set('update.last_check', Date.now());
        if (info && info.reachable) {
          await s.set('update.last_info', {
            available: !!info.available,
            currentVersion: info.currentVersion,
            latestVersion: info.latestVersion,
            publishedAt: info.publishedAt,
          });
        }
        if (s.save) await s.save();
      }
    } catch { /* ignore persistence errors */ }
    return info;
  } catch (err) {
    _log(`check_update failed: ${err}`, true);
    if (showModal) {
      setUpdateState('error');
      const detail = document.getElementById('updateErrorDetail');
      if (detail) detail.textContent = String(err && err.message ? err.message : err);
    }
    return null;
  } finally {
    _updateBusy = false;
    if (btn) btn.classList.remove('loading');
  }
}

async function setupUpdate() {
  const btn       = document.getElementById('btnCheckUpdate');
  const close     = document.getElementById('updateClose');
  const retry     = document.getElementById('updateRetry');
  const modal     = document.getElementById('updateModal');
  const installBtn = document.getElementById('updateInstall');

  if (btn) btn.addEventListener('click', () => runCheckUpdate({ showModal: true }));
  if (close) close.addEventListener('click', hideUpdateModal);
  if (modal) modal.addEventListener('click', (e) => {
    if (e.target === modal) hideUpdateModal();
  });
  if (retry) retry.addEventListener('click', () => runCheckUpdate({ showModal: true }));
  if (installBtn) installBtn.addEventListener('click', () => runInstallUpdate());

  // Listen for download/install progress events emitted by the Rust side.
  if (listen) {
    listen('update:install:progress', (evt) => {
      const p = evt.payload || {};
      applyInstallProgress(p);
    }).catch(err => _log('listen(update:install:progress) failed: ' + err, true));
  }

  // Restore badge from last known state, then optionally auto-check.
  try {
    const s = await getStore();
    if (s) {
      const last = await s.get('update.last_info');
      if (last && last.available) setUpdateBadgeVisible(true);
    }
  } catch { /* ignore */ }

  // Auto-check on startup (silent, won't pop modal) if it's been > cooldown
  try {
    const s = await getStore();
    const lastTs = s ? await s.get('update.last_check') : null;
    const due = !lastTs || (Date.now() - Number(lastTs)) > UPDATE_AUTO_CHECK_COOLDOWN_MS;
    if (due) {
      // Delay so it doesn't race with initial vendor load
      setTimeout(() => { runCheckUpdate({ showModal: false }); }, 4000);
    }
  } catch { /* ignore */ }
}

// ============================================================
// Install (download + install + restart)
// ============================================================
function showInstallProgress(show) {
  const el = document.getElementById('updateInstallProgress');
  if (el) el.style.display = show ? 'block' : 'none';
}

function setInstallActionsDisabled(disabled) {
  for (const id of ['updateInstall', 'updateCopyLink', 'updateOpen']) {
    const el = document.getElementById(id);
    if (el) el.disabled = disabled;
  }
}

function applyInstallProgress(p) {
  const fill  = document.getElementById('updateProgressFill');
  const label = document.getElementById('updateProgressLabel');
  const bytes = document.getElementById('updateProgressBytes');
  const hint  = document.getElementById('updateProgressHint');

  const status = p.status || 'downloading';
  const downloaded = Number(p.bytesDownloaded || 0);
  const total      = Number(p.contentLength || 0);

  if (status === 'downloading') {
    const pct = total > 0 ? Math.round((downloaded / total) * 100) : 0;
    if (fill)  fill.style.width = pct + '%';
    if (label) label.textContent = `下载中…  ${pct}%`;
    if (bytes) {
      const d = formatBytes(downloaded);
      const t = total > 0 ? formatBytes(total) : '?';
      bytes.textContent = `${d} / ${t}`;
    }
    if (hint)  hint.textContent = '下载完成后会自动安装并重启应用。';
  } else if (status === 'installing') {
    if (fill)  fill.style.width = '100%';
    if (label) label.textContent = '正在安装…';
    if (bytes) bytes.textContent = '';
    if (hint)  hint.textContent = '即将自动重启,请稍候。';
  } else if (status === 'done') {
    if (fill)  fill.style.width = '100%';
    if (label) label.textContent = '安装完成,正在重启…';
  } else if (status === 'error') {
    showInstallProgress(false);
    setInstallActionsDisabled(false);
    toast(`更新失败: ${p.error || '未知错误'}`, 'error', 6000);
  }
}

async function runInstallUpdate() {
  if (!invoke) {
    toast('Tauri invoke 不可用', 'error');
    return;
  }
  // Switch UI into "downloading" state inside the available card.
  showInstallProgress(true);
  setInstallActionsDisabled(true);
  applyInstallProgress({ status: 'downloading', bytesDownloaded: 0, contentLength: 0 });

  try {
    await invoke('cmd_install_update');
    // The Rust side restarts the app; we never reach here on success.
  } catch (err) {
    _log('install_update failed: ' + err, true);
    applyInstallProgress({ status: 'error', error: String(err && err.message ? err.message : err) });
  }
}


let _settings = { ...SETTINGS_DEFAULTS };
let _chatHistory = []; // [{role, content}]

// Read form values into the cfg object (callable any time)
function readSettingsForm() {
  const nmsBaseUrl = document.getElementById('nmsBaseUrl');
  const nmsApiKey  = document.getElementById('nmsApiKey');
  const nmsCookie  = document.getElementById('nmsCookie');
  const aiProvider = document.getElementById('aiProvider');
  const aiBaseUrl  = document.getElementById('aiBaseUrl');
  const aiApiKey   = document.getElementById('aiApiKey');
  const aiModelId  = document.getElementById('aiModelId');
  const aiTimeout  = document.getElementById('aiTimeout');
  return {
    nms: {
      base_url: nmsBaseUrl ? nmsBaseUrl.value.trim() : '',
      api_key:  nmsApiKey  ? nmsApiKey.value.trim()  : '',
      cookie:   nmsCookie  ? nmsCookie.value.trim()   : '',
    },
    ai: {
      provider: aiProvider ? aiProvider.value : 'ark',
      base_url: aiBaseUrl  ? aiBaseUrl.value.trim()  : '',
      api_key:  aiApiKey   ? aiApiKey.value.trim()   : '',
      model_id: aiModelId  ? aiModelId.value.trim()  : '',
      timeout:  aiTimeout  ? (Number(aiTimeout.value) || 120) : 120,
    },
  };
}

// Populate form from a cfg object
function fillSettingsForm(cfg) {
  const $ = (id) => document.getElementById(id);
  const nmsBaseUrl = $('nmsBaseUrl'); if (nmsBaseUrl) nmsBaseUrl.value = cfg.nms.base_url || '';
  const nmsApiKey  = $('nmsApiKey');  if (nmsApiKey)  nmsApiKey.value  = cfg.nms.api_key  || '';
  const nmsCookie  = $('nmsCookie');  if (nmsCookie)  nmsCookie.value  = cfg.nms.cookie   || '';
  const aiProvider = $('aiProvider'); if (aiProvider) aiProvider.value = cfg.ai.provider   || 'ark';
  const aiBaseUrl  = $('aiBaseUrl');  if (aiBaseUrl)  aiBaseUrl.value  = cfg.ai.base_url  || '';
  const aiApiKey   = $('aiApiKey');   if (aiApiKey)   aiApiKey.value   = cfg.ai.api_key   || '';
  const aiModelId  = $('aiModelId');  if (aiModelId)  aiModelId.value  = cfg.ai.model_id  || '';
  const aiTimeout  = $('aiTimeout');  if (aiTimeout)  aiTimeout.value  = cfg.ai.timeout   || 120;
}

function setupSettings() {
  const modal = document.getElementById('settingsModal');
  const btn = document.getElementById('btnSettings');
  const closeBtn = document.getElementById('settingsClose');

  // NMS fields
  const nmsBaseUrl = document.getElementById('nmsBaseUrl');
  const nmsApiKey  = document.getElementById('nmsApiKey');
  const nmsCookie  = document.getElementById('nmsCookie');
  const nmsApiKeyToggle = document.getElementById('nmsApiKeyToggle');

  // AI fields
  const aiProvider = document.getElementById('aiProvider');
  const aiBaseUrl  = document.getElementById('aiBaseUrl');
  const aiApiKey   = document.getElementById('aiApiKey');
  const aiModelId  = document.getElementById('aiModelId');
  const aiTimeout  = document.getElementById('aiTimeout');
  const aiApiKeyToggle = document.getElementById('aiApiKeyToggle');
  const aiTestBtn  = document.getElementById('aiTestBtn');
  const saveBtn    = document.getElementById('saveBtn');
  const aiTestResult = document.getElementById('aiTestResult');
  const clearCacheBtn = document.getElementById('cfgClearCache');
  const cachedEl = document.getElementById('cfgCached');

  // Auto-save: any input change -> debounced 250ms -> write to store.
  // This way the user's edits survive closing & reopening the modal,
  // even if they never click "Save".
  let _autoSaveTimer = null;
  let _autoSaveStatus = null;  // DOM element used to show "自动保存中…" / "已自动保存"
  function autoSaveNow() {
    // immediate (not debounced) — for the Save button + test button
    if (_autoSaveTimer) { clearTimeout(_autoSaveTimer); _autoSaveTimer = null; }
    return doSave();
  }
  function autoSaveDebounced() {
    if (_autoSaveTimer) clearTimeout(_autoSaveTimer);
    if (_autoSaveStatus) _autoSaveStatus.textContent = '自动保存中…';
    _autoSaveTimer = setTimeout(doSave, 250);
  }
  async function doSave() {
    _settings = readSettingsForm();
    const ok = await saveSettings(_settings);
    if (_autoSaveStatus) {
      _autoSaveStatus.textContent = ok ? '已自动保存' : '保存失败';
      setTimeout(() => { if (_autoSaveStatus) _autoSaveStatus.textContent = ''; }, 1500);
    }
    return ok;
  }
  _autoSaveStatus = document.getElementById('autoSaveStatus');

  // Wire input listeners to debounced auto-save
  for (const el of [nmsBaseUrl, nmsApiKey, nmsCookie, aiProvider, aiBaseUrl, aiApiKey, aiModelId, aiTimeout]) {
    if (el) el.addEventListener('input', autoSaveDebounced);
    if (el) el.addEventListener('change', autoSaveDebounced);
  }

  // Update AI fields when provider changes (also auto-saves)
  if (aiProvider) {
    aiProvider.addEventListener('change', () => {
      const p = PROVIDER_PRESETS[aiProvider.value];
      if (p) {
        if (!aiBaseUrl.value || aiBaseUrl.value === '' ||
            Object.values(PROVIDER_PRESETS).some(x => x.baseUrl === aiBaseUrl.value)) {
          aiBaseUrl.value = p.baseUrl;
        }
        if (!aiModelId.value || aiModelId.value === '' ||
            Object.values(PROVIDER_PRESETS).some(x => x.modelId === aiModelId.value)) {
          aiModelId.value = p.modelId;
        }
      }
      autoSaveDebounced();
    });
  }

  if (btn) btn.addEventListener('click', async () => {
    // Form is auto-saved on every change, so opening just needs to
    // re-populate the inputs from the store (which always has the
    // latest values, even if user closed without clicking Save).
    const cfg = await loadSettings();
    _settings = cfg;
    fillSettingsForm(cfg);
    aiTestResult.style.display = 'none';
    if (_autoSaveStatus) _autoSaveStatus.textContent = '';
    cachedEl.textContent = Object.keys(state.packData).length;
    modal.style.display = 'flex';
  });

  if (closeBtn) closeBtn.addEventListener('click', () => { modal.style.display = 'none'; });
  if (modal) modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.style.display = 'none';
  });

  if (nmsApiKeyToggle) nmsApiKeyToggle.addEventListener('click', () => {
    nmsApiKey.type = nmsApiKey.type === 'password' ? 'text' : 'password';
  });
  if (aiApiKeyToggle) aiApiKeyToggle.addEventListener('click', () => {
    aiApiKey.type = aiApiKey.type === 'password' ? 'text' : 'password';
  });

  // Test connection: send a "ping" to the configured AI provider and show result.
  // Uses the current form values (already auto-saved on change) so the user can
  // verify whatever they have on screen.
  if (aiTestBtn) aiTestBtn.addEventListener('click', async () => {
    if (!invoke) {
      aiTestResult.className = 'test-result error';
      aiTestResult.style.display = 'block';
      aiTestResult.textContent = '✗ Tauri invoke 不可用';
      return;
    }
    aiTestBtn.disabled = true;
    aiTestResult.className = 'test-result loading';
    aiTestResult.style.display = 'block';
    aiTestResult.textContent = '测试中…';
    try {
      // Flush any pending auto-save so the backend sees the latest values.
      await autoSaveNow();
      const cfg = readSettingsForm();
      if (!cfg.ai.base_url || !cfg.ai.model_id) {
        throw new Error('请先填写 Base URL 和 Model ID');
      }
      const reply = await invoke('cmd_test_ai', {
        provider: cfg.ai.provider,
        baseUrl:  cfg.ai.base_url,
        apiKey:   cfg.ai.api_key,
        modelId:  cfg.ai.model_id,
      });
      aiTestResult.className = 'test-result success';
      aiTestResult.textContent = '✓ 连接成功 · 回复: ' + (reply || '(空)');
    } catch (err) {
      aiTestResult.className = 'test-result error';
      aiTestResult.textContent = '✗ 连接失败: ' + (err && err.message ? err.message : err);
    } finally {
      aiTestBtn.disabled = false;
    }
  });

  // Save button: force-immediate save (skip debounce) and close.
  // The "auto-save" indicator will confirm the write happened.
  if (saveBtn) saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    try {
      const ok = await autoSaveNow();
      if (ok) {
        toast('设置已保存', 'success');
        refreshApiHost();
        modal.style.display = 'none';
      } else {
        toast('保存失败', 'error');
      }
    } finally {
      saveBtn.disabled = false;
    }
  });

}
// Semantic-group hints: when the user's message matches a pattern, give a small
// boost to packs whose name contains any of the fragments. Format: [RegExp, string[]].
const RELEVANCE_HINTS = [
  // 路由 / 路由器 / 交换机
  [/\b路由|cisco router|路由器/,                ['cisco', 'router', 'juniper', 'h3c', 'huawei', 'ruijie', 'arista']],
  [/\b交换|cisco switch|交换机/,                ['cisco', 'switch', 'aruba', 'huawei', 'h3c', 'ruijie', 'brocade', 'juniper']],
  // 防火墙 / 安全
  [/\b防火墙|firewall|utm|ips\b/,               ['forti', 'fortigate', 'palo', 'sonic', 'hillstone', 'sangfor', 'checkpoint']],
  // 无线 / AP / Wi-Fi
  [/\b无线|wifi|wi-fi|wireless|ap\b/,          ['wireless', 'wifi', 'meraki', 'ruckus', 'aruba', 'cisco']],
  // 服务器 / 操作系统 / Agent
  [/\b服务器|server|主机|linux|windows\b/,      ['linux', 'windows', 'server', 'vmware', 'esx', 'vsphere']],
  // 存储 / 备份
  [/\b存储|备份|storage|backup\b/,              ['storage', 'netapp', 'pure', 'veeam', 'dell', 'powervault', 'data domain']],
  // 数据库 / 中间件
  [/\b数据库|database|mysql|sql|exchange\b/,    ['sql', 'mysql', 'exchange', 'oracle', 'postgres', 'iis']],
  // 云服务
  [/\b云服务|公有云|aws|azure|aliyun|tencent/,  ['aws', 'azure', 'aliyun', 'tencent', 'huawei cloud', 'google cloud']],
  // 厂商直呼
  [/\b思科|cisco\b/,                            ['cisco']],
  [/\b华三|h3c\b/,                              ['h3c']],
  [/\b华为\b/,                                  ['huawei']],
  [/\b阿鲁巴|aruba\b/,                          ['aruba']],
  [/\b戴尔|dell\b/,                             ['dell']],
  [/\b惠普|hpe|hewlett\b/,                      ['hpe', 'hp']],
  [/\b深信服|sangfor\b/,                        ['sangfor']],
  [/\b飞塔|forti|fortigate\b/,                  ['forti', 'fortigate']],
  [/\b派拓|palo alto\b/,                        ['palo alto']],
  [/\b山石|hillstone\b/,                        ['hillstone']],
  [/\b瞻博|juniper\b/,                          ['juniper']],
  [/\b锐捷|ruijie\b/,                           ['ruijie']],
  [/\bvmware|vcenter|vsphere|esxi\b/,          ['vmware', 'esx', 'vsphere', 'aria']],
  [/\bred ?hat|rhel|centos|ubuntu|debian\b/,    ['linux', 'red hat', 'rhel']],
];

function findRelevantPacks(message, packs, limit = 5) {
  if (!message || !packs || !packs.length) return [];
  const msg = String(message);
  const msgLower = msg.toLowerCase();

  // Tokenize: CJK characters each as a token, plus Latin word tokens
  const tokens = [];
  // Latin word tokens (>= 2 chars)
  const latinTokens = msgLower.match(/[a-z][a-z0-9.\-]{1,}/g) || [];
  tokens.push(...latinTokens);
  // CJK character tokens (>= 1 char)
  const cjkTokens = msg.match(/[\u4e00-\u9fff]+/g) || [];
  tokens.push(...cjkTokens);

  // Token aliasing: common CN/EN synonyms
  const aliases = {
    '路由': 'cisco', '交换机': 'cisco', '防火墙': 'forti palo sonic', '无线': 'wireless ap',
    '服务器': 'server windows linux', '存储': 'storage netapp dell', '云': 'aws azure cloud',
    '数据库': 'sql mysql', '华三': 'h3c', '华为': 'huawei', '戴尔': 'dell',
    '思科': 'cisco', '阿鲁巴': 'aruba', '监控': '', '系统': 'windows linux server',
  };
  const extraTokens = [];
  for (const [cn, enAliases] of Object.entries(aliases)) {
    if (msg.includes(cn)) {
      if (enAliases) extraTokens.push(...enAliases.toLowerCase().split(/\s+/));
      else extraTokens.push(cn);
    }
  }
  tokens.push(...extraTokens.filter(t => t.length >= 2));

  const scored = [];
  for (const p of packs) {
    const name = String(p.name || '').toLowerCase();
    const desc = String(p.description || '').toLowerCase();
    let score = 0;
    const reasons = [];

    // 1. Token matching (highest weight)
    for (const t of tokens) {
      if (!t) continue;
      if (name === t) { score += 20; reasons.push(`name==${t}`); }
      else if (name.includes(t)) { score += 10; reasons.push(`name~${t}`); }
      else if (desc.includes(t)) { score += 3; reasons.push(`desc~${t}`); }
    }

    // 2. Hint boost (semantic groups)
    for (const [pattern, fragments] of RELEVANCE_HINTS) {
      if (pattern.test(msg)) {
        for (const f of fragments) {
          if (name.includes(f.toLowerCase())) {
            score += 6;
            reasons.push(`hint:${f}`);
            break; // one boost per pattern
          }
        }
      }
    }

    if (score > 0) scored.push({ pack: p, score, reasons });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(s => s.pack);
}

function setupChat() {
  const fab = document.getElementById('fabAi');
  const win = document.getElementById('chatWindow');
  const closeBtn = document.getElementById('chatClose');
  const clearBtn = document.getElementById('chatClear');
  const sendBtn = document.getElementById('chatSend');
  const input = document.getElementById('chatInput');
  const messagesEl = document.getElementById('chatMessages');
  const suggestionsEl = document.getElementById('chatSuggestions');
  const attachBtn = document.getElementById('chatAttachBtn');
  const fileInput = document.getElementById('chatFileInput');
  const attachmentsEl = document.getElementById('chatAttachments');

  let _welcomeShown = false;
  // { data: base64, media_type: 'image/png' }[]
  let _pendingImages = [];

  const openChat = () => {
    if (!win) return;
    win.style.display = 'flex';
    if (fab) fab.classList.remove('has-unread');
    if (!_welcomeShown && messagesEl && messagesEl.childElementCount === 0) {
      _welcomeShown = true;
      addAssistantMessage(
        `你好!我是 **AdminPack AI 助手**。我可以帮你跨所有厂商查询监控能力,无需先选厂商。\n\n` +
        `试试问我:\n\n` +
        `- \`我有一台 Cisco 2911 路由器,能监控什么?\`\n` +
        `- \`Red Hat Enterprise Linux 9.7 服务器怎么监控?\`\n` +
        `- \`无线 AP 控制器能监控哪些指标?\`\n` +
        `- \`存储相关有哪些 AdminPack?\`\n\n` +
        `下方有快捷问题可以直接点。也可以点击 📎 上传图片。`
      );
    }
    if (input) setTimeout(() => input.focus(), 100);
  };
  const closeChat = () => { if (win) win.style.display = 'none'; };

  if (fab) fab.addEventListener('click', openChat);
  if (closeBtn) closeBtn.addEventListener('click', closeChat);

  // Suggestion chips → fill input + auto-send
  if (suggestionsEl) {
    suggestionsEl.querySelectorAll('.chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const q = chip.dataset.q || chip.textContent.trim();
        if (input) {
          input.value = q;
          input.focus();
          send();
        }
      });
    });
  }

  // === Image attachments ===
  function renderAttachments() {
    if (!attachmentsEl) return;
    if (_pendingImages.length === 0) {
      attachmentsEl.style.display = 'none';
      attachmentsEl.innerHTML = '';
      return;
    }
    attachmentsEl.style.display = 'flex';
    attachmentsEl.innerHTML = _pendingImages.map((img, idx) => `
      <div class="chat-attach-thumb">
        <img src="data:${img.media_type};base64,${img.data}" alt="attachment ${idx+1}">
        <button class="remove" data-idx="${idx}" title="移除">×</button>
      </div>
    `).join('');
    attachmentsEl.querySelectorAll('.remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = Number(btn.dataset.idx);
        _pendingImages.splice(i, 1);
        renderAttachments();
      });
    });
  }

  function handleFiles(fileList) {
    for (const file of fileList) {
      if (!file.type.startsWith('image/')) continue;
      const reader = new FileReader();
      reader.onload = () => {
        // reader.result is a data URL: "data:image/png;base64,XXXX"
        const m = /^data:([^;]+);base64,(.*)$/.exec(reader.result);
        if (!m) return;
        _pendingImages.push({ media_type: m[1], data: m[2] });
        renderAttachments();
      };
      reader.readAsDataURL(file);
    }
  }

  if (attachBtn) attachBtn.addEventListener('click', () => {
    if (fileInput) fileInput.click();
  });
  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      handleFiles(e.target.files || []);
      fileInput.value = ''; // allow re-selecting same file
    });
  }

  // Drag & drop on chat window
  if (win) {
    win.addEventListener('dragover', (e) => {
      e.preventDefault();
      win.classList.add('drop-active');
    });
    win.addEventListener('dragleave', (e) => {
      if (e.target === win) win.classList.remove('drop-active');
    });
    win.addEventListener('drop', (e) => {
      e.preventDefault();
      win.classList.remove('drop-active');
      const files = e.dataTransfer?.files;
      if (files) handleFiles(files);
    });
  }

  if (clearBtn) clearBtn.addEventListener('click', () => {
    _chatHistory = [];
    if (messagesEl) messagesEl.innerHTML = '';
    _welcomeShown = false;
    _pendingImages = [];
    renderAttachments();
    addAssistantMessage('对话已清空。继续问我吧!');
  });

  function addUserMessage(text, images) {
    const d = document.createElement('div');
    d.className = 'chat-msg user' + (images && images.length ? ' has-image' : '');
    const textEl = document.createElement('div');
    textEl.textContent = text;
    d.appendChild(textEl);
    if (images && images.length) {
      images.forEach((img, i) => {
        const im = document.createElement('img');
        im.className = 'chat-img';
        im.src = `data:${img.media_type};base64,${img.data}`;
        d.appendChild(im);
      });
    }
    messagesEl.appendChild(d);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    _chatHistory.push({ role: 'user', content: text });
  }
  function addAssistantMessage(text) {
    const d = document.createElement('div');
    d.className = 'chat-msg assistant md-content';
    d.innerHTML = renderMarkdown(text);
    messagesEl.appendChild(d);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    if (fab) fab.classList.add('has-unread');
    _chatHistory.push({ role: 'assistant', content: text });
  }
  function addErrorMessage(text) {
    const d = document.createElement('div');
    d.className = 'chat-msg error';
    d.textContent = text;
    messagesEl.appendChild(d);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
  function addThinking() {
    const d = document.createElement('div');
    d.className = 'chat-msg thinking';
    d.id = 'chatThinking';
    d.textContent = '思考中';
    messagesEl.appendChild(d);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return d;
  }

  async function send() {
    const text = (input.value || '').trim();
    if (!text && _pendingImages.length === 0) return;
    if (!invoke) {
      addErrorMessage('Tauri invoke 不可用,请重启应用');
      return;
    }
    const cfg = await loadSettings();
    if (!cfg.ai.base_url || !cfg.ai.model_id) {
      addErrorMessage('请先在 ⚙ 设置中配置 AI 模型');
      const m = document.getElementById('settingsModal');
      if (m) m.style.display = 'flex';
      return;
    }

    const imagesToSend = _pendingImages.slice();
    input.value = '';
    _pendingImages = [];
    renderAttachments();
    addUserMessage(text, imagesToSend);
    const thinkingEl = addThinking();
    sendBtn.disabled = true;

    try {
      const relevant = findRelevantPacks(text, state.packs, 5);
      const relevantIds = relevant.map(p => Number(p.admin_pack_id ?? p.AdminPackId)).filter(Boolean);
      _log(`chat: matched ${relevant.length} packs: ${relevant.map(p => p.name).join(', ')}`);

      const reply = await invoke('cmd_ai_chat_global', {
        userMessage: text,
        history: _chatHistory.slice(0, -1),
        images: imagesToSend.map(img => ({ data: img.data, mediaType: img.media_type })),
        relevantPackIds: relevantIds,
        nms: nmsConfigForBackend(cfg),
        provider: cfg.ai.provider,
        baseUrl: cfg.ai.base_url,
        apiKey: cfg.ai.api_key,
        modelId: cfg.ai.model_id,
        timeoutSecs: cfg.ai.timeout || 120,
      });
      thinkingEl.remove();
      addAssistantMessage(reply);
    } catch (err) {
      thinkingEl.remove();
      addErrorMessage('请求失败: ' + err);
    } finally {
      sendBtn.disabled = false;
      input.focus();
    }
  }

  if (sendBtn) sendBtn.addEventListener('click', send);
  if (input) input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
}

async function updateCacheStats() {
  try {
    if (!invoke) return;
    const stats = await invoke('cache_stats');
    const c = document.getElementById('cachedCount');
    const t = document.getElementById('totalCount');
    if (c) c.textContent = stats.cached ?? 0;
    if (t) t.textContent = state.packs.length;
  } catch { /* ignore */ }
}

async function loadPacks() {
  _log('loadPacks start');
  setStatus('加载厂商列表…', 'busy');
  const btn = document.getElementById('btnRefresh');
  if (btn) btn.classList.add('loading');
  try {
    if (!invoke) throw new Error('invoke 不可用');
    const cfg = await loadSettings();
    if (!cfg.nms.base_url || !cfg.nms.api_key) {
      toast('请先在 ⚙ 设置中配置 NMS 端点', 'warning', 5000);
      setStatus('未配置 NMS', 'error');
      return;
    }
    const data = await invoke('list_admin_packs', { nms: nmsConfigForBackend(cfg) });
    _log(`list_admin_packs returned ${Array.isArray(data) ? data.length : typeof data} items`);
    state.packs = (Array.isArray(data) ? data : []).map(p => ({
      admin_pack_id: p.AdminPackId ?? p.admin_pack_id,
      source_system_identifier: p.SourceSystemIdentifier,
      source_address: p.SourceAddress,
      unique_id: p.UniqueId,
      version: p.Version,
      name: p.Name,
      description: p.Description,
      is_imported: p.IsImported,
      is_public: p.IsPublic,
      latest_version_applied: p.LatestVersionApplied,
      minimum_platform_version: p.MinimumPlatformVersion,
      created_utc: p.CreatedUtc,
    }));
    renderVendorList();
    setStatus(`已加载 ${state.packs.length} 个厂商`, 'idle');
    toast(`已加载 ${state.packs.length} 个厂商`, 'success');
  } catch (err) {
    _log(`loadPacks failed: ${err}`, true);
    setStatus('加载失败', 'error');
    toast(`加载失败: ${err}`, 'error', 5000);
  } finally {
    if (btn) btn.classList.remove('loading');
  }
}

// ============================================================
// PRELOAD OVERLAY (progress bar modal)
// ============================================================
function showPreloadOverlay(total) {
  const overlay = document.getElementById('preloadOverlay');
  if (!overlay) return;
  const card = overlay.querySelector('.preload-card');
  if (card) card.classList.remove('done');
  overlay.classList.remove('closing');
  overlay.style.display = 'flex';
  setPreloadProgress(0, total, '准备中...');
}
function setPreloadProgress(completed, total, currentName) {
  const overlay = document.getElementById('preloadOverlay');
  if (!overlay) return;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const fill = document.getElementById('preloadBarFill');
  const done = document.getElementById('preloadCompleted');
  const tot = document.getElementById('preloadTotal');
  const pctEl = document.getElementById('preloadPercent');
  const curEl = document.getElementById('preloadCurrentVendor');
  const card = overlay.querySelector('.preload-card');
  if (fill) fill.style.width = pct + '%';
  if (done) done.textContent = completed;
  if (tot) tot.textContent = total;
  if (pctEl) pctEl.textContent = pct;
  if (curEl) curEl.textContent = currentName || '';
  if (completed >= total && total > 0) {
    if (card) card.classList.add('done');
    if (curEl) curEl.textContent = '完成!';
  }
}
function hidePreloadOverlay(afterMs = 600) {
  const overlay = document.getElementById('preloadOverlay');
  if (!overlay) return;
  setTimeout(() => {
    overlay.classList.add('closing');
    setTimeout(() => { overlay.style.display = 'none'; overlay.classList.remove('closing'); }, 400);
  }, afterMs);
}

// One-click: load pack list (if needed) + preload all + show progress bar
async function refreshAndPreloadAll() {
  const btn = document.getElementById('btnRefresh');
  if (btn) btn.classList.add('loading');
  setStatus('准备中…', 'busy');
  try {
    const cfg = await loadSettings();
    if (!cfg.nms.base_url || !cfg.nms.api_key) {
      toast('请先在 ⚙ 设置中配置 NMS 端点', 'warning', 5000);
      const m = document.getElementById('settingsModal');
      if (m) m.style.display = 'flex';
      return;
    }
    if (!state.packs.length) {
      await loadPacks();
    }
    if (!state.packs.length) {
      toast('厂商列表为空,无法预加载', 'error');
      return;
    }
    const total = state.packs.length;
    showPreloadOverlay(total);
    try {
      await invoke('preload_all', { nms: nmsConfigForBackend(cfg) });
      setPreloadProgress(total, total, '完成!');
      setStatus(`已缓存 ${total} 个厂商`, 'idle');
      toast(`已缓存 ${total} 个厂商的监控数据`, 'success');
      hidePreloadOverlay();
    } catch (err) {
      hidePreloadOverlay(0);
      setStatus('预加载失败', 'error');
      toast(`预加载失败: ${err}`, 'error', 5000);
      // Detailed diagnostic in the 日志 panel (incl. HTTP status / body / url).
      const detail = (err && err.stack) ? err.stack : String(err);
      _log(`预加载失败 (detail): ${detail}`, true);
      _log(`提示:打开左下角"日志"菜单可查看完整响应内容`, true);
    }
    await updateCacheStats();
  } finally {
    if (btn) btn.classList.remove('loading');
  }
}

// ============================================================
// INIT
// ============================================================
function init() {
  _log('init start');
  setupTabs();
  setupSidebarTabs();
  setupSearch();
  setupStatusTabs();
  setupRawActions();
  setupSettings();
  setupChat();
  setupUpdate();

  const r = document.getElementById('btnRefresh');
  if (r) r.addEventListener('click', () => refreshAndPreloadAll());
  // settings button click is wired up inside setupSettings()

  if (listen) {
    listen('preload:progress', (evt) => {
      const { completed, total, current } = evt.payload || {};
      setPreloadProgress(completed || 0, total || 0, current || '');
      setStatus(`预加载 ${completed}/${total}  ${current}`, 'busy');
    }).catch(err => _log('listen failed: ' + err, true));
  }

  loadPacks().then(() => { updateCacheStats(); refreshApiHost(); refreshAppVersion(); });
  // App version doesn't depend on NMS, set it eagerly so the titlebar
  // doesn't flicker through "v—".
  refreshAppVersion();
}

window.toggleSection = toggleSection;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}