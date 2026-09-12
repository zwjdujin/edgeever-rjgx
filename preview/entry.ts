/**
 * preview/entry.ts —— 在浏览器里预览真实插件界面
 *
 * 这个文件不参与插件发布，只用于人工验收：
 * preview.html 加载本文件打包出的 preview.js，用内存 Mock 充当 EdgeEver 宿主，
 * 然后把真正的 SocialGraphPanel 挂上去。因此你看到的界面、交互、样式与装进
 * EdgeEver 后完全一致。
 */

import { SocialGraphPanel } from '../src/ui/panel';
import { PREVIEW_PASSWORD, makeMockContext } from './mock';

async function boot() {
  const host = document.getElementById('host')!;
  let panel: SocialGraphPanel | null = null;

  const show = async (scene: string) => {
    panel?.destroy();
    panel = null;
    host.replaceChildren();

    const opts =
      scene === 'init'
        ? { withNotebook: false, encrypted: false }
        : scene === 'lock'
          ? { withNotebook: true, encrypted: true }
          : { withNotebook: true, encrypted: false };

    const m = makeMockContext(opts);
    if (scene === 'lock') await m.seedEncrypted();
    if (scene === 'plain') await m.seedPlain();

    panel = new SocialGraphPanel(m.ctx, host);
    panel.start();

    document.querySelectorAll('[data-scene]').forEach((b) => {
      const el = b as HTMLElement;
      el.classList.toggle('pv-on', el.dataset.scene === scene);
    });

    const hint = document.getElementById('hint')!;
    hint.textContent =
      scene === 'lock'
        ? `加密模式预览 · 解锁密码为 ${PREVIEW_PASSWORD}`
        : scene === 'init'
          ? '首次使用预览 · 可试试点「创建并开始使用」'
          : '明文模式预览 · 数据源是 14 篇人物笔记';
  };

  document.querySelectorAll('[data-scene]').forEach((b) => {
    (b as HTMLElement).onclick = () => void show((b as HTMLElement).dataset.scene!);
  });

  await show('plain');
}

void boot();
