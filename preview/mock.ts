/**
 * preview/mock.ts —— Mock 宿主环境与示例数据
 *
 * 被 preview/entry.ts（浏览器预览）和 test/dom.ts（jsdom 冒烟）共用，
 * 保证两处验证的是同一套数据与同一套宿主行为。
 */

import { createVault, encryptJson } from '../src/crypto';
import { serializePerson, wrapVaultBody } from '../src/markdown';
import { GraphData, Person, PluginContext } from '../src/types';

export const PREVIEW_PASSWORD = 'demo1234';
export const NOTEBOOK = { id: 'nb-1', name: '人际关系' };

export const people: Person[] = [
  {
    name: '杜缙', group: '其他', importance: 10, since: '1988-01', note: '本人',
    relations: [
      { to: '赵丽静', type: '配偶', strength: 5 },
      { to: '王总', type: '合作', strength: 5 },
      { to: '蔡娇军', type: '同事', strength: 4 },
      { to: '李想', type: '朋友', strength: 3 }
    ],
    interactions: [{ date: '2026-09-12', kind: '线下', text: '家庭' }]
  },
  {
    name: '赵丽静', group: '家人', importance: 9, since: '2013-06',
    relations: [
      { to: '杜缙', type: '配偶', strength: 5 },
      { to: '父亲', type: '翁媳', strength: 3 }
    ],
    interactions: [{ date: '2026-09-12', kind: '线下', text: '家庭日常' }]
  },
  {
    name: '父亲', group: '家人', importance: 7,
    relations: [
      { to: '杜缙', type: '父子', strength: 4 },
      { to: '母亲', type: '夫妻', strength: 5 }
    ],
    interactions: [{ date: '2026-09-09', kind: '电话', text: '家常' }]
  },
  {
    name: '母亲', group: '家人', importance: 7,
    relations: [
      { to: '杜缙', type: '母子', strength: 4 },
      { to: '父亲', type: '夫妻', strength: 5 }
    ],
    interactions: []
  },
  {
    name: '蔡娇军', group: '同事', importance: 6, since: '2018-09', note: '同项目组',
    relations: [
      { to: '杜缙', type: '同事', strength: 5, note: '长期协作' },
      { to: '赵志春', type: '同事', strength: 3 },
      { to: '吴静', type: '同事', strength: 2 }
    ],
    interactions: [
      { date: '2026-09-11', kind: '线下', text: '项目评审会' },
      { date: '2026-08-28', kind: '微信', text: '排期确认' }
    ]
  },
  {
    name: '赵志春', group: '同事', importance: 5, since: '2020-04',
    relations: [
      { to: '蔡娇军', type: '同事', strength: 3 },
      { to: '徐蕾', type: '同事', strength: 2 }
    ],
    interactions: [{ date: '2026-09-07', kind: '线下', text: '值班交接' }]
  },
  {
    name: '吴静', group: '同事', importance: 4, since: '2021-11',
    relations: [{ to: '蔡娇军', type: '同事', strength: 2 }],
    interactions: []
  },
  {
    name: '徐蕾', group: '同事', importance: 3, since: '2022-03',
    relations: [{ to: '赵志春', type: '同事', strength: 2 }],
    interactions: []
  },
  {
    name: '王总', group: '客户', importance: 8, since: '2017-05',
    relations: [
      { to: '杜缙', type: '合作', strength: 5 },
      { to: '刘洋', type: '同事', strength: 3 }
    ],
    interactions: [
      { date: '2026-09-06', kind: '线下', text: '需求对接' },
      { date: '2026-08-20', kind: '电话', text: '合同条款' }
    ]
  },
  {
    name: '刘洋', group: '客户', importance: 5, since: '2023-02',
    relations: [{ to: '王总', type: '同事', strength: 3 }],
    interactions: []
  },
  {
    name: '李想', group: '朋友', importance: 6, since: '2015-08',
    relations: [
      { to: '杜缙', type: '朋友', strength: 3 },
      { to: '张浩', type: '朋友', strength: 4 },
      { to: '孙鹏', type: '朋友', strength: 3 },
      { to: '陈宇', type: '网友', strength: 2 }
    ],
    interactions: [{ date: '2026-08-15', kind: '线下', text: '聚餐' }]
  },
  {
    name: '张浩', group: '朋友', importance: 4, since: '2016-10',
    relations: [
      { to: '李想', type: '朋友', strength: 4 },
      { to: '孙鹏', type: '朋友', strength: 2 }
    ],
    interactions: []
  },
  {
    name: '孙鹏', group: '朋友', importance: 5, since: '2019-01',
    relations: [
      { to: '李想', type: '朋友', strength: 3 },
      { to: '张浩', type: '朋友', strength: 2 }
    ],
    interactions: []
  },
  {
    name: '陈宇', group: '网友', importance: 3, since: '2020-07',
    relations: [
      { to: '李想', type: '网友', strength: 2 },
      { to: '杜缙', type: '网友', strength: 2 }
    ],
    interactions: []
  }
];

export function toast(msg: string) {
  if (typeof document === 'undefined') return;
  const el = document.createElement('div');
  el.textContent = msg;
  el.setAttribute('data-toast', '1');
  el.style.cssText =
    'position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:99;' +
    'background:#2c2c2a;color:#fff;font:12px/1.5 -apple-system,"Noto Sans SC",sans-serif;' +
    'padding:8px 14px;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.18);opacity:.96';
  document.body.append(el);
  setTimeout(() => el.remove(), 2400);
}

export interface MockOptions {
  withNotebook: boolean;
  encrypted: boolean;
}

export function makeMockContext(opts: MockOptions) {
  const notebooks = opts.withNotebook ? [{ ...NOTEBOOK }] : [];
  const notes: any[] = [];
  let seq = 0;
  const nid = (p: string) => `${p}${++seq}`;

  const ctx: any = {
    notebooks: {
      async list() {
        return notebooks.map((n) => ({ ...n }));
      },
      async create({ name }: any) {
        const nb = { id: nid('nb'), name };
        notebooks.push(nb);
        return nb;
      }
    },
    notes: {
      async query() {
        return { items: notes.map((n) => ({ ...n })) };
      },
      async queryContent({ notebookId }: any) {
        return {
          items: notes.filter((n) => n.notebookId === notebookId).map((n) => ({ ...n })),
          nextOffset: null
        };
      },
      async get(id: string) {
        const n = notes.find((x) => x.id === id);
        return n ? { ...n } : null;
      },
      async create(input: any) {
        const n = {
          id: nid('n'),
          notebookId: input.notebookId,
          title: input.title || '',
          contentMarkdown: input.contentMarkdown || '',
          tags: input.tags || [],
          revision: 1
        };
        notes.push(n);
        return { ...n };
      },
      async update(id: string, input: any) {
        const n = notes.find((x) => x.id === id);
        if (!n) throw new Error('note not found');
        Object.assign(n, input);
        n.revision++;
        return { ...n };
      },
      async delete() {
        /* noop */
      },
      async move() {
        /* noop */
      },
      async trash(ids: string[]) {
        for (const id of ids) {
          const i = notes.findIndex((x) => x.id === id);
          if (i >= 0) notes.splice(i, 1);
        }
      }
    },
    storage: {
      async get() {
        return undefined;
      },
      async set() {
        /* noop */
      },
      async remove() {
        /* noop */
      }
    },
    settings: {
      async get() {
        return undefined;
      },
      async set() {
        /* noop */
      }
    },
    commands: { register: () => () => undefined },
    ui: {
      showNotice: (m: string) => toast(m),
      openNote: () => undefined,
      panels: { register: () => () => undefined, open: () => undefined }
    },
    events: { on: () => () => undefined }
  };

  return {
    ctx: ctx as PluginContext,
    notes,
    notebooks,
    async seedPlain() {
      for (const p of people) {
        await ctx.notes.create({
          notebookId: NOTEBOOK.id,
          title: p.name,
          contentMarkdown: serializePerson(p),
          tags: [`人物/${p.group}`]
        });
      }
    },
    async seedEncrypted() {
      const { meta, key } = await createVault(PREVIEW_PASSWORD);
      const data: GraphData = { version: 1, updatedAt: new Date().toISOString(), people };
      const payload = await encryptJson(key, data);
      await ctx.notes.create({
        notebookId: NOTEBOOK.id,
        title: '人际关系数据',
        contentMarkdown: wrapVaultBody(meta, payload),
        tags: ['人物/加密数据']
      });
    }
  };
}
