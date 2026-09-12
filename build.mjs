/**
 * build.mjs —— 打包为单文件 main.js
 *
 * 约束（来自 EdgeEver 插件规范）：
 *   · main.js 必须是「无需相对模块导入」的单文件 Bundle
 *   · main.js ≤ 5 MB，styles.css ≤ 1 MB
 *   · 发布包中不能残留 @edgeever/plugin-api 的运行时导入
 *
 * 本插件零运行时依赖，因此产物体积由源码规模决定，稳定在百 KB 内。
 */

import { build } from 'esbuild';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const p = (rel) => join(root, rel);

/* 1) 从 styles.ts 抽出 CSS，写成 styles.css（单一来源，避免两处维护） */
const stylesSrc = readFileSync(p('src/ui/styles.ts'), 'utf8');
const cssMatch = stylesSrc.match(/export const CSS = `([\s\S]*?)`;/);
if (!cssMatch) {
  console.error('构建中止：未能从 src/ui/styles.ts 提取 CSS 模板字符串。');
  process.exit(1);
}
const css = cssMatch[1].trim() + '\n';
writeFileSync(p('styles.css'), css, 'utf8');

/* 2) 打包入口 */
const result = await build({
  entryPoints: [p('src/index.ts')],
  outfile: p('main.js'),
  bundle: true,
  format: 'esm',
  target: ['es2020'],
  platform: 'browser',
  minify: false,
  sourcemap: false,
  legalComments: 'none',
  charset: 'utf8',
  logLevel: 'warning',
  banner: {
    js: '/* 人际关系图谱 · EdgeEver 插件 · 由 build.mjs 生成，请勿直接修改此文件 */'
  },
  metafile: true
});

/* 3) 产物自检 */
const mainJs = readFileSync(p('main.js'), 'utf8');
const mainSize = statSync(p('main.js')).size;
const cssSize = statSync(p('styles.css')).size;

const problems = [];
if (mainSize > 5 * 1024 * 1024) problems.push(`main.js 体积超限：${mainSize} 字节 > 5 MB`);
if (cssSize > 1024 * 1024) problems.push(`styles.css 体积超限：${cssSize} 字节 > 1 MB`);
if (/from\s*["']@edgeever\/plugin-api["']/.test(mainJs)) problems.push('产物中残留 @edgeever/plugin-api 导入');
if (/^\s*import\s+[^;]*from\s*["']\.\//m.test(mainJs)) problems.push('产物中残留相对路径导入（未完成打包）');
if (!/export\s*\{/.test(mainJs) && !/export default/.test(mainJs)) problems.push('产物缺少 ESM 导出');

const inputs = Object.keys(result.metafile.inputs).length;
console.log('构建完成');
console.log(`  入口模块数     ${inputs}`);
console.log(`  main.js        ${(mainSize / 1024).toFixed(1)} KB`);
console.log(`  styles.css     ${(cssSize / 1024).toFixed(1)} KB`);

if (problems.length) {
  console.error('\n产物自检未通过：');
  for (const x of problems) console.error('  ✗ ' + x);
  process.exit(1);
}
console.log('  产物自检       通过（单文件 · 无 SDK 依赖 · 体积合规）');
