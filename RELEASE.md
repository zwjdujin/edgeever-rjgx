# 发布到 GitHub 并安装到 EdgeEver

> **无法直接 `git push`？** 见 `手动上传指南.md` —— 一条 `npm run package` 生成可手动上传的 zip。

本文档把 EdgeEver 官方插件规范里关于「GitHub 分发」的硬性要求固化成一份可照做的清单。

---

## 一、能不能这么做？

**能，而且这是官方支持的三种安装途径之一**（另外两种是「已验证插件市场」和「Manifest 地址」）。

流程就是：

```
你的电脑 ──git push──▶ 公开 GitHub 仓库 ──▶ EdgeEver 实例代理拉取 ──▶ 安装到当前设备
```

EdgeEver 会把 GitHub 的元数据和 Release 资产**由你的实例代理获取**，所以桌面端/浏览器不需要直连 `api.github.com`。

---

## 二、硬性前提（不满足会被直接拒绝）

| # | 要求 | 本项目状态 |
|---|------|-----------|
| 1 | 仓库必须是**公开**的（私有仓库 Token 尚未开放） | ⬜ 待你创建 |
| 2 | `manifest.json` 必须位于**默认分支根目录** | ✅ 已在根目录 |
| 3 | 每个版本通过 **GitHub Release** 发布 | ⬜ 待创建 |
| 4 | Release Tag = `1.0.0` 或 `v1.0.0`（与 manifest 版本号一致） | ⬜ 待创建 |
| 5 | Release 资产必须含 `manifest.json`、`main.js`，`styles.css` 可选 | ✅ 三个文件均已就绪 |
| 6 | `entry` **固定**为 `./main.js` | ✅ |
| 7 | `main.js` 必须是**无需相对模块导入的单文件 Bundle** | ✅ 构建时自检 |
| 8 | `main.js` ≤ 5 MB，`styles.css` ≤ 1 MB | ✅ 70.4 KB / 8.0 KB |
| 9 | **Release 里的 `manifest.json` 必须与默认分支中的完全一致**，否则安装被拒绝 | ✅ 由 `release.mjs` 保证逐字节相同 |

> 第 9 条是最容易踩的坑：改完版本号忘了同步两边，或者 Release 传了旧文件。

---

## 三、仓库目录结构（关键：插件必须在仓库根目录）

```
你的仓库/
├── manifest.json      ← 必须在根目录，EdgeEver 靠它发现插件
├── main.js            ← 构建产物，必须提交
├── styles.css         ← 构建产物，必须提交
├── package.json
├── build.mjs
├── release.mjs
├── LICENSE
├── README.md
├── RELEASE.md
└── src/ test/ preview/
```

**不要把插件放在子目录里**。EdgeEver 读的是默认分支根目录的 `manifest.json`。

---

## 四、操作步骤

### 4.1 本地：生成发布资产

```sh
npm install
npm run release        # 构建 + 组装 release/ + 打印 SHA-256
```

产物在 `release/`：`manifest.json`、`main.js`、`styles.css`。

### 4.2 本地：初始化仓库并推送

**本项目已完成 `git init`、首次提交与 `v1.0.0` 标签**，只差配置远端并推送：

```sh
# 提交身份（未推送前都还能改）
git config user.name "dujin"
git config user.email "zwjdujin@users.noreply.github.com"

# 远端（先在 GitHub 网页端建一个 public 空仓库，不要勾选 README）
git remote add origin https://github.com/zwjdujin/edgeever-rjgx.git

git push -u origin main
git push origin v1.0.0
```

从零开始的完整版本（供新项目参考）：

```sh
git init
git add .
git commit -m "feat: 人际关系图谱插件 v1.0.0"
git branch -M main
git tag -a v1.0.0 -m "人际关系图谱 v1.0.0"
```

> ⚠️ 注意：**不要**在 `C:\Users\zwjdu\WorkBuddy\edgeever` 这个上层目录里提交再推送——
> 那个目录里有一个残留的空 `.git`，远端指向官方上游 `tianma-if/edgeever`，推送会失败或搞错目标。
> 仓库必须建在插件目录自身。
>
> 仓库必须选 **public**。私有仓库的 Token 尚未开放，EdgeEver 拉不到。

### 4.2.1 认证：让后续推送能免交互完成

本机情况（已核实）：`git` 是 PortableGit 2.55，系统 gitconfig 里 `credential.helper = helper-selector`，
实际走 **Git Credential Manager 2.9.0**（`git-credential-manager.exe` 已随 PortableGit 安装），
默认存储后端是 **Windows 凭据管理器**。当前**没有存任何 GitHub 凭据**。

#### 路线 A：手动授权一次，之后全自动（推荐）

在**自己的终端**里执行一次：

```sh
cd C:\Users\zwjdu\WorkBuddy\edgeever\edgeever-social-graph-plugin
git push -u origin main
git push origin v1.0.0
```

GCM 会弹出授权（浏览器 OAuth 或设备码），完成后凭据落入 Windows 凭据管理器。
**此后任何本地 git 操作都不再需要人工授权**，包括由 AI 代为执行的 `git push`。
好处是全程不产生明文 token，也不需要把密钥交给任何工具。

#### 路线 B：交给 AI 代推（需要一次性 token）

适用场景：不想手动操作，或要一次性完成「推送 + 创建 Release + 上传资产」。

1. 网页端建好 public 空仓库
2. 建 **fine-grained PAT**：
   - Repository access → 只勾 `edgeever-rjgx`
   - Permissions → **Contents: Read and write**
   - Expiration → 选最短（1 天 / 7 天）
3. 把 token 交给 AI，一次性完成下列动作，**用毕立即 Revoke**：
   ```sh
   # 推送（用环境变量传 token，不落盘、不进 .git/config）
   git push https://<user>:${TOKEN}@github.com/<user>/edgeever-rjgx.git main
   git push https://<user>:${TOKEN}@github.com/<user>/edgeever-rjgx.git v1.0.0
   # 创建 Release
   curl -X POST -H "Authorization: Bearer $TOKEN" \
     https://api.github.com/repos/<user>/edgeever-rjgx/releases \
     -d '{"tag_name":"v1.0.0","name":"v1.0.0"}'
   # 上传资产（对每个文件，:id 为上面返回的 release id）
   curl -X POST -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/javascript" \
     --data-binary @release/main.js \
     "https://uploads.github.com/repos/<user>/edgeever-rjgx/releases/<id>/assets?name=main.js"
   ```

> **安全约定**：token 会经过对话上下文，等同于「暴露给 AI」。因此必须
> ①限制到单个仓库 ②设最短有效期 ③用完立刻 Revoke。
> 任何情况下都**不要把 token 写进文件、`.git/config` 或提交内容**。

#### 路线 C：不推荐

装 `gh` CLI 看似方便，但 `gh auth login` 仍是交互式，`--with-token` 一样需要 token，
而 Release 创建与资产上传用 `curl` 已能完成。除非还想用 `gh` 的其他能力，否则没必要引入。

### 4.3 GitHub 网页端：创建 Release

1. 仓库页 → **Releases** → **Draft a new release**
2. **Choose a tag** 选已推送的 `v1.0.0`（若下拉里没有，就手填 `v1.0.0` 并选 *Create new tag on publish*）
3. **Title** 随意（例如 `v1.0.0`）
4. **描述**可参考下面这段
5. 把 `release/` 里的 **三个文件**拖进附件区
   - ⚠️ 注意 GitHub 会把上传的附件重命名（如 `main.js` → `main.2.js` 之类）的情况通常不会发生，但**发布后请点开确认资产名就是 `main.js`、`manifest.json`、`styles.css`**
6. 点 **Publish release**

Release 描述模板：

```markdown
## 人际关系图谱 v1.0.0

把 EdgeEver 的「人际关系」笔记本变成可交互的关系图谱。

### 功能
- 人物档案、关系强度、互动记录
- 零依赖力导向关系图，支持拖拽 / 悬停高亮 / 圈层筛选
- 明文模式（每人一篇 Markdown 笔记）或加密模式（AES-GCM 整份加密）
- 导出 Mermaid 关系总览

### 安装
1. 下载 `main.js`、`manifest.json`、`styles.css`
2. EdgeEver → 插件市场 → 粘贴本仓库地址

### 安全模型
社区插件是受信任代码，安装即等于完全信任。加密模式采用 PBKDF2-SHA256（15 万次迭代）+ AES-GCM 认证加密。
```

### 4.4 EdgeEver 内安装

1. 打开 EdgeEver → **插件市场**页面
2. 粘贴仓库地址（不是 Release 地址）：

   ```text
   https://github.com/zwjdujin/edgeever-rjgx
   ```

3. 会显示「未经验证的来源」——这是正常的，官方市场收录才有「已验证」标记
4. 点安装 → **首次启用社区客户端插件会弹一次信任确认**，确认后不再重复
5. 运行命令 **「人际关系图谱：打开面板」**

---

## 五、版本更新

- 社区插件**绝不静默更新**，需要你手动点「更新」并确认。
- 如果新版改变了能力声明或网络域名元数据，确认框会列出变化供你查看。
- 升级采用可回滚切换：新版无法激活时，EdgeEver 会恢复原 Manifest、原启用状态与上一版代码。

发新版本时：

1. 同时改 `package.json` 和 `manifest.json` 的 `version`（`release.mjs` 会校验一致性，不同号直接中止）
2. `npm run release`
3. 提交 `manifest.json` / `main.js` / `styles.css` 到默认分支
4. 新建 Release，Tag 用新版本号，上传同样三个资产

---

## 六、卸载会清除什么

卸载插件时会**同时删除**：

- 本机缓存的全部插件版本
- 当前工作区的普通插件存储
- Secret Storage

**但不会动你的笔记。** 这也是本插件把数据放在笔记里的原因——卸载插件不丢数据。加密模式下，数据笔记里的密文仍是完整的，重新安装后用同一密码即可解锁。

---

## 七、常见被拒原因排查

| 现象 | 原因 | 处理 |
|------|------|------|
| 安装被拒绝 / 提示 manifest 不一致 | Release 的 `manifest.json` 与默认分支的不同 | 重新上传同一个文件，或重新执行 `npm run release` 后两边一起更新 |
| 找不到插件 | `manifest.json` 不在默认分支根目录 | 把插件移到仓库根目录 |
| 找不到版本 | Release Tag 与 `manifest.version` 不匹配 | Tag 用 `1.0.0` 或 `v1.0.0` |
| 拉取失败 | 仓库是私有的 | 改为公开（私有仓库 Token 未开放） |
| 启用后无反应 | `main.js` 残留相对导入或不是单文件 | 执行 `npm run build`，其内置自检会拦住这类问题 |
| 面板命令找不到 | 面板类插件不在插件安装卡片的启动命令里 | 从插件工具栏菜单打开，或直接跑命令面板 |
