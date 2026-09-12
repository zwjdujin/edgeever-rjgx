/**
 * store.ts —— 双模式存储层
 *
 * 这是本插件最关键的一层，决定了"密码保护"到底能不能真正生效。
 *
 * 【为什么必须这样做】
 * EdgeEver 的插件 API 无法拦截宿主的原生 UI —— 插件不能阻止用户直接从
 * 左侧笔记本树点开某个笔记本。所以"给笔记本加一把锁"在插件层面是不可能实现的。
 *
 * 唯一真正有效的做法是：让数据本身以密文形态存在。
 *   · 明文模式（不设密码）：每人一篇人物笔记，享受同步/搜索/导出/MCP 全部能力
 *   · 加密模式（设了密码）：整个图谱加密成一串密文，塞进单篇数据笔记
 * 加密模式下，用户即使从原生笔记树点进去，看到的也只是不可读的 base64。
 */

import { KdfMeta, decryptJson, encryptJson } from './crypto';
import { VAULT_NOTE_TITLE, isVaultNote, parsePerson, parseVaultBody, serializePerson, wrapVaultBody } from './markdown';
import { GraphData, NoteContent, Notebook, Person, PluginContext, emptyGraph } from './types';

export interface PluginConfig {
  notebookName: string;
  vaultNoteTitle: string;
  groups: string[];
}

export const DEFAULT_CONFIG: PluginConfig = {
  notebookName: '人际关系',
  vaultNoteTitle: VAULT_NOTE_TITLE,
  groups: ['家人', '同事', '朋友', '客户', '网友', '其他']
};

export async function loadConfig(ctx: PluginContext): Promise<PluginConfig> {
  const read = async (key: string, fallback: string) => {
    try {
      const v = await ctx.settings.get(key);
      return typeof v === 'string' && v.trim() ? v.trim() : fallback;
    } catch {
      return fallback;
    }
  };
  const notebookName = await read('notebookName', DEFAULT_CONFIG.notebookName);
  const vaultNoteTitle = await read('vaultNoteTitle', DEFAULT_CONFIG.vaultNoteTitle);
  const groupsRaw = await read('groups', DEFAULT_CONFIG.groups.join(','));
  const groups = groupsRaw
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    notebookName,
    vaultNoteTitle,
    groups: groups.length ? groups : DEFAULT_CONFIG.groups
  };
}

/* ------------------------------ 宿主返回值的容错 ------------------------------ */

function normalizeList(res: unknown): any[] {
  if (Array.isArray(res)) return res;
  const o: any = res;
  const items = o?.items || o?.notes || o?.notebooks || o?.results || o?.data || o?.list;
  return Array.isArray(items) ? items : [];
}

function normalizePage(res: unknown): { items: any[]; nextOffset: number | null } {
  if (Array.isArray(res)) return { items: res, nextOffset: null };
  const o: any = res;
  const items = o?.items || o?.notes || o?.results || o?.data || [];
  const next = o?.nextOffset ?? o?.next ?? null;
  return {
    items: Array.isArray(items) ? items : [],
    nextOffset: typeof next === 'number' ? next : null
  };
}

/* --------------------------------- 笔记本 --------------------------------- */

export async function findNotebook(ctx: PluginContext, name: string): Promise<Notebook | null> {
  const list = normalizeList(await ctx.notebooks.list());
  return (list.find((n) => n && n.name === name) as Notebook) || null;
}

export async function ensureNotebook(ctx: PluginContext, name: string): Promise<Notebook> {
  const found = await findNotebook(ctx, name);
  if (found) return found;
  return ctx.notebooks.create({ name, parentId: null });
}

/* --------------------------------- 读取 --------------------------------- */

export interface Loaded {
  notebook: Notebook;
  mode: 'plain' | 'encrypted';
  /** 加密模式下的数据笔记 */
  dataNote?: NoteContent;
  meta?: KdfMeta;
  payload?: string;
  /** 明文模式下解析出来的原始笔记（含 id，写回时要复用） */
  rawNotes: NoteContent[];
}

export class NotInitializedError extends Error {
  constructor(public notebookName: string) {
    super(`尚未创建「${notebookName}」笔记本`);
  }
}

export async function fetchNotebookNotes(ctx: PluginContext, notebookId: string): Promise<NoteContent[]> {
  const out: NoteContent[] = [];
  let offset = 0;
  for (let page = 0; page < 50; page++) {
    const res = await ctx.notes.queryContent({ notebookId, limit: 200, offset });
    const { items, nextOffset } = normalizePage(res);
    for (const it of items) {
      if (!it || !it.id) continue;
      if (typeof it.contentMarkdown === 'string') {
        out.push(it as NoteContent);
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

export async function load(ctx: PluginContext, config: PluginConfig): Promise<Loaded> {
  const notebook = await findNotebook(ctx, config.notebookName);
  if (!notebook) throw new NotInitializedError(config.notebookName);

  const notes = await fetchNotebookNotes(ctx, notebook.id);

  const vault = notes.find((n) => isVaultNote(n.contentMarkdown) || n.title === config.vaultNoteTitle);
  if (vault) {
    const parsed = parseVaultBody(vault.contentMarkdown || '');
    return {
      notebook,
      mode: 'encrypted',
      dataNote: vault,
      meta: parsed.meta || undefined,
      payload: parsed.payload || undefined,
      rawNotes: notes.filter((n) => n.id !== vault.id)
    };
  }

  return { notebook, mode: 'plain', rawNotes: notes };
}

/** 明文模式：把笔记解析成人物列表 */
export function decodePlain(loaded: Loaded): Person[] {
  const people: Person[] = [];
  for (const n of loaded.rawNotes) {
    const p = parsePerson(n.contentMarkdown || '');
    if (p) people.push(p);
  }
  return people;
}

/** 加密模式：用密钥解出图谱 */
export async function decodeEncrypted(loaded: Loaded, key: CryptoKey): Promise<GraphData | null> {
  if (!loaded.payload) return emptyGraph();
  return decryptJson<GraphData>(key, loaded.payload);
}

/* --------------------------------- 写入 --------------------------------- */

export async function savePlain(
  ctx: PluginContext,
  loaded: Loaded,
  people: Person[]
): Promise<{ created: number; updated: number; removed: number }> {
  const byTitle = new Map<string, NoteContent>();
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
      if ((existing.contentMarkdown || '') !== md) {
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
        /* 忽略单篇失败 */
      }
    }
  }

  return { created, updated, removed };
}

export async function saveEncrypted(
  ctx: PluginContext,
  loaded: Loaded,
  data: GraphData,
  key: CryptoKey,
  config: PluginConfig
): Promise<void> {
  if (!loaded.meta) throw new Error('缺少加密元信息，无法写入。');
  const payload = await encryptJson(key, data);
  const body = wrapVaultBody(loaded.meta, payload);

  if (loaded.dataNote) {
    await ctx.notes.update(loaded.dataNote.id, {
      title: config.vaultNoteTitle,
      contentMarkdown: body,
      tags: ['人物/加密数据']
    });
  } else {
    const created = await ctx.notes.create({
      notebookId: loaded.notebook.id,
      title: config.vaultNoteTitle,
      contentMarkdown: body,
      tags: ['人物/加密数据']
    });
    loaded.dataNote = created;
  }
}

/* ------------------------------ 模式切换（迁移） ------------------------------ */

/** 明文 → 加密：把所有人物笔记合并加密，并清走明文笔记 */
export async function migratePlainToEncrypted(
  ctx: PluginContext,
  loaded: Loaded,
  people: Person[],
  meta: KdfMeta,
  key: CryptoKey,
  config: PluginConfig
): Promise<void> {
  const data: GraphData = {
    version: 1,
    updatedAt: new Date().toISOString(),
    people
  };
  const payload = await encryptJson(key, data);
  const body = wrapVaultBody(meta, payload);

  const note = await ctx.notes.create({
    notebookId: loaded.notebook.id,
    title: config.vaultNoteTitle,
    contentMarkdown: body,
    tags: ['人物/加密数据']
  });
  loaded.dataNote = note;

  for (const n of loaded.rawNotes) {
    try {
      await ctx.notes.trash([n.id]);
    } catch {
      /* 忽略 */
    }
  }
  loaded.rawNotes = [];
  loaded.mode = 'encrypted';
  loaded.meta = meta;
  loaded.payload = payload;
}

/** 加密 → 明文：解密后拆成人物笔记，并清走密文数据笔记 */
export async function migrateEncryptedToPlain(
  ctx: PluginContext,
  loaded: Loaded,
  data: GraphData
): Promise<void> {
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
      /* 忽略 */
    }
    loaded.dataNote = undefined;
  }
  loaded.mode = 'plain';
  loaded.meta = undefined;
  loaded.payload = undefined;
  loaded.rawNotes = [];
}
