/**
 * dom.ts —— 用 jsdom 把真实面板代码跑起来
 *
 * 目的：UI 代码（panel.ts / graph.ts）在 Node 环境无法被冒烟测试覆盖，
 * 但恰恰是最容易出现「打开就白屏」的地方。这里用 jsdom 提供最小 DOM，
 * 挂载真实面板并断言渲染结果，把这类错误在交付前拦住。
 *
 * 运行：npm run test:dom
 */

import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { SocialGraphPanel } from '../src/ui/panel';
import { PREVIEW_PASSWORD, makeMockContext } from '../preview/mock';

/* ------------------------------ 最小 DOM 环境 ------------------------------ */

const dom = new JSDOM('<!doctype html><html><head></head><body><div id="host"></div></body></html>', {
  pretendToBeVisual: true
});

const w = dom.window as any;
(globalThis as any).window = w;
(globalThis as any).document = w.document;
(globalThis as any).HTMLElement = w.HTMLElement;
(globalThis as any).Element = w.Element;
(globalThis as any).Node = w.Node;
(globalThis as any).SVGElement = w.SVGElement;
(globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => w.setTimeout(() => cb(Date.now()), 16);
(globalThis as any).cancelAnimationFrame = (id: number) => w.clearTimeout(id);

/** jsdom 不实现 ResizeObserver，给一个只记录回调的空实现 */
class RO {
  observe() {
    /* noop */
  }
  unobserve() {
    /* noop */
  }
  disconnect() {
    /* noop */
  }
}
(globalThis as any).ResizeObserver = RO;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function host(): HTMLElement {
  return w.document.getElementById('host') as HTMLElement;
}

function text(): string {
  return host().textContent || '';
}

let passed = 0;
function ok(label: string) {
  passed++;
  console.log('  ✓ ' + label);
}

/* --------------------------------- 用例 --------------------------------- */

async function main() {
  const errors: string[] = [];
  const origError = console.error;
  console.error = (...a: unknown[]) => {
    errors.push(a.map(String).join(' '));
    origError(...a);
  };

  console.log('\n[1] 首次使用：应渲染初始化引导');
  {
    const m = makeMockContext({ withNotebook: false, encrypted: false });
    const panel = new SocialGraphPanel(m.ctx, host());
    panel.start();
    await sleep(60);

    const t = text();
    assert.ok(t.includes('初始化人际关系图谱'), '应显示引导标题');
    assert.ok(t.includes('人际关系'), '应说明将创建的笔记本名称');
    assert.ok(t.includes('不设密码'), '应提供明文选项');
    assert.ok(t.includes('设置密码'), '应提供加密选项');
    assert.ok(host().querySelector('.esg-root'), '根节点应存在');
    ok('初始化引导卡片渲染正常');

    // 点“创建并开始使用”（默认明文模式）
    const btns = [...host().querySelectorAll('button')] as HTMLElement[];
    const go = btns.find((b) => b.textContent?.includes('创建并开始使用'));
    assert.ok(go, '应存在创建按钮');
    go!.click();
    await sleep(120);

    assert.ok(text().includes('明文模式'), '创建后应进入明文模式主界面');
    assert.ok(m.notebooks.some((n: any) => n.name === '人际关系'), '笔记本应被创建');
    ok('点击创建 → 笔记本建立 → 进入主界面');
    panel.destroy();
  }

  console.log('\n[2] 明文模式：应渲染图谱与人物列表');
  {
    const m = makeMockContext({ withNotebook: true, encrypted: false });
    await m.seedPlain();
    const panel = new SocialGraphPanel(m.ctx, host());
    panel.start();
    await sleep(120);

    const t = text();
    assert.ok(t.includes('人际关系图谱'), '标题存在');
    assert.ok(t.includes('14 人'), '应统计出 14 人');
    assert.ok(t.includes('蔡娇军'), '左侧列表与详情应包含人物');
    assert.ok(host().querySelector('.esg-graph-svg'), '图谱 SVG 应被创建');
    assert.ok(host().querySelectorAll('.esg-graph-svg circle').length >= 14, '应渲染 14+ 个节点');
    assert.ok(host().querySelectorAll('.esg-node').length === 14, '节点数应为 14');
    ok('主界面渲染：14 个节点 + 图谱 + 详情');

    // 切到赵丽静
    const items = [...host().querySelectorAll('.esg-pitem')] as HTMLElement[];
    const zlj = items.find((i) => i.textContent?.includes('赵丽静'));
    assert.ok(zlj, '列表中应有赵丽静');
    zlj!.click();
    await sleep(60);
    assert.ok(text().includes('配偶'), '详情应显示关系类型');
    assert.ok(text().includes('互动记录'), '详情应有互动记录小节');
    ok('点击列表项 → 详情联动切换');

    // 圈层筛选：默认全部显示，点击「家人」应进入「只看家人」
    const chips = [...host().querySelectorAll('.esg-chip')] as HTMLElement[];
    const family = chips.find((c) => c.textContent?.trim() === '家人');
    assert.ok(family, '应有「家人」筛选 chip');
    family!.click();
    await sleep(60);
    let leftItems = [...host().querySelectorAll('.esg-pitem')] as HTMLElement[];
    assert.equal(leftItems.length, 3, '只看家人应为 3 人');
    ok('圈层筛选生效（只看家人 → 3 人）');

    // 再点一次回到全部
    const chips2 = [...host().querySelectorAll('.esg-chip')] as HTMLElement[];
    const family2 = chips2.find((c) => c.textContent?.trim() === '家人');
    family2!.click();
    await sleep(60);
    leftItems = [...host().querySelectorAll('.esg-pitem')] as HTMLElement[];
    assert.equal(leftItems.length, 14, '取消筛选后应恢复 14 人');
    ok('再次点击同一圈层 → 恢复全部');

    // 多选：家人 + 同事
    const chips3 = [...host().querySelectorAll('.esg-chip')] as HTMLElement[];
    (chips3.find((c) => c.textContent?.trim() === '家人') as HTMLElement).click();
    await sleep(40);
    const chips4 = [...host().querySelectorAll('.esg-chip')] as HTMLElement[];
    (chips4.find((c) => c.textContent?.trim() === '同事') as HTMLElement).click();
    await sleep(40);
    leftItems = [...host().querySelectorAll('.esg-pitem')] as HTMLElement[];
    assert.equal(leftItems.length, 7, '家人+同事 应为 7 人');
    ok('多选筛选生效（家人 + 同事 → 7 人）');

    // 恢复全部，方便后续用例
    const chips5 = [...host().querySelectorAll('.esg-chip')] as HTMLElement[];
    (chips5.find((c) => c.textContent?.trim() === '全部') as HTMLElement).click();
    await sleep(40);

    // 新增人物
    const allBtns = [...host().querySelectorAll('button')] as HTMLElement[];
    const addBtn = allBtns.find((b) => b.textContent?.includes('新增人物'));
    assert.ok(addBtn, '应有新增人物按钮');
    addBtn!.click();
    await sleep(50);
    assert.ok(text().includes('创建此人物'), '应出现新建表单');
    ok('新增人物表单可打开');

    panel.destroy();
    assert.equal(host().querySelectorAll('.esg-root').length, 0, 'destroy 后应清理 DOM');
    ok('destroy 正确清理 DOM');
  }

  console.log('\n[3] 加密模式：应渲染锁屏，密码正确才进入');
  {
    const m = makeMockContext({ withNotebook: true, encrypted: true });
    await m.seedEncrypted();
    const panel = new SocialGraphPanel(m.ctx, host());
    panel.start();
    await sleep(80);

    assert.ok(text().includes('已加密'), '应显示锁屏');
    assert.ok(text().includes('解锁'), '应有解锁按钮');
    assert.ok(!text().includes('蔡娇军'), '未解锁时不应泄露任何姓名');
    ok('加密模式：锁屏渲染，且不泄露数据');

    const input = host().querySelector('input[type=password]') as HTMLInputElement;
    assert.ok(input, '应有密码输入框');

    // 错误密码
    input.value = 'wrong-password';
    const unlockBtn = ([...host().querySelectorAll('button')] as HTMLElement[]).find((b) =>
      b.textContent?.includes('解锁')
    );
    unlockBtn!.click();
    await sleep(500);
    assert.ok(text().includes('密码不正确'), '错误密码应被拒绝');
    assert.ok(!text().includes('蔡娇军'), '错误密码后仍不应显示数据');
    ok('错误密码被拒绝，数据未泄露');

    // 正确密码
    const input2 = host().querySelector('input[type=password]') as HTMLInputElement;
    input2.value = PREVIEW_PASSWORD;
    const unlockBtn2 = ([...host().querySelectorAll('button')] as HTMLElement[]).find((b) =>
      b.textContent?.includes('解锁')
    );
    unlockBtn2!.click();
    await sleep(600);
    assert.ok(text().includes('14 人'), '正确密码后应进入主界面');
    assert.ok(text().includes('加密模式'), '应标记为加密模式');
    assert.ok(host().querySelector('.esg-graph-svg'), '图谱应渲染');
    ok('正确密码解锁 → 进入主界面并渲染图谱');

    panel.destroy();
  }

  console.log('\n[4] 安全设置弹层');
  {
    const m = makeMockContext({ withNotebook: true, encrypted: false });
    await m.seedPlain();
    const panel = new SocialGraphPanel(m.ctx, host());
    panel.start();
    await sleep(120);

    const sec = ([...host().querySelectorAll('button')] as HTMLElement[]).find((b) =>
      b.textContent?.includes('安全设置')
    );
    sec!.click();
    await sleep(50);
    assert.ok(host().querySelector('.esg-overlay'), '应弹出遮罩层');
    assert.ok(text().includes('开启加密'), '明文模式应提供开启加密');
    assert.ok(text().includes('无法恢复'), '应有密码遗失警告');
    ok('安全设置弹层正常（明文 → 可开启加密）');

    panel.destroy();
  }

  console.error = origError;
  if (errors.length) {
    console.log(`\n渲染期间捕获到 ${errors.length} 条 console.error：`);
    for (const e of errors.slice(0, 5)) console.log('  ! ' + e.slice(0, 200));
    throw new Error('面板渲染过程中产生了错误输出');
  }

  console.log(`\n全部通过：${passed} 项 UI 断言\n`);
}

main().catch((e) => {
  console.error('\nUI 测试失败：');
  console.error(e);
  process.exit(1);
});
