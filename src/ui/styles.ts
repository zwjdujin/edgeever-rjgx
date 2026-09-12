/**
 * styles.ts —— 面板样式（单一来源）
 *
 * 构建脚本会把这份 CSS 同时写成 styles.css 供宿主加载，
 * 插件在 mount 时也会注入一次（带 data-esg-style 标记，幂等），
 * 避免因宿主加载时机不同导致面板裸奔。
 *
 * 所有类名以 esg- 前缀隔离，不污染宿主样式。
 * 同时提供浅色与深色两套变量，跟随系统 prefers-color-scheme。
 */

export const CSS = `
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

export function injectStyles(doc: Document = document): void {
  if (doc.querySelector('style[data-esg-style]')) return;
  const el = doc.createElement('style');
  el.setAttribute('data-esg-style', '1');
  el.textContent = CSS;
  doc.head.append(el);
}
