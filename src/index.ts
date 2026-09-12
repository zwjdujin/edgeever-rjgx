/**
 * index.ts —— 插件入口
 *
 * 只做三件事：注册面板、注册命令、返回清理函数。
 * 真正的逻辑都在 store / graph / ui 里。
 */

import { PluginContext } from './types';
import { createPanelDescriptor } from './ui/panel';
import { findNotebook, loadConfig } from './store';

const PANEL_ID = 'social-graph';

const plugin = {
  activate(context: PluginContext) {
    const disposers: Array<() => void> = [];

    disposers.push(context.ui.panels.register(createPanelDescriptor(context)));

    disposers.push(
      context.commands.register({
        id: 'open',
        title: '人际关系图谱：打开面板',
        async run() {
          await context.ui.panels.open(PANEL_ID);
        }
      })
    );

    disposers.push(
      context.commands.register({
        id: 'setup',
        title: '人际关系图谱：初始化「人际关系」笔记本',
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
        id: 'security',
        title: '人际关系图谱：安全设置（开启或关闭加密）',
        async run() {
          await context.ui.panels.open(PANEL_ID);
          context.ui.showNotice('请在面板右上角点击「安全设置」。');
        }
      })
    );

    return () => {
      for (const d of disposers) {
        try {
          d();
        } catch {
          /* 单个清理失败不影响其余 */
        }
      }
    };
  }
};

export default plugin;
