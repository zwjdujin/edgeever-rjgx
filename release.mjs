/**
 * release.mjs —— 组装 GitHub Release 发布资产
 *
 * EdgeEver 官方对 GitHub 分发的要求：
 *   · 默认分支根目录必须包含最新的 manifest.json
 *   · 每个版本通过 GitHub Release 发布，Tag = 版本号（1.0.0）或 v 前缀（v1.0.0）
 *   · Release 资产必须包含 manifest.json、main.js，styles.css 可选
 *   · Release 里的 manifest.json 必须与默认分支中的完全一致（逐字节），否则安装被拒
 *
 * 本脚本做三件事：重新构建 → 把三个资产复制到 release/ → 打印 SHA-256 供核对。
 */

import { createHash } from 'node:crypto';
import { mkdirSync, copyFileSync, readFileSync, rmSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const p = (rel) => join(root, rel);
const ASSETS = ['manifest.json', 'main.js', 'styles.css'];

/* 1) 重新构建，保证产物与源码同步 */
await import('./build.mjs');

/* 2) 版本一致性自检：package.json 与 manifest.json 必须同号 */
const pkg = JSON.parse(readFileSync(p('package.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(p('manifest.json'), 'utf8'));

if (pkg.version !== manifest.version) {
  console.error(`\n发布中止：版本号不一致。`);
  console.error(`  package.json  version = ${pkg.version}`);
  console.error(`  manifest.json version = ${manifest.version}`);
  process.exit(1);
}
if (manifest.entry !== './main.js') {
  console.error(`发布中止：manifest.entry 必须固定为 ./main.js，当前为 ${manifest.entry}`);
  process.exit(1);
}

/* 3) 组装 release/ 目录 */
const outDir = p('release');
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

console.log(`\n组装发布资产 · v${manifest.version}\n`);
const rows = [];
for (const f of ASSETS) {
  const src = p(f);
  const dst = join(outDir, f);
  copyFileSync(src, dst);
  const buf = readFileSync(dst);
  rows.push({
    file: f,
    size: statSync(dst).size,
    sha256: createHash('sha256').update(buf).digest('hex')
  });
}

for (const r of rows) {
  console.log(`  ${r.file.padEnd(15)} ${(r.size / 1024).toFixed(1).padStart(7)} KB   sha256:${r.sha256}`);
}

/* 4) 关键一致性校验：release/manifest.json 必须与仓库根 manifest.json 逐字节相同 */
const a = readFileSync(p('manifest.json'));
const b = readFileSync(join(outDir, 'manifest.json'));
if (!a.equals(b)) {
  console.error('\n发布中止：release/manifest.json 与仓库根 manifest.json 不一致（EdgeEver 会拒绝安装）。');
  process.exit(1);
}

console.log(`\n产物已就绪：${outDir}`);
console.log('\n下一步（在 GitHub 网页端操作）：');
console.log(`  1. 把 manifest.json / main.js / styles.css 提交到默认分支根目录`);
console.log(`  2. 新建 Release，Tag 填 v${manifest.version}（或 ${manifest.version}），标题随你`);
console.log(`  3. 上传 release/ 里的三个文件作为 Release 资产`);
console.log(`  4. 在 EdgeEver「插件市场」页粘贴你的仓库地址安装\n`);
