/* 人际关系图谱 · EdgeEver 插件 · 由 build.mjs 生成，请勿直接修改此文件 */

// src/crypto.ts
var KDF_ITERATIONS = 15e4;
var VERIFY_PLAINTEXT = "EDGEEVER-SOCIAL-GRAPH-VAULT-OK";
function subtle() {
  const c = globalThis.crypto;
  if (!c || !c.subtle) {
    throw new Error("当前运行环境不支持 WebCrypto，无法启用加密模式。");
  }
  return c.subtle;
}
var bs = (u) => u;
function randomBytes(n) {
  const c = globalThis.crypto;
  const out = new Uint8Array(n);
  if (c && typeof c.getRandomValues === "function") return c.getRandomValues(out);
  for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
  return out;
}
function b64encode(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function b64decode(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function deriveKey(password, salt, iterations) {
  const s = subtle();
  const base = await s.importKey(
    "raw",
    bs(new TextEncoder().encode(password)),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return s.deriveKey(
    { name: "PBKDF2", salt: bs(salt), iterations, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}
async function encryptBytes(key, data) {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv }, key, bs(data)));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return b64encode(out);
}
async function decryptBytes(key, payload) {
  try {
    const raw = b64decode(payload);
    if (raw.length <= 12) return null;
    const iv = raw.slice(0, 12);
    const ct = raw.slice(12);
    const pt = await subtle().decrypt({ name: "AES-GCM", iv }, key, bs(ct));
    return new Uint8Array(pt);
  } catch {
    return null;
  }
}
async function encryptJson(key, value) {
  return encryptBytes(key, new TextEncoder().encode(JSON.stringify(value)));
}
async function decryptJson(key, payload) {
  const bytes = await decryptBytes(key, payload);
  if (!bytes) return null;
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}
async function createVault(password) {
  const salt = randomBytes(16);
  const key = await deriveKey(password, salt, KDF_ITERATIONS);
  const verify = await encryptBytes(key, new TextEncoder().encode(VERIFY_PLAINTEXT));
  return {
    meta: { v: 1, kdf: "PBKDF2-SHA256", iter: KDF_ITERATIONS, salt: b64encode(salt), verify },
    key
  };
}
async function unlockVault(password, meta) {
  if (!meta || !meta.salt || !meta.verify) return null;
  const key = await deriveKey(password, b64decode(meta.salt), meta.iter || KDF_ITERATIONS);
  const pt = await decryptBytes(key, meta.verify);
  if (!pt) return null;
  return new TextDecoder().decode(pt) === VERIFY_PLAINTEXT ? key : null;
}
function passwordStrength(pw) {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  const s = Math.min(3, Math.max(0, score - 1));
  return { score: s, label: ["弱", "一般", "较好", "很强"][s] };
}

// src/types.ts
var DATA_VERSION = 1;
var GROUP_COLORS = {
  本人: "#7F77DD",
  家人: "#D4537E",
  同事: "#378ADD",
  朋友: "#639922",
  客户: "#BA7517",
  网友: "#888780",
  其他: "#A3A19A"
};
function groupColor(g) {
  return GROUP_COLORS[g] || "#A3A19A";
}
function emptyGraph() {
  return { version: DATA_VERSION, updatedAt: (/* @__PURE__ */ new Date()).toISOString(), people: [] };
}
function strengthLabel(n) {
  const v = Math.round(n);
  if (v >= 5) return "强";
  if (v >= 4) return "较强";
  if (v >= 3) return "中";
  if (v >= 2) return "较弱";
  return "弱";
}
function parseStrength(token) {
  const t = (token || "").trim();
  if (!t) return 3;
  const n = Number(t);
  if (!Number.isNaN(n) && n > 0) return Math.max(1, Math.min(5, Math.round(n)));
  if (t.includes("很") || t === "强") return 5;
  if (t.includes("较强")) return 4;
  if (t === "中") return 3;
  if (t.includes("较弱")) return 2;
  if (t === "弱") return 1;
  return 3;
}

// src/graph.ts
var NS = "http://www.w3.org/2000/svg";
var RelationGraph = class {
  constructor(container, opts = {}) {
    this.nodes = [];
    this.links = [];
    this.byName = /* @__PURE__ */ new Map();
    this.raf = 0;
    this.selected = "";
    this.hovered = null;
    this.dragging = null;
    this.visibleGroups = null;
    this.minImportance = 1;
    this.W = 600;
    this.H = 420;
    this.cx = 300;
    this.cy = 210;
    this.disposed = false;
    /* ------------------------------- 物理 ------------------------------- */
    this.loop = () => {
      if (this.disposed) return;
      this.step();
      this.render();
      this.raf = requestAnimationFrame(this.loop);
    };
    this.onMove = (e) => {
      if (!this.dragging) return;
      const r = this.svg.getBoundingClientRect();
      this.dragging.x = e.clientX - r.left;
      this.dragging.y = e.clientY - r.top;
    };
    this.onUp = () => {
      this.dragging = null;
    };
    this.container = container;
    this.opts = opts;
    this.svg = document.createElementNS(NS, "svg");
    this.svg.setAttribute("class", "esg-graph-svg");
    this.gEdges = document.createElementNS(NS, "g");
    this.gNodes = document.createElementNS(NS, "g");
    this.svg.append(this.gEdges, this.gNodes);
    container.append(this.svg);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.svg.addEventListener("pointermove", this.onMove);
    this.svg.addEventListener("pointerup", this.onUp);
    this.svg.addEventListener("pointerleave", this.onUp);
    this.resize();
    this.loop();
  }
  /* ------------------------------- 数据 ------------------------------- */
  setData(people) {
    const prev = new Map(this.nodes.map((n) => [n.name, n]));
    const degree = /* @__PURE__ */ new Map();
    for (const p of people) {
      for (const r of p.relations) {
        degree.set(p.name, (degree.get(p.name) || 0) + 1);
        degree.set(r.to, (degree.get(r.to) || 0) + 1);
      }
    }
    this.nodes = people.map((p, i, arr) => {
      const old = prev.get(p.name);
      const a = i / Math.max(1, arr.length) * Math.PI * 2;
      return {
        name: p.name,
        group: p.group,
        importance: p.importance,
        degree: degree.get(p.name) || 0,
        x: old ? old.x : this.cx + Math.cos(a) * 120 + (Math.random() - 0.5) * 30,
        y: old ? old.y : this.cy + Math.sin(a) * 120 + (Math.random() - 0.5) * 30,
        vx: 0,
        vy: 0,
        r: 7 + Math.max(1, Math.min(10, p.importance)) * 1.5
      };
    });
    this.byName = new Map(this.nodes.map((n) => [n.name, n]));
    const links = [];
    const seen = /* @__PURE__ */ new Set();
    for (const p of people) {
      const a = this.byName.get(p.name);
      if (!a) continue;
      for (const r of p.relations) {
        const b = this.byName.get(r.to);
        if (!b) continue;
        const k = [a.name, b.name].sort().join("\0");
        if (seen.has(k)) continue;
        seen.add(k);
        links.push({ a, b, type: r.type, strength: r.strength });
      }
    }
    this.links = links;
    this.build();
    this.paint();
  }
  build() {
    this.gEdges.replaceChildren();
    this.gNodes.replaceChildren();
    for (const l of this.links) {
      const ln = document.createElementNS(NS, "line");
      ln.setAttribute("stroke-linecap", "round");
      this.gEdges.append(ln);
      l.el = ln;
    }
    for (const n of this.nodes) {
      const g = document.createElementNS(NS, "g");
      g.setAttribute("class", "esg-node");
      const c = document.createElementNS(NS, "circle");
      c.setAttribute("r", String(n.r));
      c.setAttribute("fill", groupColor(n.group));
      c.setAttribute("stroke", "#fff");
      c.setAttribute("stroke-width", "2");
      const t = document.createElementNS(NS, "text");
      t.setAttribute("y", String(n.r + 13));
      t.textContent = n.name;
      const title = document.createElementNS(NS, "title");
      title.textContent = `${n.name} · ${n.group} · 重要度 ${n.importance}`;
      g.append(c, t, title);
      this.gNodes.append(g);
      n.el = g;
      n.circle = c;
      g.addEventListener("pointerenter", () => {
        this.hovered = n.name;
        this.paint();
        this.opts.onHover?.(n.name);
      });
      g.addEventListener("pointerleave", () => {
        this.hovered = null;
        this.paint();
        this.opts.onHover?.(null);
      });
      g.addEventListener("pointerdown", (ev) => {
        ev.stopPropagation();
        this.dragging = n;
        try {
          this.svg.setPointerCapture(ev.pointerId);
        } catch {
        }
        this.select(n.name);
      });
    }
  }
  /* ------------------------------- 渲染 ------------------------------- */
  neighbors(name) {
    const s = /* @__PURE__ */ new Set([name]);
    for (const l of this.links) {
      if (l.a.name === name) s.add(l.b.name);
      if (l.b.name === name) s.add(l.a.name);
    }
    return s;
  }
  isVisible(n) {
    if (this.visibleGroups && !this.visibleGroups.has(n.group)) return false;
    return n.importance >= this.minImportance;
  }
  setFilter(groups, minImportance) {
    this.visibleGroups = groups;
    this.minImportance = Math.max(1, minImportance);
    this.paint();
  }
  select(name) {
    this.selected = name;
    this.paint();
    this.opts.onSelect?.(name);
  }
  selectedName() {
    return this.selected;
  }
  paint() {
    const near = this.hovered ? this.neighbors(this.hovered) : null;
    for (const n of this.nodes) {
      if (!n.el || !n.circle) continue;
      const vis = this.isVisible(n);
      n.el.style.display = vis ? "" : "none";
      n.circle.setAttribute("fill", groupColor(n.group));
      n.circle.classList.toggle("esg-sel", n.name === this.selected);
      let dim = !vis;
      if (!dim && near && !near.has(n.name)) dim = true;
      n.el.classList.toggle("esg-dim", dim);
    }
    for (const l of this.links) {
      if (!l.el) continue;
      const vis = this.isVisible(l.a) && this.isVisible(l.b);
      l.el.style.display = vis ? "" : "none";
      l.el.setAttribute("stroke-width", (0.6 + l.strength * 0.55).toFixed(2));
      l.el.setAttribute("stroke", l.strength >= 4 ? "#9FE1CB" : "#DEDCD6");
      const dim = this.hovered ? l.a.name !== this.hovered && l.b.name !== this.hovered : false;
      l.el.setAttribute("opacity", dim ? "0.14" : "1");
    }
    const sel = this.byName.get(this.selected);
    if (sel?.el) this.gNodes.append(sel.el);
  }
  step() {
    const REP = 6200;
    const SPRING = 0.022;
    const DAMP = 0.84;
    const n = this.nodes;
    for (let i = 0; i < n.length; i++) {
      for (let j = i + 1; j < n.length; j++) {
        const a = n[i];
        const b = n[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) {
          dx = Math.random() - 0.5;
          dy = Math.random() - 0.5;
          d2 = 1;
        }
        const d = Math.sqrt(d2);
        const f = REP / d2;
        const fx = dx / d * f;
        const fy = dy / d * f;
        a.vx -= fx;
        a.vy -= fy;
        b.vx += fx;
        b.vy += fy;
      }
    }
    for (const l of this.links) {
      const dx = l.b.x - l.a.x;
      const dy = l.b.y - l.a.y;
      const d = Math.hypot(dx, dy) || 0.01;
      const target = 128 - l.strength * 8;
      const f = (d - target) * SPRING;
      const fx = dx / d * f;
      const fy = dy / d * f;
      l.a.vx += fx;
      l.a.vy += fy;
      l.b.vx -= fx;
      l.b.vy -= fy;
    }
    for (const node of n) {
      const pull = node.degree >= 4 ? 0.018 : 4e-3;
      node.vx += (this.cx - node.x) * pull;
      node.vy += (this.cy - node.y) * pull;
      if (node === this.dragging) {
        node.vx = 0;
        node.vy = 0;
        continue;
      }
      node.vx *= DAMP;
      node.vy *= DAMP;
      const sp = Math.hypot(node.vx, node.vy);
      if (sp > 14) {
        node.vx = node.vx / sp * 14;
        node.vy = node.vy / sp * 14;
      }
      node.x += node.vx;
      node.y += node.vy;
      const pad = node.r + 22;
      node.x = Math.max(pad, Math.min(this.W - pad, node.x));
      node.y = Math.max(pad, Math.min(this.H - pad, node.y));
    }
  }
  render() {
    for (const n of this.nodes) {
      n.el?.setAttribute("transform", `translate(${n.x.toFixed(1)},${n.y.toFixed(1)})`);
    }
    for (const l of this.links) {
      if (!l.el) continue;
      l.el.setAttribute("x1", l.a.x.toFixed(1));
      l.el.setAttribute("y1", l.a.y.toFixed(1));
      l.el.setAttribute("x2", l.b.x.toFixed(1));
      l.el.setAttribute("y2", l.b.y.toFixed(1));
    }
  }
  resize() {
    const rect = this.container.getBoundingClientRect();
    this.W = Math.max(280, Math.round(rect.width) || 600);
    this.H = Math.max(300, Math.round(rect.height) || 420);
    this.cx = this.W / 2;
    this.cy = this.H / 2;
    this.svg.setAttribute("viewBox", `0 0 ${this.W} ${this.H}`);
  }
  relayout() {
    for (const n of this.nodes) {
      const a = Math.random() * Math.PI * 2;
      const d = 60 + Math.random() * 160;
      n.x = this.cx + Math.cos(a) * d;
      n.y = this.cy + Math.sin(a) * d;
      n.vx = 0;
      n.vy = 0;
    }
  }
  destroy() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    this.svg.removeEventListener("pointermove", this.onMove);
    this.svg.removeEventListener("pointerup", this.onUp);
    this.svg.removeEventListener("pointerleave", this.onUp);
    this.svg.remove();
  }
};
function toMermaid(people) {
  const id = (_name, i) => `p${i}`;
  const idx = new Map(people.map((p, i) => [p.name, id(p.name, i)]));
  const defs = people.map((p, i) => `  ${id(p.name, i)}["${p.name}<br/>${p.group}"]`).join("\n");
  const edges = [];
  const seen = /* @__PURE__ */ new Set();
  for (const p of people) {
    for (const r of p.relations) {
      const a = idx.get(p.name);
      const b = idx.get(r.to);
      if (!a || !b) continue;
      const k = [a, b].sort().join("-");
      if (seen.has(k)) continue;
      seen.add(k);
      const arrow = r.strength >= 4 ? "==>" : "-->";
      edges.push(`  ${a} ${arrow}|${r.type}·${strengthLabel(r.strength)}| ${b}`);
    }
  }
  return ["```mermaid", "graph LR", defs, edges.join("\n"), "```"].filter(Boolean).join("\n");
}

// src/markdown.ts
function serializePerson(p) {
  const L = [];
  L.push(`# ${p.name}`);
  L.push("");
  L.push(`#人物/${p.group}`);
  L.push("");
  L.push("## 基本");
  L.push("");
  L.push(`关系类型：${p.group}`);
  L.push(`重要度：${p.importance}`);
  if (p.since) L.push(`认识于：${p.since}`);
  if (p.note) L.push(`备注：${p.note}`);
  L.push("");
  L.push("## 人际关系");
  L.push("");
  for (const r of p.relations) {
    L.push(`- ${r.to} | ${r.type} | ${r.strength}${r.note ? " | " + r.note : ""}`);
  }
  L.push("");
  L.push("## 互动记录");
  L.push("");
  for (const a of p.interactions) {
    L.push(`- ${a.date} | ${a.kind} | ${a.text}`);
  }
  L.push("");
  return L.join("\n");
}
function pickSection(sections, ...names) {
  for (const [k, v] of sections) {
    for (const n of names) {
      if (k.includes(n)) return v;
    }
  }
  return [];
}
function splitRow(line) {
  const m = line.match(/^\s*[-*+]?\s*(.*)$/);
  const body = (m ? m[1] : line).trim();
  if (!body) return [];
  return body.split("|").map((s) => s.trim());
}
function isDateLike(s) {
  return /^\d{4}[-/.]\d{1,2}([-/.]\d{1,2})?$/.test(s) || /^\d{1,2}[-/.]\d{1,2}$/.test(s);
}
function parsePerson(markdown) {
  if (!markdown) return null;
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  let name = "";
  const tags = /* @__PURE__ */ new Set();
  const sections = /* @__PURE__ */ new Map();
  let current = null;
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    const h1 = line.match(/^#\s+(.+?)\s*$/);
    if (h1) {
      if (!name) name = h1[1].trim();
      continue;
    }
    const h2 = line.match(/^##\s+(.+?)\s*$/);
    if (h2) {
      current = h2[1].trim();
      if (!sections.has(current)) sections.set(current, []);
      continue;
    }
    if (current === null) {
      const re = /#([^\s#|]+)/g;
      let m;
      while (m = re.exec(line)) tags.add(m[1]);
      continue;
    }
    sections.get(current).push(line);
  }
  if (!name) return null;
  let group = "";
  for (const t of tags) {
    if (t.startsWith("人物/")) group = t.slice("人物/".length);
  }
  let importance = 5;
  let since = "";
  let note = "";
  for (const line of pickSection(sections, "基本", "资料", "信息")) {
    const m = line.match(/^\s*[-*+]?\s*([^:：#]+)\s*[:：]\s*(.+?)\s*$/);
    if (!m) continue;
    const k = m[1].trim();
    const v = m[2].trim();
    if (!v) continue;
    if (/关系类型|类型|关系/.test(k)) group = group || v;
    else if (/重要度|重要程度|权重/.test(k)) {
      const n = parseInt(v, 10);
      importance = Number.isNaN(n) ? 5 : Math.max(1, Math.min(10, n));
    } else if (/认识于|相识|认识/.test(k)) since = v;
    else if (/备注|说明/.test(k)) note = v;
  }
  const relations = [];
  for (const line of pickSection(sections, "人际关系", "关系")) {
    const cells = splitRow(line);
    if (!cells.length || !cells[0]) continue;
    if (/^姓名$/.test(cells[0]) && /类型|强度/.test(cells.join(""))) continue;
    relations.push({
      to: cells[0],
      type: cells[1] || "其他",
      strength: parseStrength(cells[2] || ""),
      note: cells[3] || void 0
    });
  }
  const interactions = [];
  for (const line of pickSection(sections, "互动记录", "互动", "记录")) {
    const cells = splitRow(line);
    if (!cells.length || !cells[0]) continue;
    if (/^日期$/.test(cells[0])) continue;
    if (isDateLike(cells[0])) {
      interactions.push({
        date: cells[0],
        kind: cells[1] || "记录",
        text: cells.slice(2).join(" | ") || cells[1] || ""
      });
    } else if (cells.length >= 2) {
      interactions.push({ date: cells[0], kind: cells[1], text: cells.slice(2).join(" | ") });
    }
  }
  return {
    name,
    group: group || "其他",
    importance,
    since: since || void 0,
    note: note || void 0,
    relations,
    interactions
  };
}
var VAULT_NOTE_TITLE = "人际关系数据";
var FENCE_KEY = "edgeever-social-graph-key";
var FENCE_VAULT = "edgeever-social-graph-vault";
function wrapVaultBody(meta, payload) {
  return [
    "# 人际关系数据（加密）",
    "",
    "> 本笔记内容由「人际关系图谱」插件加密保存，请勿手动修改。",
    "> 密码一旦遗忘，数据将无法恢复。",
    "",
    "```" + FENCE_KEY,
    JSON.stringify(meta),
    "```",
    "",
    "```" + FENCE_VAULT,
    payload,
    "```",
    ""
  ].join("\n");
}
function parseVaultBody(markdown) {
  const keyM = markdown.match(new RegExp("```" + FENCE_KEY + "\\s*\\n([\\s\\S]*?)\\n```"));
  const vaultM = markdown.match(new RegExp("```" + FENCE_VAULT + "\\s*\\n([\\s\\S]*?)\\n```"));
  let meta = null;
  if (keyM) {
    try {
      meta = JSON.parse(keyM[1].trim());
    } catch {
      meta = null;
    }
  }
  return { meta, payload: vaultM ? vaultM[1].trim() : null };
}
function isVaultNote(markdown) {
  if (!markdown) return false;
  return markdown.includes(FENCE_VAULT) || markdown.includes(FENCE_KEY);
}

// src/store.ts
var DEFAULT_CONFIG = {
  notebookName: "人际关系",
  vaultNoteTitle: VAULT_NOTE_TITLE,
  groups: ["家人", "同事", "朋友", "客户", "网友", "其他"]
};
async function loadConfig(ctx) {
  const read = async (key, fallback) => {
    try {
      const v = await ctx.settings.get(key);
      return typeof v === "string" && v.trim() ? v.trim() : fallback;
    } catch {
      return fallback;
    }
  };
  const notebookName = await read("notebookName", DEFAULT_CONFIG.notebookName);
  const vaultNoteTitle = await read("vaultNoteTitle", DEFAULT_CONFIG.vaultNoteTitle);
  const groupsRaw = await read("groups", DEFAULT_CONFIG.groups.join(","));
  const groups = groupsRaw.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
  return {
    notebookName,
    vaultNoteTitle,
    groups: groups.length ? groups : DEFAULT_CONFIG.groups
  };
}
function normalizeList(res) {
  if (Array.isArray(res)) return res;
  const o = res;
  const items = o?.items || o?.notes || o?.notebooks || o?.results || o?.data || o?.list;
  return Array.isArray(items) ? items : [];
}
function normalizePage(res) {
  if (Array.isArray(res)) return { items: res, nextOffset: null };
  const o = res;
  const items = o?.items || o?.notes || o?.results || o?.data || [];
  const next = o?.nextOffset ?? o?.next ?? null;
  return {
    items: Array.isArray(items) ? items : [],
    nextOffset: typeof next === "number" ? next : null
  };
}
async function findNotebook(ctx, name) {
  const list = normalizeList(await ctx.notebooks.list());
  return list.find((n) => n && n.name === name) || null;
}
async function ensureNotebook(ctx, name) {
  const found = await findNotebook(ctx, name);
  if (found) return found;
  return ctx.notebooks.create({ name, parentId: null });
}
var NotInitializedError = class extends Error {
  constructor(notebookName) {
    super(`尚未创建「${notebookName}」笔记本`);
    this.notebookName = notebookName;
  }
};
async function fetchNotebookNotes(ctx, notebookId) {
  const out = [];
  let offset = 0;
  for (let page = 0; page < 50; page++) {
    const res = await ctx.notes.queryContent({ notebookId, limit: 200, offset });
    const { items, nextOffset } = normalizePage(res);
    for (const it of items) {
      if (!it || !it.id) continue;
      if (typeof it.contentMarkdown === "string") {
        out.push(it);
      } else {
        const full = await ctx.notes.get(it.id);
        if (full) out.push(full);
      }
    }
    if (nextOffset === null || nextOffset === offset) break;
    if (items.length === 0) break;
    offset = nextOffset;
  }
  return out;
}
async function load(ctx, config) {
  const notebook = await findNotebook(ctx, config.notebookName);
  if (!notebook) throw new NotInitializedError(config.notebookName);
  const notes = await fetchNotebookNotes(ctx, notebook.id);
  const vault = notes.find((n) => isVaultNote(n.contentMarkdown) || n.title === config.vaultNoteTitle);
  if (vault) {
    const parsed = parseVaultBody(vault.contentMarkdown || "");
    return {
      notebook,
      mode: "encrypted",
      dataNote: vault,
      meta: parsed.meta || void 0,
      payload: parsed.payload || void 0,
      rawNotes: notes.filter((n) => n.id !== vault.id)
    };
  }
  return { notebook, mode: "plain", rawNotes: notes };
}
function decodePlain(loaded) {
  const people = [];
  for (const n of loaded.rawNotes) {
    const p = parsePerson(n.contentMarkdown || "");
    if (p) people.push(p);
  }
  return people;
}
async function decodeEncrypted(loaded, key) {
  if (!loaded.payload) return emptyGraph();
  return decryptJson(key, loaded.payload);
}
async function savePlain(ctx, loaded, people) {
  const byTitle = /* @__PURE__ */ new Map();
  for (const n of loaded.rawNotes) {
    if (n.title) byTitle.set(n.title, n);
  }
  let created = 0;
  let updated = 0;
  let removed = 0;
  const wanted = new Set(people.map((p) => p.name));
  for (const p of people) {
    const md = serializePerson(p);
    const existing = byTitle.get(p.name);
    if (existing) {
      if ((existing.contentMarkdown || "") !== md) {
        await ctx.notes.update(existing.id, {
          title: p.name,
          contentMarkdown: md,
          tags: [`人物/${p.group}`]
        });
        updated++;
      }
    } else {
      await ctx.notes.create({
        notebookId: loaded.notebook.id,
        title: p.name,
        contentMarkdown: md,
        tags: [`人物/${p.group}`]
      });
      created++;
    }
  }
  for (const n of loaded.rawNotes) {
    if (n.title && !wanted.has(n.title)) {
      try {
        await ctx.notes.trash([n.id]);
        removed++;
      } catch {
      }
    }
  }
  return { created, updated, removed };
}
async function saveEncrypted(ctx, loaded, data, key, config) {
  if (!loaded.meta) throw new Error("缺少加密元信息，无法写入。");
  const payload = await encryptJson(key, data);
  const body = wrapVaultBody(loaded.meta, payload);
  if (loaded.dataNote) {
    await ctx.notes.update(loaded.dataNote.id, {
      title: config.vaultNoteTitle,
      contentMarkdown: body,
      tags: ["人物/加密数据"]
    });
  } else {
    const created = await ctx.notes.create({
      notebookId: loaded.notebook.id,
      title: config.vaultNoteTitle,
      contentMarkdown: body,
      tags: ["人物/加密数据"]
    });
    loaded.dataNote = created;
  }
}
async function migratePlainToEncrypted(ctx, loaded, people, meta, key, config) {
  const data = {
    version: 1,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    people
  };
  const payload = await encryptJson(key, data);
  const body = wrapVaultBody(meta, payload);
  const note = await ctx.notes.create({
    notebookId: loaded.notebook.id,
    title: config.vaultNoteTitle,
    contentMarkdown: body,
    tags: ["人物/加密数据"]
  });
  loaded.dataNote = note;
  for (const n of loaded.rawNotes) {
    try {
      await ctx.notes.trash([n.id]);
    } catch {
    }
  }
  loaded.rawNotes = [];
  loaded.mode = "encrypted";
  loaded.meta = meta;
  loaded.payload = payload;
}
async function migrateEncryptedToPlain(ctx, loaded, data) {
  for (const p of data.people) {
    await ctx.notes.create({
      notebookId: loaded.notebook.id,
      title: p.name,
      contentMarkdown: serializePerson(p),
      tags: [`人物/${p.group}`]
    });
  }
  if (loaded.dataNote) {
    try {
      await ctx.notes.trash([loaded.dataNote.id]);
    } catch {
    }
    loaded.dataNote = void 0;
  }
  loaded.mode = "plain";
  loaded.meta = void 0;
  loaded.payload = void 0;
  loaded.rawNotes = [];
}

// src/ui/styles.ts
var CSS = `
.esg-root{
  --esg-bg:#ffffff;
  --esg-bg-2:#fcfcfb;
  --esg-bg-3:#f5f5f4;
  --esg-border:#e7e5e0;
  --esg-border-2:#f1efeb;
  --esg-text:#2c2c2a;
  --esg-text-2:#5f5e5a;
  --esg-text-3:#a3a19a;
  --esg-accent:#16a06e;
  --esg-accent-soft:#e1f5ee;
  --esg-accent-line:#9fe1cb;
  --esg-danger:#c0392b;
  --esg-warn-bg:#fbf3e9;
  --esg-warn-line:#f0dcc0;
  --esg-warn-text:#854f0b;

  display:flex;flex-direction:column;height:100%;min-height:0;
  background:var(--esg-bg);color:var(--esg-text);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif;
  font-size:13px;line-height:1.6;-webkit-font-smoothing:antialiased;
}
@media (prefers-color-scheme: dark){
  .esg-root{
    --esg-bg:#1b1b1a;
    --esg-bg-2:#232322;
    --esg-bg-3:#2b2b29;
    --esg-border:#3a3a34;
    --esg-border-2:#2f2f2b;
    --esg-text:#e8e6e1;
    --esg-text-2:#b8b6b0;
    --esg-text-3:#84827b;
    --esg-accent:#3fbf8c;
    --esg-accent-soft:#12332a;
    --esg-accent-line:#1f5f4b;
    --esg-warn-bg:#33280f;
    --esg-warn-line:#5a4416;
    --esg-warn-text:#e0b96a;
  }
}
.esg-root *{box-sizing:border-box}
.esg-root button{
  font-family:inherit;font-size:12px;padding:6px 12px;border-radius:8px;cursor:pointer;
  border:1px solid var(--esg-border);background:var(--esg-bg);color:var(--esg-text-2);transition:.12s;
}
.esg-root button:hover{background:var(--esg-bg-3)}
.esg-root button:disabled{opacity:.5;cursor:default}
.esg-root button.esg-primary{background:var(--esg-accent);border-color:var(--esg-accent);color:#fff}
.esg-root button.esg-primary:hover{filter:brightness(.94)}
.esg-root button.esg-danger{color:var(--esg-danger);border-color:var(--esg-border)}
.esg-root button.esg-sm{padding:3px 8px;font-size:11px;border-radius:6px}
.esg-root input,.esg-root select,.esg-root textarea{
  font-family:inherit;font-size:12.5px;padding:6px 9px;border-radius:8px;outline:none;
  border:1px solid var(--esg-border);background:var(--esg-bg-2);color:var(--esg-text);width:100%;
}
.esg-root input:focus,.esg-root select:focus,.esg-root textarea:focus{
  border-color:var(--esg-accent-line);background:var(--esg-bg);
}

/* 顶栏 */
.esg-top{
  display:flex;align-items:center;gap:10px;padding:9px 14px;border-bottom:1px solid var(--esg-border);
  flex:none;background:var(--esg-bg);
}
.esg-logo{width:24px;height:24px;border-radius:7px;background:var(--esg-accent);display:flex;align-items:center;justify-content:center;flex:none}
.esg-title{font-size:14px;font-weight:500;margin:0}
.esg-sub{font-size:11.5px;color:var(--esg-text-3)}
.esg-spacer{flex:1}
.esg-badge{
  font-size:11px;padding:3px 8px;border-radius:999px;border:1px solid var(--esg-border);
  color:var(--esg-text-2);background:var(--esg-bg-2);
}
.esg-badge.esg-lock{background:var(--esg-accent-soft);border-color:var(--esg-accent-line);color:var(--esg-accent)}

/* 主体三栏 */
.esg-body{flex:1;display:grid;grid-template-columns:210px 1fr 300px;min-height:0}
.esg-col{min-height:0;overflow:auto}
.esg-left{border-right:1px solid var(--esg-border);background:var(--esg-bg-2);padding:12px 10px}
.esg-center{position:relative;background:var(--esg-bg-2);overflow:hidden}
.esg-right{border-left:1px solid var(--esg-border);background:var(--esg-bg);padding:14px 13px;overflow:auto}

.esg-label{font-size:11px;font-weight:500;color:var(--esg-text-3);letter-spacing:.04em;margin:0 0 7px 4px}
.esg-label+.esg-label{margin-top:18px}

.esg-chip{
  display:inline-flex;align-items:center;gap:6px;font-size:11.5px;padding:3px 9px;border-radius:999px;
  border:1px solid var(--esg-border);background:var(--esg-bg);cursor:pointer;color:var(--esg-text-2);margin:0 5px 5px 0;
}
.esg-chip.esg-on{background:var(--esg-accent-soft);border-color:var(--esg-accent-line);color:var(--esg-accent)}
.esg-dot{width:7px;height:7px;border-radius:50%;flex:none}

.esg-pitem{
  display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;cursor:pointer;font-size:12.5px;
}
.esg-pitem:hover{background:var(--esg-bg-3)}
.esg-pitem.esg-on{background:var(--esg-accent-soft);color:var(--esg-accent)}
.esg-pitem .esg-av{
  width:22px;height:22px;border-radius:7px;color:#fff;font-size:10px;flex:none;
  display:flex;align-items:center;justify-content:center;
}
.esg-pitem .esg-nm{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.esg-pitem .esg-gp{font-size:10.5px;color:var(--esg-text-3)}

/* 图谱 */
.esg-graph-svg{display:block;width:100%;height:100%;cursor:grab}
.esg-graph-svg:active{cursor:grabbing}
.esg-node{cursor:pointer}
.esg-node text{font-size:12px;fill:var(--esg-text-2);text-anchor:middle;pointer-events:none;user-select:none}
.esg-dim{opacity:.13}
.esg-sel{stroke:var(--esg-text) !important;stroke-width:2.5px !important}
.esg-hint{
  position:absolute;left:12px;bottom:10px;font-size:11px;color:var(--esg-text-3);
  background:var(--esg-bg);padding:4px 9px;border-radius:6px;border:1px solid var(--esg-border-2);opacity:.92;
}

/* 详情 */
.esg-phead{display:flex;align-items:center;gap:11px;margin-bottom:14px}
.esg-pav{width:42px;height:42px;border-radius:12px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:16px;flex:none}
.esg-pname{font-size:15px;font-weight:500;margin:0 0 2px}
.esg-field{display:grid;grid-template-columns:64px 1fr;gap:8px;align-items:center;margin-bottom:8px}
.esg-field>span{font-size:12px;color:var(--esg-text-3)}
.esg-sec{font-size:12px;font-weight:500;margin:18px 0 9px;color:var(--esg-text-2);display:flex;align-items:center;gap:8px}
.esg-sec .esg-spacer{flex:1}
.esg-row{
  display:flex;align-items:center;gap:8px;padding:6px 7px;border-radius:8px;font-size:12.5px;
  border:1px solid var(--esg-border-2);margin-bottom:6px;background:var(--esg-bg-2);
}
.esg-row .esg-grow{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.esg-row .esg-muted{font-size:11px;color:var(--esg-text-3)}
.esg-strength{display:flex;gap:2px;flex:none}
.esg-strength i{width:3px;height:11px;border-radius:1px;background:var(--esg-border-2)}
.esg-strength i.esg-f{background:var(--esg-accent)}

/* 锁屏 / 引导 */
.esg-centerbox{
  flex:1;display:flex;align-items:center;justify-content:center;padding:30px;overflow:auto;
}
.esg-card{
  width:100%;max-width:420px;background:var(--esg-bg);border:1px solid var(--esg-border);
  border-radius:14px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,.04);
}
.esg-card h2{font-size:15px;font-weight:500;margin:0 0 6px}
.esg-card p{font-size:12.5px;color:var(--esg-text-2);margin:0 0 16px;line-height:1.7}
.esg-lockicon{
  width:40px;height:40px;border-radius:12px;background:var(--esg-accent-soft);
  display:flex;align-items:center;justify-content:center;margin-bottom:14px;
}
.esg-note{
  font-size:11.5px;color:var(--esg-text-3);background:var(--esg-bg-3);border-radius:8px;
  padding:9px 11px;line-height:1.7;margin-top:12px;
}
.esg-warn{
  font-size:11.5px;color:var(--esg-warn-text);background:var(--esg-warn-bg);
  border:1px solid var(--esg-warn-line);border-radius:8px;padding:9px 11px;line-height:1.7;
}
.esg-err{color:var(--esg-danger);font-size:11.5px;margin-top:8px;min-height:16px}
.esg-actions{display:flex;gap:8px;margin-top:16px;align-items:center;flex-wrap:wrap}
.esg-meter{display:flex;gap:3px;margin-top:6px}
.esg-meter i{flex:1;height:3px;border-radius:2px;background:var(--esg-border-2)}
.esg-meter i.esg-f{background:var(--esg-accent)}
.esg-radio{display:flex;gap:14px;margin:10px 0 4px;font-size:12.5px;color:var(--esg-text-2)}
.esg-radio label{display:flex;align-items:center;gap:6px;cursor:pointer}

/* 遮罩弹层 */
.esg-overlay{
  position:absolute;inset:0;background:rgba(0,0,0,.32);display:flex;align-items:center;justify-content:center;
  padding:24px;z-index:20;
}
.esg-overlay .esg-card{max-width:440px;max-height:100%;overflow:auto}

.esg-empty{font-size:12.5px;color:var(--esg-text-3);padding:20px 4px;text-align:center;line-height:1.8}
.esg-scrollhint{font-size:11px;color:var(--esg-text-3);margin-top:14px;padding-top:12px;border-top:1px solid var(--esg-border-2);line-height:1.7}

@media (max-width:900px){
  .esg-body{grid-template-columns:1fr}
  .esg-left,.esg-right{display:none}
}
`;
function injectStyles(doc = document) {
  if (doc.querySelector("style[data-esg-style]")) return;
  const el = doc.createElement("style");
  el.setAttribute("data-esg-style", "1");
  el.textContent = CSS;
  doc.head.append(el);
}

// src/ui/panel.ts
var sessionKeys = /* @__PURE__ */ new Map();
function h(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== void 0) el.textContent = text;
  return el;
}
function today() {
  const d = /* @__PURE__ */ new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function option(label, value) {
  const o = document.createElement("option");
  o.textContent = label;
  o.value = value;
  return o;
}
var SocialGraphPanel = class {
  constructor(ctx, host) {
    this.config = { notebookName: "人际关系", vaultNoteTitle: "人际关系数据", groups: [] };
    this.loaded = null;
    this.key = null;
    this.data = emptyGraph();
    this.graph = null;
    this.selected = "";
    this.editing = null;
    this.search = "";
    this.activeGroups = null;
    this.minImp = 1;
    this.saveTimer = 0;
    this.disposed = false;
    this.leftListWrap = null;
    this.rightPanel = null;
    this.ctx = ctx;
    this.host = host;
  }
  /* ------------------------------ 生命周期 ------------------------------ */
  start() {
    injectStyles();
    this.host.replaceChildren();
    this.root = h("div", "esg-root");
    this.host.append(this.root);
    void this.bootstrap();
  }
  destroy() {
    this.disposed = true;
    window.clearTimeout(this.saveTimer);
    this.graph?.destroy();
    this.graph = null;
    this.host.replaceChildren();
  }
  clearRoot() {
    this.graph?.destroy();
    this.graph = null;
    this.root.replaceChildren();
  }
  async bootstrap() {
    this.clearRoot();
    this.root.append(h("div", "esg-centerbox", "正在读取数据…"));
    try {
      this.config = await loadConfig(this.ctx);
    } catch {
    }
    let loaded;
    try {
      loaded = await load(this.ctx, this.config);
    } catch (e) {
      if (e instanceof NotInitializedError) {
        this.renderInit();
        return;
      }
      this.renderError(String(e));
      return;
    }
    this.loaded = loaded;
    if (loaded.mode === "encrypted") {
      let key = this.key || sessionKeys.get(loaded.notebook.id) || null;
      if (!key) {
        this.key = null;
        this.renderLock();
        return;
      }
      const data = await decodeEncrypted(loaded, key);
      if (!data) {
        this.key = null;
        sessionKeys.delete(loaded.notebook.id);
        this.renderLock("密码不正确，或数据已损坏。");
        return;
      }
      this.key = key;
      this.data = data;
    } else {
      this.data = { version: 1, updatedAt: (/* @__PURE__ */ new Date()).toISOString(), people: decodePlain(loaded) };
    }
    this.selected = this.data.people[0]?.name || "";
    this.renderMain();
  }
  /* ------------------------------ 错误页 ------------------------------ */
  renderError(msg) {
    this.clearRoot();
    const box = h("div", "esg-centerbox");
    const card = h("div", "esg-card");
    card.append(h("h2", void 0, "读取失败"));
    card.append(h("p", void 0, msg));
    const act = h("div", "esg-actions");
    const retry = h("button", "esg-primary", "重试");
    retry.onclick = () => void this.bootstrap();
    act.append(retry);
    card.append(act);
    box.append(card);
    this.root.append(box);
  }
  /* ------------------------------ 初始化引导 ------------------------------ */
  renderInit() {
    this.clearRoot();
    const box = h("div", "esg-centerbox");
    const card = h("div", "esg-card");
    card.append(h("h2", void 0, "初始化人际关系图谱"));
    const p = h("p");
    p.append(
      document.createTextNode("插件会新建一个名为 "),
      Object.assign(document.createElement("b"), { textContent: `「${this.config.notebookName}」` }),
      document.createTextNode(" 的笔记本用于存放数据。你还需要决定它是否需要密码保护。")
    );
    card.append(p);
    const radios = h("div", "esg-radio");
    const mk = (value, label) => {
      const l = h("label");
      const r = h("input");
      r.type = "radio";
      r.name = "esg-mode";
      r.value = value;
      l.append(r, document.createTextNode(label));
      return { l, r };
    };
    const plainOpt = mk("plain", "不设密码（明文笔记）");
    const encOpt = mk("enc", "设置密码（加密存储）");
    plainOpt.r.checked = true;
    radios.append(plainOpt.l, encOpt.l);
    card.append(radios);
    const info = h("div", "esg-note");
    card.append(info);
    const pwWrap = h("div");
    pwWrap.style.display = "none";
    pwWrap.style.marginTop = "12px";
    const pw1 = h("input");
    pw1.type = "password";
    pw1.placeholder = "设置密码";
    pw1.style.marginBottom = "8px";
    const pw2 = h("input");
    pw2.type = "password";
    pw2.placeholder = "再次输入密码";
    const meter = h("div", "esg-meter");
    for (let i = 0; i < 4; i++) meter.append(h("i"));
    const strength = h("div");
    strength.style.cssText = "font-size:11px;color:var(--esg-text-3);margin-top:5px";
    const warn = h("div", "esg-warn");
    warn.style.marginTop = "10px";
    warn.textContent = "加密模式下，密码遗失将导致数据无法恢复——插件不保存密码，也没有找回入口。建议同时做好笔记导出备份。";
    pwWrap.append(pw1, pw2, meter, strength, warn);
    card.append(pwWrap);
    const refreshInfo = () => {
      if (plainOpt.r.checked) {
        info.textContent = "明文模式：每个人物是一篇标准 Markdown 笔记，可全文搜索、参与同步、可被 MCP / AI 读取，也能随手导出。任何人都能从笔记本树直接翻开查看。";
        pwWrap.style.display = "none";
      } else {
        info.textContent = "加密模式：整份关系数据会加密后存入单篇笔记（密码派生密钥，AES-GCM）。即使从笔记本树点进去也只能看到密文。代价是这批数据不再能被全文搜索与 AI 直接读取。";
        pwWrap.style.display = "";
      }
    };
    plainOpt.r.onchange = refreshInfo;
    encOpt.r.onchange = refreshInfo;
    refreshInfo();
    const updateMeter = () => {
      const s = passwordStrength(pw1.value);
      meter.querySelectorAll("i").forEach((el, i) => el.classList.toggle("esg-f", i <= s.score && pw1.value.length > 0));
      strength.textContent = pw1.value ? `强度：${s.label}` : "";
    };
    pw1.oninput = updateMeter;
    const err = h("div", "esg-err");
    const actions = h("div", "esg-actions");
    const go = h("button", "esg-primary", "创建并开始使用");
    go.onclick = async () => {
      err.textContent = "";
      go.disabled = true;
      try {
        if (encOpt.r.checked) {
          const pw = pw1.value;
          if (pw.length < 6) throw new Error("密码至少 6 位。");
          if (pw !== pw2.value) throw new Error("两次输入的密码不一致。");
          await this.initVault(pw);
        } else {
          await ensureNotebook(this.ctx, this.config.notebookName);
        }
        await this.bootstrap();
      } catch (e) {
        err.textContent = e instanceof Error ? e.message : String(e);
        go.disabled = false;
      }
    };
    actions.append(go);
    card.append(err, actions);
    box.append(card);
    this.root.append(box);
  }
  async initVault(password) {
    const { meta, key } = await createVault(password);
    const nb = await ensureNotebook(this.ctx, this.config.notebookName);
    const data = emptyGraph();
    const payload = await encryptJson(key, data);
    await this.ctx.notes.create({
      notebookId: nb.id,
      title: this.config.vaultNoteTitle,
      contentMarkdown: wrapVaultBody(meta, payload),
      tags: ["人物/加密数据"]
    });
    this.key = key;
    sessionKeys.set(nb.id, key);
  }
  /* ------------------------------ 锁屏 ------------------------------ */
  renderLock(message) {
    this.clearRoot();
    const box = h("div", "esg-centerbox");
    const card = h("div", "esg-card");
    const icon = h("div", "esg-lockicon");
    icon.innerHTML = '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="#16a06e" stroke-width="1.5"><rect x="3.5" y="7.5" width="11" height="8" rx="2"/><path d="M6 7.5V5.6a3 3 0 0 1 6 0v1.9"/></svg>';
    card.append(icon);
    card.append(h("h2", void 0, "人际关系数据已加密"));
    card.append(
      h("p", void 0, `输入密码以解锁「${this.config.notebookName}」中的数据。密钥仅在内存中派生，不会写入任何存储。`)
    );
    const pw = h("input");
    pw.type = "password";
    pw.placeholder = "密码";
    card.append(pw);
    const err = h("div", "esg-err", message || "");
    const actions = h("div", "esg-actions");
    const go = h("button", "esg-primary", "解锁");
    const submit = async () => {
      if (!this.loaded?.meta) {
        err.textContent = "加密元信息缺失，无法解锁。";
        return;
      }
      if (!pw.value) return;
      go.disabled = true;
      err.textContent = "";
      try {
        const key = await unlockVault(pw.value, this.loaded.meta);
        if (!key) {
          err.textContent = "密码不正确。";
          go.disabled = false;
          pw.select();
          return;
        }
        this.key = key;
        if (this.loaded?.notebook?.id) {
          sessionKeys.set(this.loaded.notebook.id, key);
        }
        await this.bootstrap();
      } catch (e) {
        err.textContent = e instanceof Error ? e.message : String(e);
        go.disabled = false;
      }
    };
    go.onclick = submit;
    pw.addEventListener("keydown", (e) => {
      if (e.key === "Enter") void submit();
    });
    actions.append(go);
    const tip = h("div", "esg-note");
    tip.textContent = "可以在笔记里找到「人际关系数据」查看密文，但内容需要密码才能解出。若忘记密码，本插件无法恢复数据。";
    card.append(err, actions, tip);
    box.append(card);
    this.root.append(box);
    setTimeout(() => pw.focus(), 30);
  }
  /* ------------------------------ 主界面 ------------------------------ */
  renderMain() {
    this.clearRoot();
    const top = h("div", "esg-top");
    const logo = h("div", "esg-logo");
    logo.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14"><circle cx="4" cy="4" r="2.2" fill="#fff"/><circle cx="10.5" cy="6" r="1.8" fill="#fff" opacity=".85"/><circle cx="5.5" cy="10.5" r="1.8" fill="#fff" opacity=".85"/><path d="M4 4L10.5 6M4 4L5.5 10.5" stroke="#fff" stroke-width="1" opacity=".7"/></svg>';
    const tt = h("div");
    tt.append(h("p", "esg-title", "人际关系图谱"));
    tt.append(
      h(
        "div",
        "esg-sub",
        `笔记本：${this.config.notebookName} · ${this.data.people.length} 人 · ${this.edgeCount()} 条关系`
      )
    );
    const badge = h(
      "span",
      this.loaded?.mode === "encrypted" ? "esg-badge esg-lock" : "esg-badge",
      this.loaded?.mode === "encrypted" ? "加密模式" : "明文模式"
    );
    top.append(logo, tt, badge, h("div", "esg-spacer"));
    const mkBtn = (label, cls, fn) => {
      const b = h("button", cls, label);
      b.onclick = fn;
      return b;
    };
    top.append(
      mkBtn("新增人物", "esg-primary", () => this.startNewPerson()),
      mkBtn("重新索引", "", () => void this.reindex()),
      mkBtn("导出图谱", "", () => void this.exportMermaid()),
      mkBtn("安全设置", "", () => this.openSecurity())
    );
    if (this.loaded?.mode === "encrypted") {
      top.append(
        mkBtn("立即锁定", "", () => {
          if (this.loaded?.notebook?.id) sessionKeys.delete(this.loaded.notebook.id);
          this.key = null;
          this.renderLock();
        })
      );
    }
    this.root.append(top);
    const body = h("div", "esg-body");
    const left = h("div", "esg-col esg-left");
    const center = h("div", "esg-col esg-center");
    const right = h("div", "esg-col esg-right");
    body.append(left, center, right);
    this.root.append(body);
    this.renderLeft(left);
    this.renderCenter(center);
    this.rightPanel = right;
    this.renderDetail(right);
  }
  edgeCount() {
    const seen = /* @__PURE__ */ new Set();
    for (const p of this.data.people) {
      for (const r of p.relations) {
        const k = [p.name, r.to].sort().join("\0");
        seen.add(k);
      }
    }
    return seen.size;
  }
  renderLeft(left) {
    left.replaceChildren();
    const search = h("input");
    search.placeholder = "搜索姓名…";
    search.value = this.search;
    search.oninput = () => {
      this.search = search.value.trim();
      if (this.leftListWrap) this.renderLeftList(this.leftListWrap);
    };
    const searchBox = h("div");
    searchBox.style.marginBottom = "14px";
    searchBox.append(search);
    left.append(searchBox);
    left.append(h("p", "esg-label", "圈层"));
    const chips = h("div");
    chips.style.marginBottom = "6px";
    const groups = this.allGroups();
    const mkChip = (name, label, color) => {
      const c = h("span", "esg-chip" + (this.isGroupOn(name) ? " esg-on" : ""));
      if (color) {
        const d = h("span", "esg-dot");
        d.style.background = color;
        c.append(d);
      }
      c.append(document.createTextNode(label));
      c.onclick = () => {
        this.toggleGroup(name);
        this.renderLeft(left);
        this.graph?.setFilter(this.activeGroups, this.minImp);
      };
      return c;
    };
    chips.append(mkChip("__all", "全部"));
    for (const g of groups) chips.append(mkChip(g, g, groupColor(g)));
    left.append(chips);
    const impWrap = h("div");
    impWrap.style.cssText = "display:flex;align-items:center;gap:8px;margin:6px 0 16px;font-size:11.5px;color:var(--esg-text-3)";
    const imp = h("input");
    imp.type = "range";
    imp.min = "1";
    imp.max = "10";
    imp.value = String(this.minImp);
    imp.style.padding = "0";
    imp.oninput = () => {
      this.minImp = Number(imp.value);
      this.graph?.setFilter(this.activeGroups, this.minImp);
      this.renderLeftList(listWrap);
    };
    impWrap.append(document.createTextNode("重要度 ≥"), imp);
    left.append(impWrap);
    left.append(h("p", "esg-label", "人物"));
    const listWrap = h("div");
    this.leftListWrap = listWrap;
    left.append(listWrap);
    this.renderLeftList(listWrap);
  }
  renderLeftList(wrap) {
    wrap.replaceChildren();
    const people = this.filteredPeople();
    if (!people.length) {
      wrap.append(h("div", "esg-empty", "没有符合条件的人物"));
      return;
    }
    for (const p of people) {
      const item = h("div", "esg-pitem" + (p.name === this.selected ? " esg-on" : ""));
      const av = h("span", "esg-av", p.name.slice(0, 1));
      av.style.background = groupColor(p.group);
      item.append(av, h("span", "esg-nm", p.name), h("span", "esg-gp", p.group));
      item.onclick = () => {
        this.selected = p.name;
        this.editing = null;
        this.graph?.select(p.name);
        this.refreshLists();
      };
      wrap.append(item);
    }
  }
  refreshLists() {
    if (this.leftListWrap) this.renderLeftList(this.leftListWrap);
    if (this.rightPanel) this.renderDetail(this.rightPanel);
  }
  renderCenter(center) {
    center.replaceChildren();
    this.graph = new RelationGraph(center, {
      onSelect: (name) => {
        this.selected = name;
        this.editing = null;
        this.refreshLists();
      }
    });
    this.graph.setData(this.data.people);
    this.graph.setFilter(this.activeGroups, this.minImp);
    if (this.selected) this.graph.select(this.selected);
    center.append(h("div", "esg-hint", "拖拽节点调整 · 点击查看详情 · 悬停高亮邻居"));
  }
  /* ------------------------------ 详情与编辑 ------------------------------ */
  renderDetail(right) {
    right.replaceChildren();
    const p = this.editing || this.data.people.find((x) => x.name === this.selected) || null;
    if (!p) {
      right.append(h("div", "esg-empty", "左侧选择一个人物，或点击「新增人物」。"));
      return;
    }
    const head = h("div", "esg-phead");
    const av = h("div", "esg-pav", p.name.slice(0, 1) || "?");
    av.style.background = groupColor(p.group);
    const nameWrap = h("div");
    const nameInput = h("input");
    nameInput.value = p.name;
    nameInput.style.cssText = "font-size:14px;font-weight:500;padding:4px 8px";
    nameInput.onchange = () => {
      const next = nameInput.value.trim();
      if (!next) {
        nameInput.value = p.name;
        return;
      }
      const old = p.name;
      const conflict = this.data.people.some((x) => x !== p && x.name === next);
      if (conflict) {
        this.ctx.ui.showNotice("已存在同名人物。");
        nameInput.value = old;
        return;
      }
      p.name = next;
      for (const other of this.data.people) {
        for (const r of other.relations) {
          if (r.to === old) r.to = next;
        }
      }
      if (this.selected === old) this.selected = next;
      this.scheduleSave();
      this.rebuildGraph();
      this.refreshLists();
    };
    nameWrap.append(nameInput);
    head.append(av, nameWrap);
    right.append(head);
    const groupSel = h("select");
    for (const g of this.allGroups()) {
      const o = h("option", void 0, g);
      o.value = g;
      groupSel.append(o);
    }
    groupSel.value = this.allGroups().includes(p.group) ? p.group : "其他";
    groupSel.onchange = () => {
      p.group = groupSel.value;
      av.style.background = groupColor(p.group);
      this.scheduleSave();
      this.rebuildGraph();
    };
    const impInput = h("input");
    impInput.type = "number";
    impInput.min = "1";
    impInput.max = "10";
    impInput.value = String(p.importance);
    impInput.onchange = () => {
      p.importance = Math.max(1, Math.min(10, Number(impInput.value) || 5));
      impInput.value = String(p.importance);
      this.scheduleSave();
      this.rebuildGraph();
    };
    const sinceInput = h("input");
    sinceInput.placeholder = "如 2019-03";
    sinceInput.value = p.since || "";
    sinceInput.onchange = () => {
      p.since = sinceInput.value.trim() || void 0;
      this.scheduleSave();
    };
    const noteInput = h("input");
    noteInput.placeholder = "一句话备注";
    noteInput.value = p.note || "";
    noteInput.onchange = () => {
      p.note = noteInput.value.trim() || void 0;
      this.scheduleSave();
    };
    right.append(
      this.field("圈层", groupSel),
      this.field("重要度", impInput),
      this.field("认识于", sinceInput),
      this.field("备注", noteInput)
    );
    const relSec = h("div", "esg-sec");
    relSec.append(document.createTextNode(`人际关系 (${p.relations.length})`), h("div", "esg-spacer"));
    right.append(relSec);
    for (const r of p.relations) {
      const row = h("div", "esg-row");
      row.append(h("span", "esg-grow", `${r.to} · ${r.type}`));
      const st = h("span", "esg-strength");
      for (let i = 1; i <= 5; i++) st.append(h("i", i <= r.strength ? "esg-f" : ""));
      row.append(st);
      const del = h("button", "esg-sm", "×");
      del.title = "删除这条关系";
      del.onclick = () => {
        p.relations = p.relations.filter((x) => x !== r);
        const other = this.data.people.find((x) => x.name === r.to);
        if (other) other.relations = other.relations.filter((x) => x.to !== p.name);
        this.scheduleSave();
        this.rebuildGraph();
        this.refreshLists();
      };
      row.append(del);
      right.append(row);
    }
    if (!p.relations.length) {
      right.append(h("div", "esg-muted", "暂无关系记录"));
    }
    const addRel = h("div");
    addRel.style.marginTop = "8px";
    const sel = h("select");
    sel.style.marginBottom = "6px";
    const candidates = this.data.people.filter((x) => x.name !== p.name && !p.relations.some((r) => r.to === x.name));
    sel.append(option(candidates.length ? "选择对方…" : "没有可添加的人", ""));
    for (const c of candidates) sel.append(option(c.name, c.name));
    const typeInput = h("input");
    typeInput.placeholder = "关系类型，如 同事";
    typeInput.style.marginBottom = "6px";
    const strengthSel = h("select");
    strengthSel.style.marginBottom = "6px";
    for (let i = 1; i <= 5; i++) strengthSel.append(option(`${i} · ${strengthLabel(i)}`, String(i)));
    strengthSel.value = "3";
    const addBtn = h("button", "esg-sm esg-primary", "添加关系");
    addBtn.onclick = () => {
      const to = sel.value;
      if (!to) return;
      const type = typeInput.value.trim() || "其他";
      const strength = Number(strengthSel.value) || 3;
      const rel = { to, type, strength };
      p.relations.push(rel);
      const other = this.data.people.find((x) => x.name === to);
      if (other && !other.relations.some((r) => r.to === p.name)) {
        other.relations.push({ to: p.name, type, strength });
      }
      this.dedupe(p);
      this.dedupe(other || p);
      this.scheduleSave();
      this.rebuildGraph();
      this.refreshLists();
    };
    addRel.append(sel, typeInput, strengthSel, addBtn);
    right.append(addRel);
    const actSec = h("div", "esg-sec");
    actSec.append(document.createTextNode(`互动记录 (${p.interactions.length})`), h("div", "esg-spacer"));
    right.append(actSec);
    const sorted = [...p.interactions].sort((a, b) => a.date < b.date ? 1 : -1);
    for (const a of sorted) {
      const row = h("div", "esg-row");
      row.append(h("span", "esg-muted", a.date));
      row.append(h("span", "esg-grow", `${a.kind} ${a.text}`.trim()));
      const del = h("button", "esg-sm", "×");
      del.onclick = () => {
        p.interactions = p.interactions.filter((x) => x !== a);
        this.scheduleSave();
        this.refreshLists();
      };
      row.append(del);
      right.append(row);
    }
    if (!p.interactions.length) {
      right.append(h("div", "esg-muted", "暂无互动记录"));
    }
    const addAct = h("div");
    addAct.style.marginTop = "8px";
    const dInput = h("input");
    dInput.type = "date";
    dInput.value = today();
    dInput.style.marginBottom = "6px";
    const kInput = h("input");
    kInput.placeholder = "形式，如 线下 / 微信";
    kInput.style.marginBottom = "6px";
    const tInput = h("input");
    tInput.placeholder = "内容摘要";
    tInput.style.marginBottom = "6px";
    const actBtn = h("button", "esg-sm esg-primary", "添加互动");
    const submitAct = () => {
      const text = tInput.value.trim();
      if (!text) return;
      p.interactions.unshift({ date: dInput.value || today(), kind: kInput.value.trim() || "记录", text });
      this.scheduleSave();
      this.refreshLists();
    };
    actBtn.onclick = submitAct;
    tInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submitAct();
    });
    addAct.append(dInput, kInput, tInput, actBtn);
    right.append(addAct);
    const foot = h("div", "esg-actions");
    if (this.editing) {
      const save = h("button", "esg-primary", "创建此人物");
      save.onclick = () => {
        const name = p.name.trim();
        if (!name) {
          this.ctx.ui.showNotice("请填写姓名。");
          return;
        }
        if (this.data.people.some((x) => x.name === name)) {
          this.ctx.ui.showNotice("已存在同名人物。");
          return;
        }
        this.data.people.push(p);
        this.editing = null;
        this.selected = name;
        this.scheduleSave();
        this.rebuildGraph();
        this.refreshLists();
      };
      const cancel = h("button", "", "取消");
      cancel.onclick = () => {
        this.editing = null;
        this.selected = this.data.people[0]?.name || "";
        this.refreshLists();
      };
      foot.append(save, cancel);
    } else {
      const del = h("button", "esg-danger", "删除此人物");
      del.onclick = () => {
        this.data.people = this.data.people.filter((x) => x !== p);
        for (const other of this.data.people) {
          other.relations = other.relations.filter((r) => r.to !== p.name);
        }
        this.selected = this.data.people[0]?.name || "";
        this.scheduleSave();
        this.rebuildGraph();
        this.refreshLists();
      };
      foot.append(del);
    }
    right.append(foot);
    right.append(
      h(
        "div",
        "esg-scrollhint",
        this.loaded?.mode === "encrypted" ? "改动会加密写回「人际关系数据」笔记。密钥仅存于内存，关闭应用后需要重新输入密码。" : "改动的字段会自动写回对应的人物笔记，笔记格式与手写 Markdown 完全兼容。"
      )
    );
  }
  field(label, control) {
    const f = h("div", "esg-field");
    f.append(h("span", void 0, label), control);
    return f;
  }
  dedupe(p) {
    const seen = /* @__PURE__ */ new Set();
    p.relations = p.relations.filter((r) => {
      if (seen.has(r.to) || r.to === p.name) return false;
      seen.add(r.to);
      return true;
    });
  }
  startNewPerson() {
    this.editing = {
      name: "",
      group: this.allGroups()[0] || "其他",
      importance: 5,
      relations: [],
      interactions: []
    };
    const right = this.root.querySelector(".esg-right");
    if (right) this.renderDetail(right);
  }
  /* ------------------------------ 数据操作 ------------------------------ */
  allGroups() {
    const set = new Set(this.config.groups);
    for (const p of this.data.people) set.add(p.group);
    return [...set].filter(Boolean);
  }
  isGroupOn(name) {
    if (name === "__all") return this.activeGroups === null;
    if (this.activeGroups === null) return true;
    return this.activeGroups.has(name);
  }
  toggleGroup(name) {
    const groups = this.allGroups();
    if (name === "__all") {
      this.activeGroups = null;
      return;
    }
    if (this.activeGroups === null) {
      this.activeGroups = /* @__PURE__ */ new Set([name]);
      return;
    }
    const cur = new Set(this.activeGroups);
    if (cur.has(name)) cur.delete(name);
    else cur.add(name);
    this.activeGroups = cur.size === 0 || cur.size === groups.length ? null : cur;
  }
  filteredPeople() {
    const kw = this.search.toLowerCase();
    return this.data.people.filter((p) => !kw || p.name.toLowerCase().includes(kw)).filter((p) => p.importance >= this.minImp).filter((p) => this.activeGroups === null || this.activeGroups.has(p.group)).sort((a, b) => b.importance - a.importance || a.name.localeCompare(b.name, "zh"));
  }
  rebuildGraph() {
    this.graph?.setData(this.data.people);
    this.graph?.setFilter(this.activeGroups, this.minImp);
    if (this.selected) this.graph?.select(this.selected);
  }
  scheduleSave() {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.persist().catch(() => void 0);
    }, 320);
  }
  async persist() {
    if (this.disposed || !this.loaded) return;
    try {
      this.data.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      if (this.loaded.mode === "encrypted") {
        if (!this.key) return;
        await saveEncrypted(this.ctx, this.loaded, this.data, this.key, this.config);
      } else {
        const res = await savePlain(this.ctx, this.loaded, this.data.people);
        if (res.created || res.updated || res.removed) {
          this.loaded.rawNotes = await this.reloadRawNotes();
        }
      }
      const sub = this.root.querySelector(".esg-sub");
      if (sub) {
        sub.textContent = `笔记本：${this.config.notebookName} · ${this.data.people.length} 人 · ${this.edgeCount()} 条关系`;
      }
    } catch (e) {
      this.ctx.ui.showNotice(`保存失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }
  async reloadRawNotes() {
    if (!this.loaded) return [];
    const notes = await fetchNotebookNotes(this.ctx, this.loaded.notebook.id);
    return notes.filter((n) => !n.title?.startsWith(this.config.vaultNoteTitle));
  }
  async reindex() {
    this.key = null;
    if (this.loaded?.mode === "encrypted" && this.loaded.notebook.id) {
      const cached = sessionKeys.get(this.loaded.notebook.id);
      this.key = cached || null;
    }
    await this.bootstrap();
  }
  async exportMermaid() {
    if (!this.data.people.length) {
      this.ctx.ui.showNotice("还没有任何人物数据。");
      return;
    }
    const text = toMermaid(this.data.people);
    try {
      const title = "关系总览（自动生成）";
      const existing = (await this.reloadRawNotes()).find((n) => n.title === title);
      if (existing) {
        await this.ctx.notes.update(existing.id, { title, contentMarkdown: text });
      } else {
        await this.ctx.notes.create({
          notebookId: this.loaded.notebook.id,
          title,
          contentMarkdown: text,
          tags: ["人物/总览"]
        });
      }
      this.ctx.ui.showNotice("已生成「关系总览（自动生成）」笔记。");
    } catch (e) {
      this.ctx.ui.showNotice(`生成失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }
  /* ------------------------------ 安全设置 ------------------------------ */
  openSecurity() {
    const overlay = h("div", "esg-overlay");
    const card = h("div", "esg-card");
    const close = () => overlay.remove();
    overlay.onclick = (e) => {
      if (e.target === overlay) close();
    };
    const encrypted = this.loaded?.mode === "encrypted";
    card.append(h("h2", void 0, "安全设置"));
    card.append(
      h(
        "p",
        void 0,
        encrypted ? "当前为加密模式：数据以密文保存在单篇笔记中，需要密码才能解出。" : "当前为明文模式：每个人物是一篇标准笔记，可从宿主原生界面直接查看。"
      )
    );
    const body = h("div");
    card.append(body);
    const err = h("div", "esg-err");
    const actions = h("div", "esg-actions");
    const cancel = h("button", "", "关闭");
    cancel.onclick = close;
    actions.append(cancel);
    card.append(err, actions);
    const mkPw = (ph) => {
      const i = h("input");
      i.type = "password";
      i.placeholder = ph;
      i.style.marginBottom = "8px";
      return i;
    };
    if (!encrypted) {
      const note = h("div", "esg-note");
      note.style.marginBottom = "12px";
      note.textContent = "开启加密后，现有的人物笔记会被合并加密为单篇数据笔记，原明文笔记将移入回收站。加密模式下这些数据将无法被全文搜索与 AI 读取。";
      body.append(note);
      const pw1 = mkPw("设置密码（至少 6 位）");
      const pw2 = mkPw("再次输入密码");
      const conf = h("label");
      conf.style.cssText = "display:flex;gap:7px;align-items:flex-start;font-size:12px;color:var(--esg-text-2);margin:6px 0 4px";
      const cb = h("input");
      cb.type = "checkbox";
      cb.style.cssText = "width:auto;margin-top:3px";
      conf.append(cb, document.createTextNode("我明白密码遗失后数据无法恢复"));
      body.append(pw1, pw2, conf);
      const enable = h("button", "esg-primary", "开启加密");
      enable.onclick = async () => {
        err.textContent = "";
        if (pw1.value.length < 6) {
          err.textContent = "密码至少 6 位。";
          return;
        }
        if (pw1.value !== pw2.value) {
          err.textContent = "两次输入的密码不一致。";
          return;
        }
        if (!cb.checked) {
          err.textContent = "请先确认已了解密码遗失的后果。";
          return;
        }
        enable.disabled = true;
        try {
          const { meta, key } = await createVault(pw1.value);
          await migratePlainToEncrypted(this.ctx, this.loaded, this.data.people, meta, key, this.config);
          this.key = key;
          sessionKeys.set(this.loaded.notebook.id, key);
          close();
          this.ctx.ui.showNotice("已开启加密模式。");
          await this.bootstrap();
        } catch (e) {
          err.textContent = e instanceof Error ? e.message : String(e);
          enable.disabled = false;
        }
      };
      actions.append(enable);
    } else {
      const pwOld = mkPw("当前密码");
      pwOld.style.marginTop = "10px";
      body.append(pwOld);
      const secDiv = h("div");
      secDiv.style.cssText = "border-top:1px solid var(--esg-border-2);margin:14px 0;padding-top:14px";
      secDiv.append(h("p", "esg-label", "修改密码"));
      const pwNew = mkPw("新密码（至少 6 位）");
      const pwNew2 = mkPw("再次输入新密码");
      const change = h("button", "", "修改密码");
      change.onclick = async () => {
        err.textContent = "";
        if (!this.loaded?.meta) return;
        const ok = await unlockVault(pwOld.value, this.loaded.meta);
        if (!ok) {
          err.textContent = "当前密码不正确。";
          return;
        }
        if (pwNew.value.length < 6) {
          err.textContent = "新密码至少 6 位。";
          return;
        }
        if (pwNew.value !== pwNew2.value) {
          err.textContent = "两次输入的新密码不一致。";
          return;
        }
        change.disabled = true;
        try {
          const { meta, key } = await createVault(pwNew.value);
          const payload = await encryptJson(key, this.data);
          await this.ctx.notes.update(this.loaded.dataNote.id, {
            title: this.config.vaultNoteTitle,
            contentMarkdown: wrapVaultBody(meta, payload),
            tags: ["人物/加密数据"]
          });
          this.loaded.meta = meta;
          this.key = key;
          sessionKeys.set(this.loaded.notebook.id, key);
          close();
          this.ctx.ui.showNotice("密码已更新。");
        } catch (e) {
          err.textContent = e instanceof Error ? e.message : String(e);
          change.disabled = false;
        }
      };
      secDiv.append(pwNew, pwNew2, change);
      body.append(secDiv);
      const offDiv = h("div");
      offDiv.style.cssText = "border-top:1px solid var(--esg-border-2);margin:14px 0 0;padding-top:14px";
      offDiv.append(h("p", "esg-label", "取消密码保护"));
      const offNote = h("div", "esg-note");
      offNote.style.marginBottom = "10px";
      offNote.textContent = "取消后数据会拆回每人物一篇的明文笔记，任何人都能从笔记本树直接查看。密文数据笔记会被移入回收站。";
      const pwOff = mkPw("输入当前密码以确认");
      const off = h("button", "esg-danger", "取消加密");
      off.onclick = async () => {
        err.textContent = "";
        if (!this.loaded?.meta) return;
        const ok = await unlockVault(pwOff.value, this.loaded.meta);
        if (!ok) {
          err.textContent = "密码不正确。";
          return;
        }
        off.disabled = true;
        try {
          await migrateEncryptedToPlain(this.ctx, this.loaded, this.data);
          this.key = null;
          sessionKeys.delete(this.loaded.notebook.id);
          close();
          this.ctx.ui.showNotice("已取消加密，数据已还原为明文笔记。");
          await this.bootstrap();
        } catch (e) {
          err.textContent = e instanceof Error ? e.message : String(e);
          off.disabled = false;
        }
      };
      offDiv.append(offNote, pwOff, off);
      body.append(offDiv);
    }
    overlay.append(card);
    this.root.append(overlay);
  }
};
function createPanelDescriptor(ctx) {
  let current = null;
  return {
    id: "social-graph",
    title: "人际关系图谱",
    purpose: "dashboard",
    presentation: "fullscreen",
    mount(container) {
      current = new SocialGraphPanel(ctx, container);
      current.start();
      return () => {
        current?.destroy();
        current = null;
      };
    },
    beforeClose() {
      return true;
    }
  };
}

// src/index.ts
var PANEL_ID = "social-graph";
var plugin = {
  activate(context) {
    const disposers = [];
    disposers.push(context.ui.panels.register(createPanelDescriptor(context)));
    disposers.push(
      context.commands.register({
        id: "open",
        title: "人际关系图谱：打开面板",
        async run() {
          await context.ui.panels.open(PANEL_ID);
        }
      })
    );
    disposers.push(
      context.commands.register({
        id: "setup",
        title: "人际关系图谱：初始化「人际关系」笔记本",
        async run() {
          const config = await loadConfig(context);
          const nb = await findNotebook(context, config.notebookName);
          if (nb) {
            context.ui.showNotice(`「${config.notebookName}」笔记本已存在，正在打开面板。`);
          }
          await context.ui.panels.open(PANEL_ID);
        }
      })
    );
    disposers.push(
      context.commands.register({
        id: "security",
        title: "人际关系图谱：安全设置（开启或关闭加密）",
        async run() {
          await context.ui.panels.open(PANEL_ID);
          context.ui.showNotice("请在面板右上角点击「安全设置」。");
        }
      })
    );
    return () => {
      for (const d of disposers) {
        try {
          d();
        } catch {
        }
      }
    };
  }
};
var src_default = plugin;
export {
  src_default as default
};
