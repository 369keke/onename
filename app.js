// OneName — 手机上的 AI 角色聊天。纯前端，数据只存在本机浏览器。
const WLLAMA_VERSION = '3.8.1';
const WLLAMA_BASE = `https://cdn.jsdelivr.net/npm/@wllama/wllama@${WLLAMA_VERSION}/esm/`;

const DEFAULT_SYSTEM = `你现在要进行一场沉浸式角色扮演。你扮演{{char}}，和{{user}}对话。
规则：
- 始终以{{char}}的身份、语气和性格说话，不要跳出角色，不要提到自己是 AI。
- 动作、神态和环境描写放在 *星号* 里，对话直接写。
- 回复生动具体，主动推动剧情，但不要替{{user}}说话或做决定。
- 用中文回复。`;

const DEFAULT_SETTINGS = {
  username: '你',
  backend: 'local',
  modelUrl: '',
  nCtx: 4096,
  gpu: 'auto',
  apiBase: '',
  apiKey: '',
  apiModel: '',
  temperature: 0.9,
  maxTokens: 400,
  system: DEFAULT_SYSTEM,
};

// ---------- storage ----------
const LS = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); }
    catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { toast('保存失败：浏览器存储空间不足'); console.error(e); return false; }
  },
  del(key) { try { localStorage.removeItem(key); } catch {} },
};

let settings = { ...DEFAULT_SETTINGS, ...LS.get('on.settings', {}) };
let chars = LS.get('on.chars', []);
const saveSettings = () => LS.set('on.settings', settings);
const saveChars = () => LS.set('on.chars', chars);
const loadChat = (id) => LS.get('on.chat.' + id, null);
const saveChat = (id, msgs) => LS.set('on.chat.' + id, msgs);

// ---------- helpers ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let toastTimer;
function toast(text, ms = 2600) {
  const el = $('#toast');
  el.textContent = text; el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), ms);
}

function download(name, text, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function fill(text, char) {
  return String(text || '')
    .replaceAll('{{char}}', char?.name || '角色')
    .replaceAll('{{user}}', settings.username || '你');
}

// Render roleplay text: *动作* -> <em>
function renderText(text) {
  return esc(text).replace(/\*([^*\n]+)\*/g, '<em>*$1*</em>');
}

function avatarHTML(char) {
  if (char?.avatar) return '';
  return esc((char?.name || '?').slice(0, 1));
}
function paintAvatar(el, char) {
  el.style.backgroundImage = char?.avatar ? `url("${char.avatar}")` : '';
  el.innerHTML = avatarHTML(char);
}

// ---------- adult-only guard ----------
// 所有角色必须是成年人。这里做硬性检查，不能关闭。
const MINOR_PATTERNS = [
  /萝莉|幼女|幼童|幼儿|正太|儿童|小学生|初中生|中学生|未成年|小女孩|小男孩|女童|男童|稚童/,
  /\b(loli|lolita|shota|shotacon|lolicon|underage|preteen|pre-teen|toddler|minor girl|minor boy)\b/i,
];
function findMinorIssue(c) {
  const age = Number(c.age);
  if (!Number.isFinite(age) || age < 18) return '角色年龄必须填写，并且不小于 18 岁。';
  const text = [c.name, c.tagline, c.persona, c.scenario, c.greeting, c.examples].join('\n');
  for (const re of MINOR_PATTERNS) {
    const m = text.match(re);
    if (m) return `设定里出现了涉及未成年人的词「${m[0]}」。本应用只允许成年角色，请修改。`;
  }
  for (const m of text.matchAll(/(?<![\d.])(\d{1,2})\s*(?:岁|歲|years?\s*old|yo\b)/gi)) {
    if (Number(m[1]) < 18) return `设定里出现了「${m[0]}」。本应用只允许成年角色，请修改。`;
  }
  const cn = text.match(/(?<![一二三四五六七八九十百千])(十[一二三四五六七]|[一二三四五六七八九])\s*[岁歲]/);
  if (cn) return `设定里出现了「${cn[0]}」。本应用只允许成年角色，请修改。`;
  return null;
}

// ---------- routing ----------
let current = null; // current character id in chat
function go(view) {
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + view));
  $('#chat-menu').hidden = true;
  if (view === 'home') renderHome();
  if (view === 'settings') renderSettings();
}
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-go]');
  if (t) go(t.dataset.go);
});

// ---------- home ----------
function renderHome() {
  const list = $('#char-list');
  if (!chars.length) {
    list.innerHTML = `<div class="empty">还没有角色。<br>点右下角「新建角色」，或导入一张角色卡。</div>`;
    return;
  }
  const sorted = [...chars].sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0));
  list.innerHTML = '';
  for (const c of sorted) {
    const card = document.createElement('div');
    card.className = 'char-card';
    card.innerHTML = `<div class="avatar"></div><div class="meta"><b>${esc(c.name)}</b><small>${esc(c.tagline || c.persona || '')}</small></div>`;
    paintAvatar($('.avatar', card), c);
    card.onclick = () => openChat(c.id);
    list.appendChild(card);
  }
}

// ---------- edit character ----------
let editing = null; // character object being edited (may be unsaved)
let pendingAvatar = null;

function openEditor(char) {
  editing = char ? { ...char } : { id: uid() };
  pendingAvatar = editing.avatar || null;
  const f = $('#char-form');
  for (const k of ['name', 'age', 'tagline', 'persona', 'scenario', 'greeting', 'examples']) f.elements[k].value = editing[k] ?? '';
  $('#edit-title').textContent = chars.some((c) => c.id === editing.id) ? '编辑角色' : '新建角色';
  $('#btn-del-char').hidden = !chars.some((c) => c.id === editing.id);
  $('#form-error').hidden = true;
  const av = $('#avatar-preview');
  av.style.backgroundImage = pendingAvatar ? `url("${pendingAvatar}")` : '';
  $('span', av).hidden = !!pendingAvatar;
  go('edit');
  $('.form', $('#view-edit')).scrollTop = 0;
}

$('#btn-new-char').onclick = () => openEditor(null);

$('#avatar-input').onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    pendingAvatar = await resizeImage(file, 192);
    const av = $('#avatar-preview');
    av.style.backgroundImage = `url("${pendingAvatar}")`;
    $('span', av).hidden = true;
  } catch { toast('图片读取失败'); }
};

function resizeImage(file, size) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(img.width, img.height);
      const cv = document.createElement('canvas');
      cv.width = cv.height = size;
      cv.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
      URL.revokeObjectURL(img.src);
      resolve(cv.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

$('#char-form').onsubmit = (e) => {
  e.preventDefault();
  const f = e.target;
  const data = { ...editing };
  for (const k of ['name', 'tagline', 'persona', 'scenario', 'greeting', 'examples']) data[k] = f.elements[k].value.trim();
  data.age = Number(f.elements.age.value);
  data.avatar = pendingAvatar;
  const issue = findMinorIssue(data);
  if (issue) {
    const err = $('#form-error');
    err.textContent = issue; err.hidden = false;
    err.scrollIntoView({ block: 'center' });
    return;
  }
  const i = chars.findIndex((c) => c.id === data.id);
  if (i >= 0) chars[i] = data; else chars.push(data);
  if (!saveChars()) return;
  toast('已保存');
  openChat(data.id);
};

$('#btn-del-char').onclick = () => {
  if (!editing || !confirm(`删除「${editing.name}」和它的全部聊天记录？`)) return;
  chars = chars.filter((c) => c.id !== editing.id);
  saveChars();
  LS.del('on.chat.' + editing.id);
  go('home');
};

// ---------- character card import (SillyTavern / TavernAI PNG or JSON) ----------
$('#import-card').onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    let card, avatar = null;
    if (file.type === 'image/png' || file.name.toLowerCase().endsWith('.png')) {
      const buf = new Uint8Array(await file.arrayBuffer());
      const raw = readPngText(buf, ['ccv3', 'chara']);
      if (!raw) throw new Error('这张图片里没有角色卡数据');
      card = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(raw), (c) => c.charCodeAt(0))));
      avatar = await resizeImage(file, 192);
    } else {
      card = JSON.parse(await file.text());
    }
    const d = card.data || card;
    const persona = [d.description, d.personality].filter(Boolean).join('\n\n');
    openEditor({
      id: uid(),
      name: d.name || d.char_name || '',
      age: '',
      tagline: (d.creator_notes || '').split('\n')[0].slice(0, 80),
      persona: persona || d.char_persona || '',
      scenario: d.scenario || d.world_scenario || '',
      greeting: d.first_mes || d.char_greeting || '',
      examples: d.mes_example || d.example_dialogue || '',
      avatar,
    });
    toast('已导入，请填写年龄并检查后保存');
  } catch (err) {
    console.error(err);
    toast('导入失败：' + (err.message || '格式不支持'));
  }
};

function readPngText(buf, keys) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const found = {};
  let p = 8;
  while (p + 8 <= buf.length) {
    const len = dv.getUint32(p);
    const type = String.fromCharCode(...buf.subarray(p + 4, p + 8));
    if (type === 'tEXt') {
      const chunk = buf.subarray(p + 8, p + 8 + len);
      const zero = chunk.indexOf(0);
      const key = new TextDecoder('latin1').decode(chunk.subarray(0, zero));
      found[key] = new TextDecoder('latin1').decode(chunk.subarray(zero + 1));
    }
    if (type === 'IEND') break;
    p += 12 + len;
  }
  for (const k of keys) if (found[k]) return found[k];
  return null;
}

// ---------- chat ----------
let messages = [];
let generating = null; // AbortController while a reply is streaming

function openChat(id) {
  const c = chars.find((x) => x.id === id);
  if (!c) return go('home');
  current = id;
  c.lastUsed = Date.now();
  saveChars();
  messages = loadChat(id) || [];
  if (!messages.length && c.greeting) {
    messages.push({ role: 'assistant', content: c.greeting });
    saveChat(id, messages);
  }
  $('#chat-name').textContent = c.name;
  paintAvatar($('#chat-avatar'), c);
  go('chat');
  renderMessages();
}

const curChar = () => chars.find((c) => c.id === current);

function renderMessages() {
  const box = $('#messages');
  box.innerHTML = '';
  messages.forEach((m) => box.appendChild(msgEl(m)));
  if (!messages.length) box.innerHTML = '<div class="empty">开始聊天吧</div>';
  box.scrollTop = box.scrollHeight;
}

function msgEl(m) {
  const row = document.createElement('div');
  row.className = 'msg ' + (m.role === 'user' ? 'user' : 'bot');
  const b = document.createElement('div');
  b.className = 'bubble';
  b.innerHTML = renderText(fill(m.content, curChar()));
  if (m.role !== 'user') {
    const av = document.createElement('div');
    av.className = 'avatar small';
    paintAvatar(av, curChar());
    row.appendChild(av);
  }
  row.appendChild(b);
  return row;
}

const input = $('#input');
input.addEventListener('input', () => {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 140) + 'px';
});

$('#composer').onsubmit = async (e) => {
  e.preventDefault();
  if (generating) { generating.abort(); return; }
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  input.style.height = 'auto';
  messages.push({ role: 'user', content: text });
  saveChat(current, messages);
  renderMessages();
  await reply();
};

async function reply() {
  const char = curChar();
  const box = $('#messages');
  const placeholder = { role: 'assistant', content: '' };
  const row = msgEl(placeholder);
  const bubble = $('.bubble', row);
  bubble.classList.add('typing');
  box.appendChild(row);
  box.scrollTop = box.scrollHeight;

  const ctrl = new AbortController();
  generating = ctrl;
  $('#btn-send').textContent = '停止';

  let out = '';
  try {
    // If the history doesn't fit the context window, retry with less of it.
    for (let shrink = 1; ; shrink /= 2) {
      try {
        for await (const piece of engine.generate(buildPrompt(char, shrink), ctrl.signal)) {
          out += piece;
          bubble.innerHTML = renderText(out);
          const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
          if (nearBottom) box.scrollTop = box.scrollHeight;
        }
        break;
      } catch (err) {
        if (out || shrink < 0.1 || !/exceed|context|too long|maximum context/i.test(err.message || '')) throw err;
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError' && !ctrl.signal.aborted) {
      console.error(err);
      bubble.classList.remove('typing');
      bubble.classList.add('err');
      bubble.textContent = '出错了：' + (err.message || err);
      generating = null;
      $('#btn-send').textContent = '发送';
      return;
    }
  }
  bubble.classList.remove('typing');
  generating = null;
  $('#btn-send').textContent = '发送';
  out = out.trim();
  if (out) {
    messages.push({ role: 'assistant', content: out });
    saveChat(current, messages);
  } else {
    row.remove();
  }
}

// Approximate token count: CJK ≈ 1 token per char, other text ≈ 1 token per 3.5 chars.
function estTokens(s) {
  const cjk = (s.match(/[　-鿿가-힯＀-￯]/g) || []).length;
  return Math.ceil(cjk * 1.1 + (s.length - cjk) / 3) + 6;
}

function buildPrompt(char, shrink = 1) {
  const parts = [fill(settings.system || DEFAULT_SYSTEM, char)];
  parts.push(`\n【角色】${char.name}，${char.age} 岁，成年人。`);
  if (char.persona) parts.push(`【设定】\n${fill(char.persona, char)}`);
  if (char.scenario) parts.push(`【场景】\n${fill(char.scenario, char)}`);
  if (char.examples) parts.push(`【说话风格示例】\n${fill(char.examples, char)}`);
  const system = parts.join('\n');

  const ctx = settings.backend === 'local' ? local.contextSize() : 32000;
  let budget = Math.floor((ctx - Number(settings.maxTokens || 400) - estTokens(system) - 32) * shrink);
  const kept = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const t = estTokens(messages[i].content);
    if (t > budget && kept.length) break;
    budget -= t;
    kept.unshift({ role: messages[i].role, content: fill(messages[i].content, char) });
  }
  // Most chat templates expect the first non-system turn to be the user.
  if (kept[0]?.role === 'assistant') kept.unshift({ role: 'user', content: '（开始）' });
  return [{ role: 'system', content: system }, ...kept];
}

// chat menu
$('#btn-chat-menu').onclick = (e) => { e.stopPropagation(); $('#chat-menu').hidden = !$('#chat-menu').hidden; };
document.addEventListener('click', (e) => { if (!e.target.closest('#chat-menu')) $('#chat-menu').hidden = true; });
$('#chat-menu').onclick = async (e) => {
  const act = e.target.dataset.act;
  if (!act) return;
  $('#chat-menu').hidden = true;
  if (generating && act !== 'edit' && act !== 'export') { toast('正在生成，先点停止'); return; }
  const char = curChar();
  if (act === 'edit') openEditor(char);
  if (act === 'regen') {
    if (messages.at(-1)?.role !== 'assistant' || messages.length < 2) { toast('没有可以重新生成的回复'); return; }
    messages.pop(); saveChat(current, messages); renderMessages(); await reply();
  }
  if (act === 'undo') {
    while (messages.length && messages.at(-1).role === 'assistant') messages.pop();
    if (messages.length && messages.at(-1).role === 'user') messages.pop();
    if (!messages.length && char.greeting) messages.push({ role: 'assistant', content: char.greeting });
    saveChat(current, messages); renderMessages();
  }
  if (act === 'export') {
    const txt = messages.map((m) => `${m.role === 'user' ? settings.username : char.name}：${fill(m.content, char)}`).join('\n\n');
    download(`${char.name}-聊天记录.txt`, txt, 'text/plain');
  }
  if (act === 'clear') {
    if (!confirm('清空和这个角色的全部聊天？')) return;
    messages = char.greeting ? [{ role: 'assistant', content: char.greeting }] : [];
    saveChat(current, messages); renderMessages();
  }
};

// ---------- engines ----------
const status = (text, cls = '') => {
  const el = $('#model-status');
  el.textContent = text;
  el.className = 'status-pill ' + cls;
};

const local = {
  wllama: null,
  loaded: false,
  loading: null,
  label: '',

  async ensureLib() {
    if (this.wllama) return this.wllama;
    const mod = await import(WLLAMA_BASE + 'index.js');
    this.wllama = new mod.Wllama({ default: WLLAMA_BASE + 'wasm/wllama.wasm' }, { suppressNativeLog: true, allowOffline: true });
    return this.wllama;
  },

  contextSize() {
    try { if (this.loaded) return this.wllama.getLoadedContextInfo().n_ctx; } catch {}
    return Number(settings.nCtx) || 4096;
  },

  params() {
    const p = { n_ctx: Number(settings.nCtx) || 4096 };
    if (settings.gpu === 'off') p.n_gpu_layers = 0;
    return p;
  },

  async load(source) {
    if (this.loading) throw new Error('模型正在加载中');
    const bar = $('#load-progress');
    const setBar = (frac, text) => {
      bar.hidden = false;
      $('div', bar).style.width = Math.round(frac * 100) + '%';
      $('span', bar).textContent = text;
    };
    this.loading = (async () => {
      const w = await this.ensureLib();
      if (this.loaded) { await w.exit(); this.wllama = null; this.loaded = false; await this.ensureLib(); }
      const wl = this.wllama;
      status('正在加载模型…', 'busy');
      if (source instanceof Blob) {
        const magic = new TextDecoder().decode(await source.slice(0, 4).arrayBuffer());
        if (magic !== 'GGUF') throw new Error('这不是有效的 GGUF 模型文件');
        this.label = source.name || '本地文件';
        setBar(0.5, '正在读取文件并加载…');
        await wl.loadModel([source], this.params());
      } else {
        this.label = decodeURIComponent(source.split('/').pop().split('?')[0]);
        await wl.loadModelFromUrl(source, {
          ...this.params(),
          progressCallback: ({ loaded, total }) => {
            const f = total ? loaded / total : 0;
            setBar(f, `下载中 ${(loaded / 1048576).toFixed(0)} / ${(total / 1048576).toFixed(0)} MB`);
            status(`下载模型 ${Math.round(f * 100)}%`, 'busy');
          },
        });
      }
      if (!wl.isModelLoaded()) throw new Error('模型没有加载成功');
      this.loaded = true;
      const threads = wl.isMultithread() ? `${wl.getNumThreads()} 线程` : '单线程';
      setBar(1, '加载完成');
      status(`✓ 本地模型：${this.label}（${threads}）`, 'ok');
    })();
    try { await this.loading; }
    catch (err) {
      this.loaded = false;
      status('模型加载失败 · 点这里重试', '');
      setBar(0, '加载失败：' + (err.message || err));
      throw err;
    } finally { this.loading = null; }
  },

  async *generate(msgs, signal) {
    if (!this.loaded) {
      if (this.loading) await this.loading;
      else if (settings.modelUrl) { toast('正在加载上次的模型…'); await this.load(settings.modelUrl); }
      else throw new Error('还没有加载模型，请到设置里选择模型');
    }
    const stream = await this.wllama.createChatCompletion({
      messages: msgs,
      stream: true,
      abortSignal: signal,
      temperature: Number(settings.temperature),
      max_tokens: Number(settings.maxTokens),
    });
    for await (const chunk of stream) {
      const piece = chunk?.choices?.[0]?.delta?.content;
      if (piece) yield piece;
    }
  },
};

const api = {
  async *generate(msgs, signal) {
    if (!settings.apiBase || !settings.apiModel) throw new Error('请先在设置里填写接口地址和模型名');
    const url = settings.apiBase.replace(/\/+$/, '') + '/chat/completions';
    const headers = { 'Content-Type': 'application/json' };
    if (settings.apiKey) headers.Authorization = 'Bearer ' + settings.apiKey;
    const res = await fetch(url, {
      method: 'POST', headers, signal,
      body: JSON.stringify({
        model: settings.apiModel, messages: msgs, stream: true,
        temperature: Number(settings.temperature), max_tokens: Number(settings.maxTokens),
      }),
    });
    if (!res.ok) throw new Error(`接口返回 ${res.status}：${(await res.text()).slice(0, 200)}`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        const l = line.trim();
        if (!l.startsWith('data:')) continue;
        const data = l.slice(5).trim();
        if (data === '[DONE]') return;
        try {
          const piece = JSON.parse(data).choices?.[0]?.delta?.content;
          if (piece) yield piece;
        } catch {}
      }
    }
  },
};

const engine = {
  generate(msgs, signal) {
    return settings.backend === 'api' ? api.generate(msgs, signal) : local.generate(msgs, signal);
  },
};

function refreshStatus() {
  if (settings.backend === 'api') {
    status(settings.apiModel ? `✓ 在线 API：${settings.apiModel}` : '在线 API 未设置 · 点这里设置', settings.apiModel ? 'ok' : '');
  } else if (local.loaded) {
    status(`✓ 本地模型：${local.label}`, 'ok');
  } else if (!local.loading) {
    status(settings.modelUrl ? '本地模型未加载（发消息时自动加载）' : '未加载模型 · 点这里设置');
  }
}

// ---------- settings ----------
function renderSettings() {
  $('#set-username').value = settings.username;
  $('#set-model-url').value = settings.modelUrl;
  $('#set-nctx').value = settings.nCtx;
  $('#set-gpu').value = settings.gpu;
  $('#set-api-base').value = settings.apiBase;
  $('#set-api-key').value = settings.apiKey;
  $('#set-api-model').value = settings.apiModel;
  $('#set-temp').value = settings.temperature;
  $('#out-temp').textContent = settings.temperature;
  $('#set-maxtok').value = settings.maxTokens;
  $('#set-system').value = settings.system;
  setBackendUI();
}

function setBackendUI() {
  $$('#backend-seg button').forEach((b) => b.classList.toggle('on', b.dataset.backend === settings.backend));
  $('#backend-local').hidden = settings.backend !== 'local';
  $('#backend-api').hidden = settings.backend !== 'api';
}

$('#backend-seg').onclick = (e) => {
  const b = e.target.dataset.backend;
  if (!b) return;
  settings.backend = b; saveSettings(); setBackendUI(); refreshStatus();
};

const bind = (sel, key, conv = (v) => v) => {
  $(sel).addEventListener('change', (e) => { settings[key] = conv(e.target.value); saveSettings(); refreshStatus(); });
};
bind('#set-username', 'username', (v) => v.trim() || '你');
bind('#set-model-url', 'modelUrl', (v) => v.trim());
bind('#set-nctx', 'nCtx', Number);
bind('#set-gpu', 'gpu');
bind('#set-api-base', 'apiBase', (v) => v.trim());
bind('#set-api-key', 'apiKey', (v) => v.trim());
bind('#set-api-model', 'apiModel', (v) => v.trim());
bind('#set-maxtok', 'maxTokens', Number);
bind('#set-system', 'system');
$('#set-temp').addEventListener('input', (e) => { $('#out-temp').textContent = e.target.value; });
bind('#set-temp', 'temperature', Number);
$('#btn-reset-system').onclick = () => { settings.system = DEFAULT_SYSTEM; $('#set-system').value = DEFAULT_SYSTEM; saveSettings(); };

$('#btn-load-url').onclick = async () => {
  let url = $('#set-model-url').value.trim();
  if (!url) { toast('先填模型下载地址'); return; }
  // Accept a Hugging Face page link (".../blob/main/x.gguf") and turn it into a download link.
  url = url.replace(/^(https:\/\/huggingface\.co\/[^/]+\/[^/]+)\/blob\//, '$1/resolve/');
  if (!/\.gguf(\?|$)/i.test(url)) { toast('地址需要指向 .gguf 文件'); return; }
  settings.modelUrl = url; saveSettings();
  $('#set-model-url').value = url;
  const btn = $('#btn-load-url');
  btn.disabled = true;
  try { await local.load(url); toast('模型加载完成，可以开始聊天了'); }
  catch (err) { console.error(err); toast('加载失败：' + (err.message || err), 5000); }
  finally { btn.disabled = false; }
};

$('#model-file').onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (file.size > 2 * 1024 ** 3) toast('文件超过 2GB，浏览器可能加载失败，建议换小一点的模型', 5000);
  try { await local.load(file); toast('模型加载完成，可以开始聊天了'); }
  catch (err) { console.error(err); toast('加载失败：' + (err.message || err), 5000); }
};

$('#btn-clear-cache').onclick = async () => {
  if (!confirm('删除已下载缓存的模型文件？下次需要重新下载。')) return;
  try {
    const w = await local.ensureLib();
    await w.cacheManager.clear();
    toast('已清除模型缓存');
  } catch (err) { console.error(err); toast('清除失败：' + err.message); }
};

$('#btn-backup').onclick = () => {
  const data = { version: 1, settings: { ...settings, apiKey: '' }, chars, chats: {} };
  for (const c of chars) data.chats[c.id] = loadChat(c.id) || [];
  download(`onename-备份-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data));
};

$('#restore-file').onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.chars)) throw new Error('不是有效的备份文件');
    const ok = data.chars.filter((c) => !findMinorIssue(c));
    if (!confirm(`将导入 ${ok.length} 个角色（同 ID 会覆盖），继续？`)) return;
    for (const c of ok) {
      const i = chars.findIndex((x) => x.id === c.id);
      if (i >= 0) chars[i] = c; else chars.push(c);
      if (data.chats?.[c.id]) saveChat(c.id, data.chats[c.id]);
    }
    saveChars();
    if (data.settings) { settings = { ...settings, ...data.settings, apiKey: settings.apiKey }; saveSettings(); }
    toast('恢复完成');
    renderSettings();
  } catch (err) { toast('恢复失败：' + err.message); }
};

// ---------- boot ----------
renderHome();
refreshStatus();
if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
