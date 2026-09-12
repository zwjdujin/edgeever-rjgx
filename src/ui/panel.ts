/**
 * panel.ts —— 插件主面板
 *
 * 三个状态：
 *   init   —— 尚未创建「人际关系」笔记本，引导初始化并选择是否设置密码
 *   lock   —— 加密模式且未解锁，显示密码输入
 *   main   —— 正常浏览与编辑
 *
 * 关于"密码保护"的实现边界（务必知悉）：
 *   插件无法阻止用户从宿主原生笔记本树直接打开笔记。因此密码真正保护数据的方式
 *   是把数据本身加密，而不是给笔记本挂锁。加密模式下，笔记正文是一串不可读的密文。
 */

import { createVault, encryptJson, passwordStrength, unlockVault } from '../crypto';
import { RelationGraph, toMermaid } from '../graph';
import { wrapVaultBody } from '../markdown';
import {
  Loaded,
  NotInitializedError,
  PluginConfig,
  decodeEncrypted,
  decodePlain,
  ensureNotebook,
  fetchNotebookNotes,
  load,
  loadConfig,
  migrateEncryptedToPlain,
  migratePlainToEncrypted,
  saveEncrypted,
  savePlain
} from '../store';
import {
  GraphData,
  Person,
  PluginContext,
  Relation,
  emptyGraph,
  groupColor,
  strengthLabel
} from '../types';
import { injectStyles } from './styles';

/** 本次运行内缓存的解锁密钥，关闭应用即失效 */
const sessionKeys = new Map<string, CryptoKey>();

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 显式创建 option，避免依赖宿主环境中的隐式全局 Option 构造函数 */
function option(label: string, value: string): HTMLOptionElement {
  const o = document.createElement('option');
  o.textContent = label;
  o.value = value;
  return o;
}

export class SocialGraphPanel {
  private ctx: PluginContext;
  private host: HTMLElement;
  private config: PluginConfig = { notebookName: '人际关系', vaultNoteTitle: '人际关系数据', groups: [] };
  private loaded: Loaded | null = null;
  private key: CryptoKey | null = null;
  private data: GraphData = emptyGraph();
  private graph: RelationGraph | null = null;
  private selected = '';
  private editing: Person | null = null;
  private search = '';
  private activeGroups: Set<string> | null = null;
  private minImp = 1;
  private saveTimer = 0;
  private disposed = false;
  private leftListWrap: HTMLElement | null = null;
  private rightPanel: HTMLElement | null = null;

  constructor(ctx: PluginContext, host: HTMLElement) {
    this.ctx = ctx;
    this.host = host;
  }

  /* ------------------------------ 生命周期 ------------------------------ */

  start() {
    injectStyles();
    this.host.replaceChildren();
    this.root = h('div', 'esg-root');
    this.host.append(this.root);
    void this.bootstrap();
  }

  private root!: HTMLElement;

  destroy() {
    this.disposed = true;
    window.clearTimeout(this.saveTimer);
    this.graph?.destroy();
    this.graph = null;
    this.host.replaceChildren();
  }

  private clearRoot() {
    this.graph?.destroy();
    this.graph = null;
    this.root.replaceChildren();
  }

  private async bootstrap() {
    this.clearRoot();
    this.root.append(h('div', 'esg-centerbox', '正在读取数据…'));

    try {
      this.config = await loadConfig(this.ctx);
    } catch {
      /* 用默认配置 */
    }

    let loaded: Loaded;
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

    if (loaded.mode === 'encrypted') {
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
        this.renderLock('密码不正确，或数据已损坏。');
        return;
      }
      this.key = key;
      this.data = data;
    } else {
      this.data = { version: 1, updatedAt: new Date().toISOString(), people: decodePlain(loaded) };
    }

    this.selected = this.data.people[0]?.name || '';
    this.renderMain();
  }

  /* ------------------------------ 错误页 ------------------------------ */

  private renderError(msg: string) {
    this.clearRoot();
    const box = h('div', 'esg-centerbox');
    const card = h('div', 'esg-card');
    card.append(h('h2', undefined, '读取失败'));
    card.append(h('p', undefined, msg));
    const act = h('div', 'esg-actions');
    const retry = h('button', 'esg-primary', '重试');
    retry.onclick = () => void this.bootstrap();
    act.append(retry);
    card.append(act);
    box.append(card);
    this.root.append(box);
  }

  /* ------------------------------ 初始化引导 ------------------------------ */

  private renderInit() {
    this.clearRoot();
    const box = h('div', 'esg-centerbox');
    const card = h('div', 'esg-card');

    card.append(h('h2', undefined, '初始化人际关系图谱'));
    const p = h('p');
    p.append(
      document.createTextNode('插件会新建一个名为 '),
      Object.assign(document.createElement('b'), { textContent: `「${this.config.notebookName}」` }),
      document.createTextNode(' 的笔记本用于存放数据。你还需要决定它是否需要密码保护。')
    );
    card.append(p);

    const radios = h('div', 'esg-radio');
    const mk = (value: string, label: string) => {
      const l = h('label');
      const r = h('input');
      r.type = 'radio';
      r.name = 'esg-mode';
      r.value = value;
      l.append(r, document.createTextNode(label));
      return { l, r };
    };
    const plainOpt = mk('plain', '不设密码（明文笔记）');
    const encOpt = mk('enc', '设置密码（加密存储）');
    plainOpt.r.checked = true;
    radios.append(plainOpt.l, encOpt.l);
    card.append(radios);

    const info = h('div', 'esg-note');
    card.append(info);

    const pwWrap = h('div');
    pwWrap.style.display = 'none';
    pwWrap.style.marginTop = '12px';

    const pw1 = h('input');
    pw1.type = 'password';
    pw1.placeholder = '设置密码';
    pw1.style.marginBottom = '8px';
    const pw2 = h('input');
    pw2.type = 'password';
    pw2.placeholder = '再次输入密码';
    const meter = h('div', 'esg-meter');
    for (let i = 0; i < 4; i++) meter.append(h('i'));
    const strength = h('div');
    strength.style.cssText = 'font-size:11px;color:var(--esg-text-3);margin-top:5px';
    const warn = h('div', 'esg-warn');
    warn.style.marginTop = '10px';
    warn.textContent =
      '加密模式下，密码遗失将导致数据无法恢复——插件不保存密码，也没有找回入口。建议同时做好笔记导出备份。';
    pwWrap.append(pw1, pw2, meter, strength, warn);
    card.append(pwWrap);

    const refreshInfo = () => {
      if (plainOpt.r.checked) {
        info.textContent =
          '明文模式：每个人物是一篇标准 Markdown 笔记，可全文搜索、参与同步、可被 MCP / AI 读取，也能随手导出。任何人都能从笔记本树直接翻开查看。';
        pwWrap.style.display = 'none';
      } else {
        info.textContent =
          '加密模式：整份关系数据会加密后存入单篇笔记（密码派生密钥，AES-GCM）。即使从笔记本树点进去也只能看到密文。代价是这批数据不再能被全文搜索与 AI 直接读取。';
        pwWrap.style.display = '';
      }
    };
    plainOpt.r.onchange = refreshInfo;
    encOpt.r.onchange = refreshInfo;
    refreshInfo();

    const updateMeter = () => {
      const s = passwordStrength(pw1.value);
      meter.querySelectorAll('i').forEach((el, i) => el.classList.toggle('esg-f', i <= s.score && pw1.value.length > 0));
      strength.textContent = pw1.value ? `强度：${s.label}` : '';
    };
    pw1.oninput = updateMeter;

    const err = h('div', 'esg-err');
    const actions = h('div', 'esg-actions');
    const go = h('button', 'esg-primary', '创建并开始使用');
    go.onclick = async () => {
      err.textContent = '';
      go.disabled = true;
      try {
        if (encOpt.r.checked) {
          const pw = pw1.value;
          if (pw.length < 6) throw new Error('密码至少 6 位。');
          if (pw !== pw2.value) throw new Error('两次输入的密码不一致。');
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

  private async initVault(password: string) {
    const { meta, key } = await createVault(password);
    const nb = await ensureNotebook(this.ctx, this.config.notebookName);
    const data = emptyGraph();
    const payload = await encryptJson(key, data);
    await this.ctx.notes.create({
      notebookId: nb.id,
      title: this.config.vaultNoteTitle,
      contentMarkdown: wrapVaultBody(meta, payload),
      tags: ['人物/加密数据']
    });
    this.key = key;
    sessionKeys.set(nb.id, key);
  }

  /* ------------------------------ 锁屏 ------------------------------ */

  private renderLock(message?: string) {
    this.clearRoot();
    const box = h('div', 'esg-centerbox');
    const card = h('div', 'esg-card');

    const icon = h('div', 'esg-lockicon');
    icon.innerHTML =
      '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="#16a06e" stroke-width="1.5"><rect x="3.5" y="7.5" width="11" height="8" rx="2"/><path d="M6 7.5V5.6a3 3 0 0 1 6 0v1.9"/></svg>';
    card.append(icon);

    card.append(h('h2', undefined, '人际关系数据已加密'));
    card.append(
      h('p', undefined, `输入密码以解锁「${this.config.notebookName}」中的数据。密钥仅在内存中派生，不会写入任何存储。`)
    );

    const pw = h('input');
    pw.type = 'password';
    pw.placeholder = '密码';
    card.append(pw);

    const err = h('div', 'esg-err', message || '');
    const actions = h('div', 'esg-actions');
    const go = h('button', 'esg-primary', '解锁');
    const submit = async () => {
      if (!this.loaded?.meta) {
        err.textContent = '加密元信息缺失，无法解锁。';
        return;
      }
      if (!pw.value) return;
      go.disabled = true;
      err.textContent = '';
      try {
        const key = await unlockVault(pw.value, this.loaded.meta);
        if (!key) {
          err.textContent = '密码不正确。';
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
    pw.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') void submit();
    });
    actions.append(go);

    const tip = h('div', 'esg-note');
    tip.textContent =
      '可以在笔记里找到「人际关系数据」查看密文，但内容需要密码才能解出。若忘记密码，本插件无法恢复数据。';
    card.append(err, actions, tip);

    box.append(card);
    this.root.append(box);
    setTimeout(() => pw.focus(), 30);
  }

  /* ------------------------------ 主界面 ------------------------------ */

  private renderMain() {
    this.clearRoot();

    const top = h('div', 'esg-top');
    const logo = h('div', 'esg-logo');
    logo.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 14 14"><circle cx="4" cy="4" r="2.2" fill="#fff"/><circle cx="10.5" cy="6" r="1.8" fill="#fff" opacity=".85"/><circle cx="5.5" cy="10.5" r="1.8" fill="#fff" opacity=".85"/><path d="M4 4L10.5 6M4 4L5.5 10.5" stroke="#fff" stroke-width="1" opacity=".7"/></svg>';
    const tt = h('div');
    tt.append(h('p', 'esg-title', '人际关系图谱'));
    tt.append(
      h(
        'div',
        'esg-sub',
        `笔记本：${this.config.notebookName} · ${this.data.people.length} 人 · ${this.edgeCount()} 条关系`
      )
    );
    const badge = h(
      'span',
      this.loaded?.mode === 'encrypted' ? 'esg-badge esg-lock' : 'esg-badge',
      this.loaded?.mode === 'encrypted' ? '加密模式' : '明文模式'
    );
    top.append(logo, tt, badge, h('div', 'esg-spacer'));

    const mkBtn = (label: string, cls: string, fn: () => void) => {
      const b = h('button', cls, label);
      b.onclick = fn;
      return b;
    };
    top.append(
      mkBtn('新增人物', 'esg-primary', () => this.startNewPerson()),
      mkBtn('重新索引', '', () => void this.reindex()),
      mkBtn('导出图谱', '', () => void this.exportMermaid()),
      mkBtn('安全设置', '', () => this.openSecurity())
    );
    if (this.loaded?.mode === 'encrypted') {
      top.append(
        mkBtn('立即锁定', '', () => {
          if (this.loaded?.notebook?.id) sessionKeys.delete(this.loaded.notebook.id);
          this.key = null;
          this.renderLock();
        })
      );
    }
    this.root.append(top);

    const body = h('div', 'esg-body');
    const left = h('div', 'esg-col esg-left');
    const center = h('div', 'esg-col esg-center');
    const right = h('div', 'esg-col esg-right');
    body.append(left, center, right);
    this.root.append(body);

    this.renderLeft(left);
    this.renderCenter(center);
    this.rightPanel = right;
    this.renderDetail(right);
  }

  private edgeCount(): number {
    const seen = new Set<string>();
    for (const p of this.data.people) {
      for (const r of p.relations) {
        const k = [p.name, r.to].sort().join('\u0000');
        seen.add(k);
      }
    }
    return seen.size;
  }

  private renderLeft(left: HTMLElement) {
    left.replaceChildren();

    const search = h('input');
    search.placeholder = '搜索姓名…';
    search.value = this.search;
    search.oninput = () => {
      this.search = search.value.trim();
      if (this.leftListWrap) this.renderLeftList(this.leftListWrap);
    };
    const searchBox = h('div');
    searchBox.style.marginBottom = '14px';
    searchBox.append(search);
    left.append(searchBox);

    left.append(h('p', 'esg-label', '圈层'));
    const chips = h('div');
    chips.style.marginBottom = '6px';
    const groups = this.allGroups();
    const mkChip = (name: string, label: string, color?: string) => {
      const c = h('span', 'esg-chip' + (this.isGroupOn(name) ? ' esg-on' : ''));
      if (color) {
        const d = h('span', 'esg-dot');
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
    chips.append(mkChip('__all', '全部'));
    for (const g of groups) chips.append(mkChip(g, g, groupColor(g)));
    left.append(chips);

    const impWrap = h('div');
    impWrap.style.cssText = 'display:flex;align-items:center;gap:8px;margin:6px 0 16px;font-size:11.5px;color:var(--esg-text-3)';
    const imp = h('input');
    imp.type = 'range';
    imp.min = '1';
    imp.max = '10';
    imp.value = String(this.minImp);
    imp.style.padding = '0';
    imp.oninput = () => {
      this.minImp = Number(imp.value);
      this.graph?.setFilter(this.activeGroups, this.minImp);
      this.renderLeftList(listWrap);
    };
    impWrap.append(document.createTextNode('重要度 ≥'), imp);
    left.append(impWrap);

    left.append(h('p', 'esg-label', '人物'));
    const listWrap = h('div');
    this.leftListWrap = listWrap;
    left.append(listWrap);
    this.renderLeftList(listWrap);
  }

  private renderLeftList(wrap: HTMLElement) {
    wrap.replaceChildren();
    const people = this.filteredPeople();
    if (!people.length) {
      wrap.append(h('div', 'esg-empty', '没有符合条件的人物'));
      return;
    }
    for (const p of people) {
      const item = h('div', 'esg-pitem' + (p.name === this.selected ? ' esg-on' : ''));
      const av = h('span', 'esg-av', p.name.slice(0, 1));
      av.style.background = groupColor(p.group);
      item.append(av, h('span', 'esg-nm', p.name), h('span', 'esg-gp', p.group));
      item.onclick = () => {
        this.selected = p.name;
        this.editing = null;
        this.graph?.select(p.name);
        this.refreshLists();
      };
      wrap.append(item);
    }
  }

  private refreshLists() {
    if (this.leftListWrap) this.renderLeftList(this.leftListWrap);
    if (this.rightPanel) this.renderDetail(this.rightPanel);
  }

  private renderCenter(center: HTMLElement) {
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
    center.append(h('div', 'esg-hint', '拖拽节点调整 · 点击查看详情 · 悬停高亮邻居'));
  }

  /* ------------------------------ 详情与编辑 ------------------------------ */

  private renderDetail(right: HTMLElement) {
    right.replaceChildren();

    const p = this.editing || this.data.people.find((x) => x.name === this.selected) || null;
    if (!p) {
      right.append(h('div', 'esg-empty', '左侧选择一个人物，或点击「新增人物」。'));
      return;
    }

    const head = h('div', 'esg-phead');
    const av = h('div', 'esg-pav', p.name.slice(0, 1) || '?');
    av.style.background = groupColor(p.group);
    const nameWrap = h('div');
    const nameInput = h('input');
    nameInput.value = p.name;
    nameInput.style.cssText = 'font-size:14px;font-weight:500;padding:4px 8px';
    nameInput.onchange = () => {
      const next = nameInput.value.trim();
      if (!next) {
        nameInput.value = p.name;
        return;
      }
      const old = p.name;
      const conflict = this.data.people.some((x) => x !== p && x.name === next);
      if (conflict) {
        this.ctx.ui.showNotice('已存在同名人物。');
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

    const groupSel = h('select');
    for (const g of this.allGroups()) {
      const o = h('option', undefined, g);
      o.value = g;
      groupSel.append(o);
    }
    groupSel.value = this.allGroups().includes(p.group) ? p.group : '其他';
    groupSel.onchange = () => {
      p.group = groupSel.value;
      av.style.background = groupColor(p.group);
      this.scheduleSave();
      this.rebuildGraph();
    };

    const impInput = h('input');
    impInput.type = 'number';
    impInput.min = '1';
    impInput.max = '10';
    impInput.value = String(p.importance);
    impInput.onchange = () => {
      p.importance = Math.max(1, Math.min(10, Number(impInput.value) || 5));
      impInput.value = String(p.importance);
      this.scheduleSave();
      this.rebuildGraph();
    };

    const sinceInput = h('input');
    sinceInput.placeholder = '如 2019-03';
    sinceInput.value = p.since || '';
    sinceInput.onchange = () => {
      p.since = sinceInput.value.trim() || undefined;
      this.scheduleSave();
    };

    const noteInput = h('input');
    noteInput.placeholder = '一句话备注';
    noteInput.value = p.note || '';
    noteInput.onchange = () => {
      p.note = noteInput.value.trim() || undefined;
      this.scheduleSave();
    };

    right.append(
      this.field('圈层', groupSel),
      this.field('重要度', impInput),
      this.field('认识于', sinceInput),
      this.field('备注', noteInput)
    );

    /* 人际关系 */
    const relSec = h('div', 'esg-sec');
    relSec.append(document.createTextNode(`人际关系 (${p.relations.length})`), h('div', 'esg-spacer'));
    right.append(relSec);

    for (const r of p.relations) {
      const row = h('div', 'esg-row');
      row.append(h('span', 'esg-grow', `${r.to} · ${r.type}`));
      const st = h('span', 'esg-strength');
      for (let i = 1; i <= 5; i++) st.append(h('i', i <= r.strength ? 'esg-f' : ''));
      row.append(st);
      const del = h('button', 'esg-sm', '×');
      del.title = '删除这条关系';
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
      right.append(h('div', 'esg-muted', '暂无关系记录'));
    }

    const addRel = h('div');
    addRel.style.marginTop = '8px';
    const sel = h('select');
    sel.style.marginBottom = '6px';
    const candidates = this.data.people.filter((x) => x.name !== p.name && !p.relations.some((r) => r.to === x.name));
    sel.append(option(candidates.length ? '选择对方…' : '没有可添加的人', ''));
    for (const c of candidates) sel.append(option(c.name, c.name));
    const typeInput = h('input');
    typeInput.placeholder = '关系类型，如 同事';
    typeInput.style.marginBottom = '6px';
    const strengthSel = h('select');
    strengthSel.style.marginBottom = '6px';
    for (let i = 1; i <= 5; i++) strengthSel.append(option(`${i} · ${strengthLabel(i)}`, String(i)));
    strengthSel.value = '3';
    const addBtn = h('button', 'esg-sm esg-primary', '添加关系');
    addBtn.onclick = () => {
      const to = sel.value;
      if (!to) return;
      const type = typeInput.value.trim() || '其他';
      const strength = Number(strengthSel.value) || 3;
      const rel: Relation = { to, type, strength };
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

    /* 互动记录 */
    const actSec = h('div', 'esg-sec');
    actSec.append(document.createTextNode(`互动记录 (${p.interactions.length})`), h('div', 'esg-spacer'));
    right.append(actSec);

    const sorted = [...p.interactions].sort((a, b) => (a.date < b.date ? 1 : -1));
    for (const a of sorted) {
      const row = h('div', 'esg-row');
      row.append(h('span', 'esg-muted', a.date));
      row.append(h('span', 'esg-grow', `${a.kind} ${a.text}`.trim()));
      const del = h('button', 'esg-sm', '×');
      del.onclick = () => {
        p.interactions = p.interactions.filter((x) => x !== a);
        this.scheduleSave();
        this.refreshLists();
      };
      row.append(del);
      right.append(row);
    }
    if (!p.interactions.length) {
      right.append(h('div', 'esg-muted', '暂无互动记录'));
    }

    const addAct = h('div');
    addAct.style.marginTop = '8px';
    const dInput = h('input');
    dInput.type = 'date';
    dInput.value = today();
    dInput.style.marginBottom = '6px';
    const kInput = h('input');
    kInput.placeholder = '形式，如 线下 / 微信';
    kInput.style.marginBottom = '6px';
    const tInput = h('input');
    tInput.placeholder = '内容摘要';
    tInput.style.marginBottom = '6px';
    const actBtn = h('button', 'esg-sm esg-primary', '添加互动');
    const submitAct = () => {
      const text = tInput.value.trim();
      if (!text) return;
      p.interactions.unshift({ date: dInput.value || today(), kind: kInput.value.trim() || '记录', text });
      this.scheduleSave();
      this.refreshLists();
    };
    actBtn.onclick = submitAct;
    tInput.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') submitAct();
    });
    addAct.append(dInput, kInput, tInput, actBtn);
    right.append(addAct);

    /* 底部操作 */
    const foot = h('div', 'esg-actions');
    if (this.editing) {
      const save = h('button', 'esg-primary', '创建此人物');
      save.onclick = () => {
        const name = p.name.trim();
        if (!name) {
          this.ctx.ui.showNotice('请填写姓名。');
          return;
        }
        if (this.data.people.some((x) => x.name === name)) {
          this.ctx.ui.showNotice('已存在同名人物。');
          return;
        }
        this.data.people.push(p);
        this.editing = null;
        this.selected = name;
        this.scheduleSave();
        this.rebuildGraph();
        this.refreshLists();
      };
      const cancel = h('button', '', '取消');
      cancel.onclick = () => {
        this.editing = null;
        this.selected = this.data.people[0]?.name || '';
        this.refreshLists();
      };
      foot.append(save, cancel);
    } else {
      const del = h('button', 'esg-danger', '删除此人物');
      del.onclick = () => {
        this.data.people = this.data.people.filter((x) => x !== p);
        for (const other of this.data.people) {
          other.relations = other.relations.filter((r) => r.to !== p.name);
        }
        this.selected = this.data.people[0]?.name || '';
        this.scheduleSave();
        this.rebuildGraph();
        this.refreshLists();
      };
      foot.append(del);
    }
    right.append(foot);

    right.append(
      h(
        'div',
        'esg-scrollhint',
        this.loaded?.mode === 'encrypted'
          ? '改动会加密写回「人际关系数据」笔记。密钥仅存于内存，关闭应用后需要重新输入密码。'
          : '改动的字段会自动写回对应的人物笔记，笔记格式与手写 Markdown 完全兼容。'
      )
    );
  }

  private field(label: string, control: HTMLElement): HTMLElement {
    const f = h('div', 'esg-field');
    f.append(h('span', undefined, label), control);
    return f;
  }

  private dedupe(p: Person) {
    const seen = new Set<string>();
    p.relations = p.relations.filter((r) => {
      if (seen.has(r.to) || r.to === p.name) return false;
      seen.add(r.to);
      return true;
    });
  }

  private startNewPerson() {
    this.editing = {
      name: '',
      group: this.allGroups()[0] || '其他',
      importance: 5,
      relations: [],
      interactions: []
    };
    const right = this.root.querySelector('.esg-right') as HTMLElement | null;
    if (right) this.renderDetail(right);
  }

  /* ------------------------------ 数据操作 ------------------------------ */

  private allGroups(): string[] {
    const set = new Set<string>(this.config.groups);
    for (const p of this.data.people) set.add(p.group);
    return [...set].filter(Boolean);
  }

  private isGroupOn(name: string): boolean {
    if (name === '__all') return this.activeGroups === null;
    if (this.activeGroups === null) return true;
    return this.activeGroups.has(name);
  }

  private toggleGroup(name: string) {
    const groups = this.allGroups();
    if (name === '__all') {
      this.activeGroups = null;
      return;
    }
    // 初始为「全部」：点击某一圈层即进入「只看这一圈层」
    if (this.activeGroups === null) {
      this.activeGroups = new Set([name]);
      return;
    }
    const cur = new Set(this.activeGroups);
    if (cur.has(name)) cur.delete(name);
    else cur.add(name);
    // 空集合或已包含全部圈层时，回到「全部」
    this.activeGroups = cur.size === 0 || cur.size === groups.length ? null : cur;
  }

  private filteredPeople(): Person[] {
    const kw = this.search.toLowerCase();
    return this.data.people
      .filter((p) => !kw || p.name.toLowerCase().includes(kw))
      .filter((p) => p.importance >= this.minImp)
      .filter((p) => this.activeGroups === null || this.activeGroups.has(p.group))
      .sort((a, b) => b.importance - a.importance || a.name.localeCompare(b.name, 'zh'));
  }

  private rebuildGraph() {
    this.graph?.setData(this.data.people);
    this.graph?.setFilter(this.activeGroups, this.minImp);
    if (this.selected) this.graph?.select(this.selected);
  }

  private scheduleSave() {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.persist().catch(() => undefined);
    }, 320);
  }

  private async persist() {
    if (this.disposed || !this.loaded) return;
    try {
      this.data.updatedAt = new Date().toISOString();
      if (this.loaded.mode === 'encrypted') {
        if (!this.key) return;
        await saveEncrypted(this.ctx, this.loaded, this.data, this.key, this.config);
      } else {
        const res = await savePlain(this.ctx, this.loaded, this.data.people);
        if (res.created || res.updated || res.removed) {
          this.loaded.rawNotes = await this.reloadRawNotes();
        }
      }
      const sub = this.root.querySelector('.esg-sub');
      if (sub) {
        sub.textContent = `笔记本：${this.config.notebookName} · ${this.data.people.length} 人 · ${this.edgeCount()} 条关系`;
      }
    } catch (e) {
      this.ctx.ui.showNotice(`保存失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private async reloadRawNotes() {
    if (!this.loaded) return [];
    const notes = await fetchNotebookNotes(this.ctx, this.loaded.notebook.id);
    return notes.filter((n) => !n.title?.startsWith(this.config.vaultNoteTitle));
  }

  private async reindex() {
    this.key = null;
    if (this.loaded?.mode === 'encrypted' && this.loaded.notebook.id) {
      const cached = sessionKeys.get(this.loaded.notebook.id);
      this.key = cached || null;
    }
    await this.bootstrap();
  }

  private async exportMermaid() {
    if (!this.data.people.length) {
      this.ctx.ui.showNotice('还没有任何人物数据。');
      return;
    }
    const text = toMermaid(this.data.people);
    try {
      const title = '关系总览（自动生成）';
      const existing = (await this.reloadRawNotes()).find((n) => n.title === title);
      if (existing) {
        await this.ctx.notes.update(existing.id, { title, contentMarkdown: text });
      } else {
        await this.ctx.notes.create({
          notebookId: this.loaded!.notebook.id,
          title,
          contentMarkdown: text,
          tags: ['人物/总览']
        });
      }
      this.ctx.ui.showNotice('已生成「关系总览（自动生成）」笔记。');
    } catch (e) {
      this.ctx.ui.showNotice(`生成失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /* ------------------------------ 安全设置 ------------------------------ */

  private openSecurity() {
    const overlay = h('div', 'esg-overlay');
    const card = h('div', 'esg-card');
    const close = () => overlay.remove();
    overlay.onclick = (e) => {
      if (e.target === overlay) close();
    };

    const encrypted = this.loaded?.mode === 'encrypted';
    card.append(h('h2', undefined, '安全设置'));
    card.append(
      h(
        'p',
        undefined,
        encrypted
          ? '当前为加密模式：数据以密文保存在单篇笔记中，需要密码才能解出。'
          : '当前为明文模式：每个人物是一篇标准笔记，可从宿主原生界面直接查看。'
      )
    );

    const body = h('div');
    card.append(body);

    const err = h('div', 'esg-err');
    const actions = h('div', 'esg-actions');
    const cancel = h('button', '', '关闭');
    cancel.onclick = close;
    actions.append(cancel);
    card.append(err, actions);

    const mkPw = (ph: string) => {
      const i = h('input');
      i.type = 'password';
      i.placeholder = ph;
      i.style.marginBottom = '8px';
      return i;
    };

    if (!encrypted) {
      const note = h('div', 'esg-note');
      note.style.marginBottom = '12px';
      note.textContent =
        '开启加密后，现有的人物笔记会被合并加密为单篇数据笔记，原明文笔记将移入回收站。加密模式下这些数据将无法被全文搜索与 AI 读取。';
      body.append(note);

      const pw1 = mkPw('设置密码（至少 6 位）');
      const pw2 = mkPw('再次输入密码');
      const conf = h('label');
      conf.style.cssText = 'display:flex;gap:7px;align-items:flex-start;font-size:12px;color:var(--esg-text-2);margin:6px 0 4px';
      const cb = h('input');
      cb.type = 'checkbox';
      cb.style.cssText = 'width:auto;margin-top:3px';
      conf.append(cb, document.createTextNode('我明白密码遗失后数据无法恢复'));
      body.append(pw1, pw2, conf);

      const enable = h('button', 'esg-primary', '开启加密');
      enable.onclick = async () => {
        err.textContent = '';
        if (pw1.value.length < 6) {
          err.textContent = '密码至少 6 位。';
          return;
        }
        if (pw1.value !== pw2.value) {
          err.textContent = '两次输入的密码不一致。';
          return;
        }
        if (!cb.checked) {
          err.textContent = '请先确认已了解密码遗失的后果。';
          return;
        }
        enable.disabled = true;
        try {
          const { meta, key } = await createVault(pw1.value);
          await migratePlainToEncrypted(this.ctx, this.loaded!, this.data.people, meta, key, this.config);
          this.key = key;
          sessionKeys.set(this.loaded!.notebook.id, key);
          close();
          this.ctx.ui.showNotice('已开启加密模式。');
          await this.bootstrap();
        } catch (e) {
          err.textContent = e instanceof Error ? e.message : String(e);
          enable.disabled = false;
        }
      };
      actions.append(enable);
    } else {
      const pwOld = mkPw('当前密码');
      pwOld.style.marginTop = '10px';
      body.append(pwOld);

      const secDiv = h('div');
      secDiv.style.cssText = 'border-top:1px solid var(--esg-border-2);margin:14px 0;padding-top:14px';
      secDiv.append(h('p', 'esg-label', '修改密码'));
      const pwNew = mkPw('新密码（至少 6 位）');
      const pwNew2 = mkPw('再次输入新密码');
      const change = h('button', '', '修改密码');
      change.onclick = async () => {
        err.textContent = '';
        if (!this.loaded?.meta) return;
        const ok = await unlockVault(pwOld.value, this.loaded.meta);
        if (!ok) {
          err.textContent = '当前密码不正确。';
          return;
        }
        if (pwNew.value.length < 6) {
          err.textContent = '新密码至少 6 位。';
          return;
        }
        if (pwNew.value !== pwNew2.value) {
          err.textContent = '两次输入的新密码不一致。';
          return;
        }
        change.disabled = true;
        try {
          const { meta, key } = await createVault(pwNew.value);
          const payload = await encryptJson(key, this.data);
          await this.ctx.notes.update(this.loaded.dataNote!.id, {
            title: this.config.vaultNoteTitle,
            contentMarkdown: wrapVaultBody(meta, payload),
            tags: ['人物/加密数据']
          });
          this.loaded.meta = meta;
          this.key = key;
          sessionKeys.set(this.loaded.notebook.id, key);
          close();
          this.ctx.ui.showNotice('密码已更新。');
        } catch (e) {
          err.textContent = e instanceof Error ? e.message : String(e);
          change.disabled = false;
        }
      };
      secDiv.append(pwNew, pwNew2, change);
      body.append(secDiv);

      const offDiv = h('div');
      offDiv.style.cssText = 'border-top:1px solid var(--esg-border-2);margin:14px 0 0;padding-top:14px';
      offDiv.append(h('p', 'esg-label', '取消密码保护'));
      const offNote = h('div', 'esg-note');
      offNote.style.marginBottom = '10px';
      offNote.textContent =
        '取消后数据会拆回每人物一篇的明文笔记，任何人都能从笔记本树直接查看。密文数据笔记会被移入回收站。';
      const pwOff = mkPw('输入当前密码以确认');
      const off = h('button', 'esg-danger', '取消加密');
      off.onclick = async () => {
        err.textContent = '';
        if (!this.loaded?.meta) return;
        const ok = await unlockVault(pwOff.value, this.loaded.meta);
        if (!ok) {
          err.textContent = '密码不正确。';
          return;
        }
        off.disabled = true;
        try {
          await migrateEncryptedToPlain(this.ctx, this.loaded, this.data);
          this.key = null;
          sessionKeys.delete(this.loaded.notebook.id);
          close();
          this.ctx.ui.showNotice('已取消加密，数据已还原为明文笔记。');
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
}

export function createPanelDescriptor(ctx: PluginContext) {
  let current: SocialGraphPanel | null = null;
  return {
    id: 'social-graph',
    title: '人际关系图谱',
    purpose: 'dashboard' as const,
    presentation: 'fullscreen' as const,
    mount(container: HTMLElement) {
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
