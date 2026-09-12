/**
 * markdown.ts —— 笔记与数据之间的双向转换
 *
 * 明文模式的格式约定（这是整个插件的地基，改动需谨慎）：
 *
 *   # 姓名
 *   #人物/同事
 *
 *   ## 基本
 *   关系类型：同事
 *   重要度：6
 *   认识于：2019-03
 *
 *   ## 人际关系
 *   - 姓名 | 类型 | 强度 | 备注
 *
 *   ## 互动记录
 *   - YYYY-MM-DD | 形式 | 内容
 *
 * 解析刻意做得宽容：中文/英文冒号都认、强度既认数字也认「强/中/弱」、
 * 列表符号 - 与 * 都接受、小节标题支持模糊匹配。这样用户手改笔记也不容易写坏。
 */

import { KdfMeta } from './crypto';
import { Interaction, Person, Relation, parseStrength } from './types';

/* --------------------------------- 序列化 --------------------------------- */

export function serializePerson(p: Person): string {
  const L: string[] = [];
  L.push(`# ${p.name}`);
  L.push('');
  L.push(`#人物/${p.group}`);
  L.push('');
  L.push('## 基本');
  L.push('');
  L.push(`关系类型：${p.group}`);
  L.push(`重要度：${p.importance}`);
  if (p.since) L.push(`认识于：${p.since}`);
  if (p.note) L.push(`备注：${p.note}`);
  L.push('');
  L.push('## 人际关系');
  L.push('');
  for (const r of p.relations) {
    L.push(`- ${r.to} | ${r.type} | ${r.strength}${r.note ? ' | ' + r.note : ''}`);
  }
  L.push('');
  L.push('## 互动记录');
  L.push('');
  for (const a of p.interactions) {
    L.push(`- ${a.date} | ${a.kind} | ${a.text}`);
  }
  L.push('');
  return L.join('\n');
}

/* ---------------------------------- 解析 ---------------------------------- */

function pickSection(sections: Map<string, string[]>, ...names: string[]): string[] {
  for (const [k, v] of sections) {
    for (const n of names) {
      if (k.includes(n)) return v;
    }
  }
  return [];
}

function splitRow(line: string): string[] {
  const m = line.match(/^\s*[-*+]?\s*(.*)$/);
  const body = (m ? m[1] : line).trim();
  if (!body) return [];
  return body.split('|').map((s) => s.trim());
}

function isDateLike(s: string): boolean {
  return /^\d{4}[-/.]\d{1,2}([-/.]\d{1,2})?$/.test(s) || /^\d{1,2}[-/.]\d{1,2}$/.test(s);
}

export function parsePerson(markdown: string): Person | null {
  if (!markdown) return null;
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');

  let name = '';
  const tags = new Set<string>();
  const sections = new Map<string, string[]>();
  let current: string | null = null;

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');

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
      let m: RegExpExecArray | null;
      while ((m = re.exec(line))) tags.add(m[1]);
      continue;
    }

    sections.get(current)!.push(line);
  }

  if (!name) return null;

  let group = '';
  for (const t of tags) {
    if (t.startsWith('人物/')) group = t.slice('人物/'.length);
  }

  let importance = 5;
  let since = '';
  let note = '';
  for (const line of pickSection(sections, '基本', '资料', '信息')) {
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

  const relations: Relation[] = [];
  for (const line of pickSection(sections, '人际关系', '关系')) {
    const cells = splitRow(line);
    if (!cells.length || !cells[0]) continue;
    if (/^姓名$/.test(cells[0]) && /类型|强度/.test(cells.join(''))) continue;
    relations.push({
      to: cells[0],
      type: cells[1] || '其他',
      strength: parseStrength(cells[2] || ''),
      note: cells[3] || undefined
    });
  }

  const interactions: Interaction[] = [];
  for (const line of pickSection(sections, '互动记录', '互动', '记录')) {
    const cells = splitRow(line);
    if (!cells.length || !cells[0]) continue;
    if (/^日期$/.test(cells[0])) continue;
    if (isDateLike(cells[0])) {
      interactions.push({
        date: cells[0],
        kind: cells[1] || '记录',
        text: cells.slice(2).join(' | ') || cells[1] || ''
      });
    } else if (cells.length >= 2) {
      interactions.push({ date: cells[0], kind: cells[1], text: cells.slice(2).join(' | ') });
    }
  }

  return {
    name,
    group: group || '其他',
    importance,
    since: since || undefined,
    note: note || undefined,
    relations,
    interactions
  };
}

/* ------------------------------ 加密笔记的封装 ------------------------------ */

export const VAULT_NOTE_TITLE = '人际关系数据';
const FENCE_KEY = 'edgeever-social-graph-key';
const FENCE_VAULT = 'edgeever-social-graph-vault';

export function wrapVaultBody(meta: KdfMeta, payload: string): string {
  return [
    '# 人际关系数据（加密）',
    '',
    '> 本笔记内容由「人际关系图谱」插件加密保存，请勿手动修改。',
    '> 密码一旦遗忘，数据将无法恢复。',
    '',
    '```' + FENCE_KEY,
    JSON.stringify(meta),
    '```',
    '',
    '```' + FENCE_VAULT,
    payload,
    '```',
    ''
  ].join('\n');
}

export function parseVaultBody(markdown: string): { meta: KdfMeta | null; payload: string | null } {
  const keyM = markdown.match(new RegExp('```' + FENCE_KEY + '\\s*\\n([\\s\\S]*?)\\n```'));
  const vaultM = markdown.match(new RegExp('```' + FENCE_VAULT + '\\s*\\n([\\s\\S]*?)\\n```'));
  let meta: KdfMeta | null = null;
  if (keyM) {
    try {
      meta = JSON.parse(keyM[1].trim()) as KdfMeta;
    } catch {
      meta = null;
    }
  }
  return { meta, payload: vaultM ? vaultM[1].trim() : null };
}

export function isVaultNote(markdown: string | undefined): boolean {
  if (!markdown) return false;
  return markdown.includes(FENCE_VAULT) || markdown.includes(FENCE_KEY);
}
