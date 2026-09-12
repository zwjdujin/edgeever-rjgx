/**
 * smoke.ts —— 核心链路的冒烟测试
 *
 * 用内存 Mock 模拟宿主 API，验证：
 *   1. Markdown 序列化/解析的往返一致性（含宽容解析）
 *   2. PBKDF2 + AES-GCM 的加密正确性与错误密码拒绝
 *   3. 明文模式写入 → 读回的完整链路
 *   4. 明文 → 加密 → 解锁读取 → 还原明文的模式迁移
 *
 * 运行：npm run test
 */

import assert from 'node:assert/strict';
import { createVault, decryptJson, encryptJson, unlockVault } from '../src/crypto';
import { parsePerson, parseVaultBody, serializePerson } from '../src/markdown';
import {
  decodeEncrypted,
  decodePlain,
  ensureNotebook,
  load,
  loadConfig,
  migrateEncryptedToPlain,
  migratePlainToEncrypted,
  saveEncrypted,
  savePlain
} from '../src/store';
import { GraphData, Person, PluginContext } from '../src/types';

let passed = 0;
function ok(label: string) {
  passed++;
  console.log('  ✓ ' + label);
}

/* ----------------------------- Mock 宿主环境 ----------------------------- */

interface MNote {
  id: string;
  notebookId: string;
  title: string;
  contentMarkdown: string;
  tags: string[];
  revision: number;
}

function mockContext() {
  const notebooks: Array<{ id: string; name: string }> = [];
  const notes: MNote[] = [];
  let seq = 0;
  const nextId = (p: string) => `${p}${++seq}`;

  const ctx = {
    notebooks: {
      async list() {
        return notebooks.slice();
      },
      async create({ name }: { name: string }) {
        const nb = { id: nextId('nb'), name };
        notebooks.push(nb);
        return nb;
      }
    },
    notes: {
      async query() {
        return { items: notes.map((n) => ({ ...n })) };
      },
      async queryContent({ notebookId }: { notebookId: string }) {
        const items = notes.filter((n) => n.notebookId === notebookId).map((n) => ({ ...n }));
        return { items, nextOffset: null };
      },
      async get(id: string) {
        const n = notes.find((x) => x.id === id);
        return n ? { ...n } : null;
      },
      async create(input: { notebookId: string; title?: string; contentMarkdown?: string; tags?: string[] }) {
        const n: MNote = {
          id: nextId('n'),
          notebookId: input.notebookId,
          title: input.title || '',
          contentMarkdown: input.contentMarkdown || '',
          tags: input.tags || [],
          revision: 1
        };
        notes.push(n);
        return { ...n };
      },
      async update(id: string, input: Partial<MNote>) {
        const n = notes.find((x) => x.id === id);
        if (!n) throw new Error('note not found: ' + id);
        Object.assign(n, input);
        n.revision++;
        return { ...n };
      },
      async delete(id: string) {
        const i = notes.findIndex((x) => x.id === id);
        if (i >= 0) notes.splice(i, 1);
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
    commands: {
      register() {
        return () => undefined;
      }
    },
    ui: {
      showNotice() {
        /* noop */
      },
      openNote() {
        /* noop */
      },
      panels: {
        register() {
          return () => undefined;
        },
        open() {
          /* noop */
        }
      }
    },
    events: {
      on() {
        return () => undefined;
      }
    }
  };

  return { ctx: ctx as unknown as PluginContext, notes, notebooks };
}

const sample = (): Person[] => [
  {
    name: '蔡娇军',
    group: '同事',
    importance: 6,
    since: '2019-03',
    note: '同项目组',
    relations: [
      { to: '杜缙', type: '同事', strength: 5, note: '长期协作' },
      { to: '赵志春', type: '同事', strength: 3 }
    ],
    interactions: [
      { date: '2026-09-11', kind: '线下', text: '项目评审会' },
      { date: '2026-08-28', kind: '微信', text: '排期确认' }
    ]
  },
  {
    name: '赵丽静',
    group: '家人',
    importance: 9,
    since: '2013-06',
    relations: [{ to: '杜缙', type: '配偶', strength: 5 }],
    interactions: [{ date: '2026-09-12', kind: '线下', text: '家庭日常' }]
  },
  {
    name: '王总',
    group: '客户',
    importance: 8,
    relations: [{ to: '杜缙', type: '合作', strength: 5 }],
    interactions: []
  }
];

/* --------------------------------- 用例 --------------------------------- */

async function main() {
  console.log('\n[1] Markdown 往返一致性');
  {
    for (const p of sample()) {
      const round = parsePerson(serializePerson(p));
      assert.ok(round, `${p.name} 应能解析`);
      assert.equal(round!.name, p.name, 'name');
      assert.equal(round!.group, p.group, 'group');
      assert.equal(round!.importance, p.importance, 'importance');
      assert.equal(round!.relations.length, p.relations.length, 'relations 数量');
      assert.equal(round!.interactions.length, p.interactions.length, 'interactions 数量');
      assert.equal(round!.since, p.since, 'since');
      if (p.relations.length) {
        assert.equal(round!.relations[0].strength, p.relations[0].strength, 'strength');
      }
      if (p.interactions.length) {
        assert.equal(round!.interactions[0].kind, p.interactions[0].kind, 'interaction kind');
      }
    }
    ok('人物笔记序列化 → 解析 完全一致（3 个样本）');
  }

  console.log('\n[2] 宽容解析（手写笔记不容易写坏）');
  {
    const messy = [
      '# 张三',
      '',
      '#人物/朋友',
      '',
      '## 基本资料',
      '',
      '关系类型: 朋友',     // 英文冒号
      '重要度：7',
      '认识于: 2020-05',
      '',
      '## 人际关系',
      '',
      '* 李四 | 朋友 | 强 | 老同学',   // * 列表 + 中文强度
      '- 王五 | 同事 | 2',
      '',
      '## 互动记录',
      '',
      '- 2026-01-02 | 电话 | 拜年'
    ].join('\n');
    const p = parsePerson(messy);
    assert.ok(p, '应解析成功');
    assert.equal(p!.name, '张三');
    assert.equal(p!.group, '朋友');
    assert.equal(p!.importance, 7);
    assert.equal(p!.since, '2020-05');
    assert.equal(p!.relations.length, 2);
    assert.equal(p!.relations[0].strength, 5, '「强」→5');
    assert.equal(p!.relations[1].strength, 2, '"2"→2');
    assert.equal(p!.interactions.length, 1);
    ok('中英冒号 / */− 列表 / 中文强度 / 模糊小节名 全部兼容');
  }

  console.log('\n[3] 加密与解锁');
  {
    const { meta, key } = await createVault('s3cret-pass');
    const data: GraphData = { version: 1, updatedAt: 'now', people: sample() };
    const payload = await encryptJson(key, data);
    assert.ok(!payload.includes('蔡娇军'), '密文不应包含明文姓名');

    const back = await decryptJson<GraphData>(key, payload);
    assert.equal(back!.people.length, 3, '解密后人数');
    assert.equal(back!.people[0].name, '蔡娇军');

    const good = await unlockVault('s3cret-pass', meta);
    assert.ok(good, '正确密码应解锁');

    const bad = await unlockVault('wrong-pass', meta);
    assert.equal(bad, null, '错误密码必须被拒绝');
    ok('AES-GCM 往返一致 · 密文不含明文 · 错误密码被拒');
  }

  console.log('\n[4] 明文模式：写入 → 读回');
  {
    const { ctx, notes } = mockContext();
    await ensureNotebook(ctx, '人际关系');
    const config = await loadConfig(ctx);
    assert.equal(config.notebookName, '人际关系', '默认笔记本名');

    const loaded0 = await load(ctx, config);
    assert.equal(loaded0.mode, 'plain', '初始应为明文模式');

    const res = await savePlain(ctx, loaded0, sample());
    assert.equal(res.created, 3, '应创建 3 篇人物笔记');
    assert.equal(notes.length, 3, '笔记总数');

    const loaded1 = await load(ctx, config);
    const people = decodePlain(loaded1);
    assert.equal(people.length, 3, '读回人数');
    assert.equal(people.find((p) => p.name === '蔡娇军')!.relations.length, 2);
    ok(`明文写入 ${res.created} 篇 → 读回 ${people.length} 人`);

    // 更新：改名 + 改重要度
    const edited = decodePlain(loaded1);
    edited[0].importance = 10;
    const res2 = await savePlain(ctx, loaded1, edited);
    assert.equal(res2.created, 0);
    assert.equal(res2.updated, 1, '仅 1 篇内容变化');
    assert.equal(notes.length, 3, '笔记数不变');
    ok('增量写入：仅变更的笔记被更新，没有重复创建');

    // 删除
    const res3 = await savePlain(ctx, loaded1, edited.slice(0, 2));
    assert.equal(res3.removed, 1, '应移除 1 篇');
    assert.equal(notes.length, 2);
    ok('删除人物会同步移除对应笔记');
  }

  console.log('\n[5] 模式迁移：明文 ↔ 加密');
  {
    const { ctx, notes } = mockContext();
    await ensureNotebook(ctx, '人际关系');
    const config = await loadConfig(ctx);

    let loaded = await load(ctx, config);
    await savePlain(ctx, loaded, sample());
    loaded = await load(ctx, config);
    const people = decodePlain(loaded);
    assert.equal(notes.length, 3);

    // 明文 → 加密
    const { meta, key } = await createVault('pw123456');
    await migratePlainToEncrypted(ctx, loaded, people, meta, key, config);
    assert.equal(notes.length, 1, '明文笔记应被清走，只剩 1 篇数据笔记');
    assert.ok(!notes[0].contentMarkdown.includes('蔡娇军'), '数据笔记中不应出现明文姓名');

    loaded = await load(ctx, config);
    assert.equal(loaded.mode, 'encrypted', '应识别为加密模式');
    const parsed = parseVaultBody(loaded.dataNote!.contentMarkdown || '');
    assert.ok(parsed.meta, '应能取出 KDF 元信息');
    assert.ok(parsed.payload, '应能取出密文载荷');

    const key2 = await unlockVault('pw123456', parsed.meta!);
    assert.ok(key2, '迁移后可用原密码解锁');
    const data = await decodeEncrypted(loaded, key2!);
    assert.equal(data!.people.length, 3, '解密后人数一致');
    ok('明文 → 加密：明文被清理，密文可解，人数一致');

    // 加密模式下写入
    data!.people[0].importance = 4;
    await saveEncrypted(ctx, loaded, data!, key2!, config);
    assert.equal(notes.length, 1, '仍是 1 篇数据笔记');
    const again = await decodeEncrypted(await load(ctx, config), key2!);
    assert.equal(again!.people[0].importance, 4, '加密写入已生效');
    ok('加密模式写入 → 读回一致');

    // 加密 → 明文
    const loaded3 = await load(ctx, config);
    await migrateEncryptedToPlain(ctx, loaded3, again!);
    assert.equal(notes.length, 3, '应还原为 3 篇明文笔记');
    assert.ok(
      notes.some((n) => n.title === '蔡娇军' && n.contentMarkdown.includes('## 人际关系')),
      '还原的笔记应包含标准小节'
    );
    const restored = decodePlain(await load(ctx, config));
    assert.equal(restored.length, 3);
    ok('加密 → 明文：还原为可读的人物笔记');
  }

  console.log(`\n全部通过：${passed} 组断言\n`);
}

main().catch((e) => {
  console.error('\n测试失败：');
  console.error(e);
  process.exit(1);
});
