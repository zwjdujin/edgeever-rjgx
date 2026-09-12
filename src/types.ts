/**
 * types.ts —— 数据模型 + 宿主 API 的最小类型声明
 *
 * 这里不依赖 @edgeever/plugin-api，自己声明用到的 API 子集，
 * 好处是打包产物零运行时依赖（符合"main.js 不得残留 SDK 运行时导入"的要求）。
 */

/* ---------------------------------- 宿主 API ---------------------------------- */

export interface NoteSummary {
  id: string;
  title?: string;
  notebookId?: string;
  tags?: string[];
  updatedAt?: string;
  revision?: number;
  [k: string]: unknown;
}

export interface NoteContent extends NoteSummary {
  contentMarkdown?: string;
  contentText?: string;
  contentJson?: unknown;
}

export interface Notebook {
  id: string;
  name: string;
  parentId?: string | null;
  [k: string]: unknown;
}

export interface Page<T> {
  items: T[];
  nextOffset?: number | null;
  total?: number;
}

export interface PanelHost {
  id?: string;
  title?: string;
  purpose?: 'workflow' | 'dashboard' | 'preview' | 'onboarding';
  presentation?: 'dialog' | 'fullscreen';
  mount: (container: HTMLElement, ctx: PanelMountContext) => void | (() => void);
  beforeClose?: () => boolean | { title?: string; message?: string; confirmLabel?: string };
}

export interface PanelMountContext {
  state?: Record<string, unknown>;
  requestClose?: () => void;
}

export interface PluginContext {
  commands: {
    register(cmd: {
      id: string;
      title: string;
      listed?: boolean;
      menu?: boolean;
      run: (arg?: unknown) => void | Promise<void>;
    }): () => void;
  };
  ui: {
    showNotice(message: string): void;
    openNote(noteId: string, opts?: { search?: string }): void | Promise<void>;
    panels: {
      register(panel: PanelHost): () => void;
      open(id: string, opts?: { state?: Record<string, unknown> }): void | Promise<void>;
    };
  };
  notes: {
    query(opts?: Record<string, unknown>): Promise<unknown>;
    queryContent(opts?: Record<string, unknown>): Promise<unknown>;
    get(noteId: string): Promise<NoteContent | null>;
    create(input: {
      notebookId: string;
      title?: string;
      contentMarkdown?: string;
      tags?: string[];
    }): Promise<NoteContent>;
    update(
      noteId: string,
      input: { title?: string; contentMarkdown?: string; tags?: string[] }
    ): Promise<NoteContent>;
    delete(noteId: string, opts?: { permanent?: boolean }): Promise<void>;
    move(noteIds: string[], notebookId: string): Promise<void>;
    trash(noteIds: string[]): Promise<void>;
  };
  notebooks: {
    list(): Promise<Notebook[] | unknown>;
    create(input: { name: string; parentId?: string | null }): Promise<Notebook>;
  };
  storage: {
    get<T = unknown>(key: string): Promise<T | undefined>;
    set(key: string, value: unknown): Promise<void>;
    remove(key: string): Promise<void>;
  };
  settings: {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
  };
  events: {
    on(event: string, cb: (payload: any) => void): () => void;
  };
}

/* ---------------------------------- 数据模型 ---------------------------------- */

export interface Interaction {
  date: string;
  kind: string;
  text: string;
}

export interface Relation {
  /** 对方姓名（姓名在本插件内作为稳定连接键） */
  to: string;
  type: string;
  /** 1–5 */
  strength: number;
  note?: string;
}

export interface Person {
  name: string;
  /** 圈层：家人 / 同事 / 朋友 / 客户 / 网友 / 其他 */
  group: string;
  /** 1–10 */
  importance: number;
  since?: string;
  note?: string;
  relations: Relation[];
  interactions: Interaction[];
}

export interface GraphData {
  version: number;
  updatedAt: string;
  people: Person[];
}

export const DATA_VERSION = 1;

export const DEFAULT_GROUPS = ['家人', '同事', '朋友', '客户', '网友', '其他'];

export const GROUP_COLORS: Record<string, string> = {
  本人: '#7F77DD',
  家人: '#D4537E',
  同事: '#378ADD',
  朋友: '#639922',
  客户: '#BA7517',
  网友: '#888780',
  其他: '#A3A19A'
};

export function groupColor(g: string): string {
  return GROUP_COLORS[g] || '#A3A19A';
}

export function emptyGraph(): GraphData {
  return { version: DATA_VERSION, updatedAt: new Date().toISOString(), people: [] };
}

/** 强度数字 ↔ 中文标签 */
export function strengthLabel(n: number): string {
  const v = Math.round(n);
  if (v >= 5) return '强';
  if (v >= 4) return '较强';
  if (v >= 3) return '中';
  if (v >= 2) return '较弱';
  return '弱';
}

export function parseStrength(token: string): number {
  const t = (token || '').trim();
  if (!t) return 3;
  const n = Number(t);
  if (!Number.isNaN(n) && n > 0) return Math.max(1, Math.min(5, Math.round(n)));
  if (t.includes('很') || t === '强') return 5;
  if (t.includes('较强')) return 4;
  if (t === '中') return 3;
  if (t.includes('较弱')) return 2;
  if (t === '弱') return 1;
  return 3;
}
