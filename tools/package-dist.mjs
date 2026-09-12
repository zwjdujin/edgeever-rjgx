#!/usr/bin/env node
/**
 * package-dist.mjs —— 生成「可手动上传」的打包产物
 *
 * 产出 dist-upload/ 下的三类东西：
 *   1. <repo>-v<ver>-source.zip    源码整包（解压得到一个项目文件夹，可直接拖进 GitHub）
 *   2. <repo>-v<ver>-release.zip   Release 资产包（解压得到 manifest.json / main.js / styles.css）
 *   3. release-assets/             三个文件散装副本（GitHub Release 页可直接拖拽）
 *   4. SHA256SUMS.txt              全部产物的校验和
 *
 * 用法：node tools/package-dist.mjs
 * 前置：先跑 `npm run release`，确保 release/ 与当前源码一致。
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist-upload');

/* ----------------------------- 需要排除的内容 ----------------------------- */

/** 目录名黑名单（任意层级命中即整棵剪掉） */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist-upload', 'release', '.workbuddy']);

/** 相对路径黑名单（POSIX 风格） */
const SKIP_FILES = new Set([
  // 临时/本地文件
  '.gcm-login.log',
  'publish.mjs',
  // 构建与测试的中间产物（应由 npm run 重新生成）
  'test/.smoke.mjs',
  'test/.dom.cjs',
  'preview/preview.js'
]);

/** Release 必须包含的资产（顺序即上传顺序） */
const RELEASE_ASSETS = ['manifest.json', 'main.js', 'styles.css'];

/* --------------------------------- 工具 --------------------------------- */

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const toPosix = (p) => p.split(path.sep).join('/');
const kb = (n) => (n / 1024).toFixed(1) + ' KB';

function walk(dir, base = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...walk(abs, rel));
    } else if (entry.isFile()) {
      if (SKIP_FILES.has(rel)) continue;
      out.push({ abs, rel });
    }
  }
  return out;
}

/* ---------------------------------- 主流程 --------------------------------- */

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const version = manifest.version;
const slug = 'edgeever-rjgx';
const folder = `${slug}-v${version}`;

console.log(`插件：${manifest.name}  (id=${manifest.id})`);
console.log(`版本：v${version}    entry=${manifest.entry}\n`);

/* 0. 前置校验：release/ 必须已生成 */
for (const name of RELEASE_ASSETS) {
  const p = path.join(ROOT, 'release', name);
  if (!fs.existsSync(p)) {
    console.error(`✘ 缺少 release/${name} —— 请先执行：npm run release`);
    process.exit(1);
  }
}

/* 1. 校验 release 资产与仓库根目录的副本逐字节一致（EdgeEver 的硬性要求） */
for (const name of RELEASE_ASSETS) {
  const a = fs.readFileSync(path.join(ROOT, 'release', name));
  const b = fs.readFileSync(path.join(ROOT, name));
  if (!a.equals(b)) {
    console.error(`✘ release/${name} 与根目录的 ${name} 不一致 —— 请重新执行：npm run release`);
    process.exit(1);
  }
}
console.log('✔ release/ 与仓库根目录的资产逐字节一致\n');

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

/* 2. 源码整包 */
const files = walk(ROOT).sort((x, y) => x.rel.localeCompare(y.rel));
const srcZip = new JSZip();
for (const f of files) {
  srcZip.file(`${folder}/${f.rel}`, fs.readFileSync(f.abs), { unixPermissions: 0o644 });
}
const srcBuf = await srcZip.generateAsync({
  type: 'nodebuffer',
  compression: 'DEFLATE',
  compressionOptions: { level: 9 },
  platform: 'UNIX'
});
const srcName = `${folder}-source.zip`;
fs.writeFileSync(path.join(OUT, srcName), srcBuf);

/* 3. Release 资产包 */
const relZip = new JSZip();
const assetHashes = [];
for (const name of RELEASE_ASSETS) {
  const buf = fs.readFileSync(path.join(ROOT, 'release', name));
  relZip.file(name, buf, { unixPermissions: 0o644 });
  assetHashes.push({ name, size: buf.length, sha: sha256(buf) });
}
const relBuf = await relZip.generateAsync({
  type: 'nodebuffer',
  compression: 'DEFLATE',
  compressionOptions: { level: 9 },
  platform: 'UNIX'
});
const relName = `${folder}-release.zip`;
fs.writeFileSync(path.join(OUT, relName), relBuf);

/* 4. 散装资产副本 */
const looseDir = path.join(OUT, 'release-assets');
fs.mkdirSync(looseDir, { recursive: true });
for (const name of RELEASE_ASSETS) {
  fs.copyFileSync(path.join(ROOT, 'release', name), path.join(looseDir, name));
}

/* 4b. 上传指南（就地放一份，照着操作即可） */
const GUIDE = '手动上传指南.md';
const guideSrc = path.join(ROOT, GUIDE);
const hasGuide = fs.existsSync(guideSrc);
if (hasGuide) fs.copyFileSync(guideSrc, path.join(OUT, GUIDE));

/* 5. 校验和清单 */
const lines = [
  `# ${manifest.name} v${version} 打包校验和`,
  `# 生成时间：${new Date().toISOString()}`,
  `# 算法：SHA-256`,
  '',
  `## 压缩包`,
  `${sha256(srcBuf)}  ${srcName}`,
  `${sha256(relBuf)}  ${relName}`,
  '',
  `## Release 资产（压缩包内与散装副本相同）`
];
for (const a of assetHashes) lines.push(`${a.sha}  ${a.name}   (${a.size} bytes)`);
lines.push('');
fs.writeFileSync(path.join(OUT, 'SHA256SUMS.txt'), lines.join('\n'), 'utf8');

/* 6. 打印结果 */
console.log(`源码整包    ${srcName}`);
console.log(`            ${kb(srcBuf.length)} · ${files.length} 个文件 · 解压得到 ${folder}/`);
console.log('');
console.log(`Release 包  ${relName}`);
console.log(`            ${kb(relBuf.length)} · ${RELEASE_ASSETS.length} 个文件 · 解压即得三个资产`);
console.log('');
console.log('散装资产    release-assets/');
for (const a of assetHashes) console.log(`            ${a.name.padEnd(14)} ${kb(a.size).padStart(9)}   ${a.sha.slice(0, 16)}…`);
if (hasGuide) console.log(`\n操作指南    ${GUIDE}`);
console.log('');
console.log(`输出目录：${OUT}`);
