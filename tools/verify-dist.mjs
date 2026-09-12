#!/usr/bin/env node
/**
 * verify-dist.mjs —— 校验 dist-upload/ 里的打包产物
 *
 * 不只是"文件存在"，而是把 zip 解回内存后与源码**逐字节比对**：
 *   1. Release 包的三个资产 == 散装副本 == 仓库根目录副本
 *   2. 源码包路径全为正斜杠、且有统一前缀（解压不散落）
 *   3. 抽样文件逐字节一致（含二进制产物 main.js）
 *   4. 源码包的 main.js == Release 包的 main.js（默认分支与 Release 不会打架）
 *   5. SHA256SUMS.txt 里记录的校验和正确
 *
 * 用法：node tools/verify-dist.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist-upload');

const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')).version;
const FOLDER = `edgeever-rjgx-v${version}`;
const ASSETS = ['manifest.json', 'main.js', 'styles.css'];

/** 抽样逐字节比对的文件（含文本与二进制产物） */
const SAMPLES = [
  'manifest.json',
  'main.js',
  'styles.css',
  'package.json',
  'src/ui/panel.ts',
  'src/store.ts',
  'LICENSE',
  'tools/package-dist.mjs'
];

let pass = 0;
const fail = [];
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const ok = (msg) => { pass++; console.log('  ✔ ' + msg); };
const bad = (msg) => fail.push(msg);
const load = (p) => JSZip.loadAsync(fs.readFileSync(path.join(OUT, p)));

/* ------------------------------ 1. Release 包 ------------------------------ */
const rz = await load(`${FOLDER}-release.zip`);
const rEntries = Object.keys(rz.files).filter((n) => !rz.files[n].dir);
console.log(`[Release 包] ${rEntries.length} 个条目：${rEntries.join(', ')}`);
for (const name of ASSETS) {
  if (!rEntries.includes(name)) { bad(`release.zip 缺少 ${name}`); continue; }
  const inZip = await rz.file(name).async('nodebuffer');
  const loose = fs.readFileSync(path.join(OUT, 'release-assets', name));
  const root = fs.readFileSync(path.join(ROOT, name));
  if (sha(inZip) === sha(loose) && sha(inZip) === sha(root)) ok(`${name.padEnd(14)} 包内 / 散装 / 仓库根 三者一致`);
  else bad(`${name} 内容不一致`);
}

/* ------------------------------- 2. 源码包 -------------------------------- */
const sz = await load(`${FOLDER}-source.zip`);
const sEntries = Object.keys(sz.files).filter((n) => !sz.files[n].dir);
console.log(`\n[源码包] ${sEntries.length} 个条目`);

const backslashes = sEntries.filter((n) => n.includes('\\'));
backslashes.length
  ? bad(`存在反斜杠路径：${backslashes.slice(0, 3).join(', ')}`)
  : ok('全部路径为正斜杠（跨平台解压安全）');

sEntries.every((n) => n.startsWith(FOLDER + '/'))
  ? ok(`全部条目统一在 ${FOLDER}/ 前缀下（解压不散落）`)
  : bad('存在未加前缀的条目');

for (const rel of SAMPLES) {
  const entry = `${FOLDER}/${rel}`;
  if (!sEntries.includes(entry)) { bad(`源码包缺少 ${rel}`); continue; }
  const inZip = await sz.file(entry).async('nodebuffer');
  const onDisk = fs.readFileSync(path.join(ROOT, rel));
  sha(inZip) === sha(onDisk) ? ok(`${rel.padEnd(24)} 逐字节一致`) : bad(`${rel} 内容不一致`);
}

/* --------------------------- 3. 两包之间的自洽性 --------------------------- */
const sMain = await sz.file(`${FOLDER}/main.js`).async('nodebuffer');
const rMain = await rz.file('main.js').async('nodebuffer');
sha(sMain) === sha(rMain)
  ? ok('\n源码包与 Release 包的 main.js 完全相同（默认分支与 Release 不会打架）')
  : bad('源码包与 Release 包的 main.js 不同');

/* --------------------------- 4. 校验和清单自验证 --------------------------- */
const sums = fs.readFileSync(path.join(OUT, 'SHA256SUMS.txt'), 'utf8');
for (const f of [`${FOLDER}-source.zip`, `${FOLDER}-release.zip`]) {
  const buf = fs.readFileSync(path.join(OUT, f));
  sums.includes(sha(buf))
    ? ok(`SHA256SUMS.txt 中 ${f} 的校验和正确`)
    : bad(`SHA256SUMS.txt 中 ${f} 的校验和不匹配`);
}

console.log(`\n结果：${pass} 项通过，${fail.length} 项失败`);
if (fail.length) {
  fail.forEach((f) => console.log('  ✘ ' + f));
  process.exit(1);
}
console.log('全部校验通过 ✔');
