/**
 * graph.ts —— 力导向关系图（零依赖，手写物理模拟）
 *
 * 不引入 d3 / cytoscape 的原因是发布产物必须是单文件 bundle，
 * 保持零依赖能让打包结果稳定在百 KB 量级，也便于人工审阅。
 */

import { Person, groupColor, strengthLabel } from './types';

interface GNode {
  name: string;
  group: string;
  importance: number;
  degree: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  el?: SVGGElement;
  circle?: SVGCircleElement;
}

interface GLink {
  a: GNode;
  b: GNode;
  type: string;
  strength: number;
  el?: SVGLineElement;
}

export interface GraphOptions {
  onSelect?: (name: string) => void;
  onHover?: (name: string | null) => void;
}

const NS = 'http://www.w3.org/2000/svg';

export class RelationGraph {
  private container: HTMLElement;
  private svg: SVGSVGElement;
  private gEdges: SVGGElement;
  private gNodes: SVGGElement;
  private nodes: GNode[] = [];
  private links: GLink[] = [];
  private byName = new Map<string, GNode>();
  private raf = 0;
  private ro?: ResizeObserver;
  private selected = '';
  private hovered: string | null = null;
  private dragging: GNode | null = null;
  private visibleGroups: Set<string> | null = null;
  private minImportance = 1;
  private W = 600;
  private H = 420;
  private cx = 300;
  private cy = 210;
  private opts: GraphOptions;
  private disposed = false;

  constructor(container: HTMLElement, opts: GraphOptions = {}) {
    this.container = container;
    this.opts = opts;
    this.svg = document.createElementNS(NS, 'svg');
    this.svg.setAttribute('class', 'esg-graph-svg');
    this.gEdges = document.createElementNS(NS, 'g');
    this.gNodes = document.createElementNS(NS, 'g');
    this.svg.append(this.gEdges, this.gNodes);
    container.append(this.svg);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);

    this.svg.addEventListener('pointermove', this.onMove);
    this.svg.addEventListener('pointerup', this.onUp);
    this.svg.addEventListener('pointerleave', this.onUp);

    this.resize();
    this.loop();
  }

  /* ------------------------------- 数据 ------------------------------- */

  setData(people: Person[]) {
    const prev = new Map(this.nodes.map((n) => [n.name, n]));
    const degree = new Map<string, number>();
    for (const p of people) {
      for (const r of p.relations) {
        degree.set(p.name, (degree.get(p.name) || 0) + 1);
        degree.set(r.to, (degree.get(r.to) || 0) + 1);
      }
    }

    this.nodes = people.map((p, i, arr) => {
      const old = prev.get(p.name);
      const a = (i / Math.max(1, arr.length)) * Math.PI * 2;
      return {
        name: p.name,
        group: p.group,
        importance: p.importance,
        degree: degree.get(p.name) || 0,
        x: old ? old.x : this.cx + Math.cos(a) * 120 + (Math.random() - 0.5) * 30,
        y: old ? old.y : this.cy + Math.sin(a) * 120 + (Math.random() - 0.5) * 30,
        vx: 0,
        vy: 0,
        r: 7 + Math.max(1, Math.min(10, p.importance)) * 1.5
      };
    });

    this.byName = new Map(this.nodes.map((n) => [n.name, n]));

    const links: GLink[] = [];
    const seen = new Set<string>();
    for (const p of people) {
      const a = this.byName.get(p.name);
      if (!a) continue;
      for (const r of p.relations) {
        const b = this.byName.get(r.to);
        if (!b) continue;
        const k = [a.name, b.name].sort().join('\u0000');
        if (seen.has(k)) continue;
        seen.add(k);
        links.push({ a, b, type: r.type, strength: r.strength });
      }
    }
    this.links = links;

    this.build();
    this.paint();
  }

  private build() {
    this.gEdges.replaceChildren();
    this.gNodes.replaceChildren();

    for (const l of this.links) {
      const ln = document.createElementNS(NS, 'line');
      ln.setAttribute('stroke-linecap', 'round');
      this.gEdges.append(ln);
      l.el = ln;
    }

    for (const n of this.nodes) {
      const g = document.createElementNS(NS, 'g');
      g.setAttribute('class', 'esg-node');

      const c = document.createElementNS(NS, 'circle');
      c.setAttribute('r', String(n.r));
      c.setAttribute('fill', groupColor(n.group));
      c.setAttribute('stroke', '#fff');
      c.setAttribute('stroke-width', '2');

      const t = document.createElementNS(NS, 'text');
      t.setAttribute('y', String(n.r + 13));
      t.textContent = n.name;

      const title = document.createElementNS(NS, 'title');
      title.textContent = `${n.name} · ${n.group} · 重要度 ${n.importance}`;

      g.append(c, t, title);
      this.gNodes.append(g);
      n.el = g;
      n.circle = c;

      g.addEventListener('pointerenter', () => {
        this.hovered = n.name;
        this.paint();
        this.opts.onHover?.(n.name);
      });
      g.addEventListener('pointerleave', () => {
        this.hovered = null;
        this.paint();
        this.opts.onHover?.(null);
      });
      g.addEventListener('pointerdown', (ev) => {
        ev.stopPropagation();
        this.dragging = n;
        try {
          this.svg.setPointerCapture((ev as PointerEvent).pointerId);
        } catch {
          /* 某些环境不支持 */
        }
        this.select(n.name);
      });
    }
  }

  /* ------------------------------- 渲染 ------------------------------- */

  private neighbors(name: string): Set<string> {
    const s = new Set<string>([name]);
    for (const l of this.links) {
      if (l.a.name === name) s.add(l.b.name);
      if (l.b.name === name) s.add(l.a.name);
    }
    return s;
  }

  private isVisible(n: GNode): boolean {
    if (this.visibleGroups && !this.visibleGroups.has(n.group)) return false;
    return n.importance >= this.minImportance;
  }

  setFilter(groups: Set<string> | null, minImportance: number) {
    this.visibleGroups = groups;
    this.minImportance = Math.max(1, minImportance);
    this.paint();
  }

  select(name: string) {
    this.selected = name;
    this.paint();
    this.opts.onSelect?.(name);
  }

  selectedName(): string {
    return this.selected;
  }

  private paint() {
    const near = this.hovered ? this.neighbors(this.hovered) : null;

    for (const n of this.nodes) {
      if (!n.el || !n.circle) continue;
      const vis = this.isVisible(n);
      n.el.style.display = vis ? '' : 'none';
      n.circle.setAttribute('fill', groupColor(n.group));
      n.circle.classList.toggle('esg-sel', n.name === this.selected);
      let dim = !vis;
      if (!dim && near && !near.has(n.name)) dim = true;
      n.el.classList.toggle('esg-dim', dim);
    }

    for (const l of this.links) {
      if (!l.el) continue;
      const vis = this.isVisible(l.a) && this.isVisible(l.b);
      l.el.style.display = vis ? '' : 'none';
      l.el.setAttribute('stroke-width', (0.6 + l.strength * 0.55).toFixed(2));
      l.el.setAttribute('stroke', l.strength >= 4 ? '#9FE1CB' : '#DEDCD6');
      const dim = this.hovered ? l.a.name !== this.hovered && l.b.name !== this.hovered : false;
      l.el.setAttribute('opacity', dim ? '0.14' : '1');
    }

    const sel = this.byName.get(this.selected);
    if (sel?.el) this.gNodes.append(sel.el);
  }

  /* ------------------------------- 物理 ------------------------------- */

  private loop = () => {
    if (this.disposed) return;
    this.step();
    this.render();
    this.raf = requestAnimationFrame(this.loop);
  };

  private step() {
    const REP = 6200;
    const SPRING = 0.022;
    const DAMP = 0.84;
    const n = this.nodes;

    for (let i = 0; i < n.length; i++) {
      for (let j = i + 1; j < n.length; j++) {
        const a = n[i];
        const b = n[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) {
          dx = Math.random() - 0.5;
          dy = Math.random() - 0.5;
          d2 = 1;
        }
        const d = Math.sqrt(d2);
        const f = REP / d2;
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        a.vx -= fx;
        a.vy -= fy;
        b.vx += fx;
        b.vy += fy;
      }
    }

    for (const l of this.links) {
      const dx = l.b.x - l.a.x;
      const dy = l.b.y - l.a.y;
      const d = Math.hypot(dx, dy) || 0.01;
      const target = 128 - l.strength * 8;
      const f = (d - target) * SPRING;
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      l.a.vx += fx;
      l.a.vy += fy;
      l.b.vx -= fx;
      l.b.vy -= fy;
    }

    for (const node of n) {
      const pull = node.degree >= 4 ? 0.018 : 0.004;
      node.vx += (this.cx - node.x) * pull;
      node.vy += (this.cy - node.y) * pull;

      if (node === this.dragging) {
        node.vx = 0;
        node.vy = 0;
        continue;
      }
      node.vx *= DAMP;
      node.vy *= DAMP;
      const sp = Math.hypot(node.vx, node.vy);
      if (sp > 14) {
        node.vx = (node.vx / sp) * 14;
        node.vy = (node.vy / sp) * 14;
      }
      node.x += node.vx;
      node.y += node.vy;
      const pad = node.r + 22;
      node.x = Math.max(pad, Math.min(this.W - pad, node.x));
      node.y = Math.max(pad, Math.min(this.H - pad, node.y));
    }
  }

  private render() {
    for (const n of this.nodes) {
      n.el?.setAttribute('transform', `translate(${n.x.toFixed(1)},${n.y.toFixed(1)})`);
    }
    for (const l of this.links) {
      if (!l.el) continue;
      l.el.setAttribute('x1', l.a.x.toFixed(1));
      l.el.setAttribute('y1', l.a.y.toFixed(1));
      l.el.setAttribute('x2', l.b.x.toFixed(1));
      l.el.setAttribute('y2', l.b.y.toFixed(1));
    }
  }

  private onMove = (e: PointerEvent) => {
    if (!this.dragging) return;
    const r = this.svg.getBoundingClientRect();
    this.dragging.x = e.clientX - r.left;
    this.dragging.y = e.clientY - r.top;
  };

  private onUp = () => {
    this.dragging = null;
  };

  private resize() {
    const rect = this.container.getBoundingClientRect();
    this.W = Math.max(280, Math.round(rect.width) || 600);
    this.H = Math.max(300, Math.round(rect.height) || 420);
    this.cx = this.W / 2;
    this.cy = this.H / 2;
    this.svg.setAttribute('viewBox', `0 0 ${this.W} ${this.H}`);
  }

  relayout() {
    for (const n of this.nodes) {
      const a = Math.random() * Math.PI * 2;
      const d = 60 + Math.random() * 160;
      n.x = this.cx + Math.cos(a) * d;
      n.y = this.cy + Math.sin(a) * d;
      n.vx = 0;
      n.vy = 0;
    }
  }

  destroy() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    this.svg.removeEventListener('pointermove', this.onMove);
    this.svg.removeEventListener('pointerup', this.onUp);
    this.svg.removeEventListener('pointerleave', this.onUp);
    this.svg.remove();
  }
}

/** 生成 Mermaid 图谱文本，可写入笔记由宿主渲染 */
export function toMermaid(people: Person[]): string {
  const id = (_name: string, i: number) => `p${i}`;
  const idx = new Map(people.map((p, i) => [p.name, id(p.name, i)]));
  const defs = people.map((p, i) => `  ${id(p.name, i)}["${p.name}<br/>${p.group}"]`).join('\n');
  const edges: string[] = [];
  const seen = new Set<string>();
  for (const p of people) {
    for (const r of p.relations) {
      const a = idx.get(p.name);
      const b = idx.get(r.to);
      if (!a || !b) continue;
      const k = [a, b].sort().join('-');
      if (seen.has(k)) continue;
      seen.add(k);
      const arrow = r.strength >= 4 ? '==>' : '-->';
      edges.push(`  ${a} ${arrow}|${r.type}·${strengthLabel(r.strength)}| ${b}`);
    }
  }
  return ['```mermaid', 'graph LR', defs, edges.join('\n'), '```'].filter(Boolean).join('\n');
}
