# EdgeEver 人际关系管理插件

以笔记为中心管理你的人际网络。每位联系人是一篇带有「人际」标签的笔记，插件在此基础上提供：

- **新建联系人**：一键生成结构化联系人卡片（关系 / 公司 / 电话 / 生日 / 认识场合 / 互动记录），自动归入「人际关系」笔记本。
- **人际关系面板**：全屏仪表盘，集中浏览、搜索所有联系人，点击直接打开对应笔记。
- **统计联系人数量**：快速查看当前人脉规模。
- **可配置**：联系人标签、笔记本名称均可在插件设置页修改（宿主渲染设置，符合 Plugin API v2）。

## 安装

在 EdgeEver 的 **插件市场**（独立页面或 设置 → 插件）中粘贴本仓库地址安装：

```text
https://github.com/zwjdujin/edgeever-rjgx
```

要求：EdgeEver 默认分支（main）含根目录 `manifest.json`，并发布同名版本的 GitHub Release（本仓库已满足）。

> 若提示 `Repository manifest request failed with HTTP 403`，是 GitHub 匿名 API 对当前出口 IP 限流（60 次/小时）所致，与仓库本身无关。等几分钟重试，或更换网络（例如让服务器侧能访问 raw.githubusercontent.com）即可。

## 仓库结构

```text
manifest.json   # EdgeEver 扩展清单（type: plugin, entry: ./main.js）
main.js         # 插件单文件包（ESM，无相对导入）
.zcode-plugin/  # 同仓库的 ZCode 技能定义（与 EdgeEver 插件互不影响）
skills/         # ZCode 技能文件
```

## 使用建议

- 联系人笔记就是普通笔记，可以直接在编辑器里补充信息、写互动记录，面板会实时反映。
- 卸载插件不影响已有笔记；标签和笔记本都保留。
