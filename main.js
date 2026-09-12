const CONTACT_TEMPLATE = (name) => [
  `# ${name}`,
  "",
  "## 基本信息",
  "",
  "- 关系：（朋友 / 同事 / 客户 / 家人 / 其他）",
  "- 公司 / 单位：",
  "- 电话：",
  "- 邮箱：",
  "- 生日：",
  "- 认识于：（时间 / 场合）",
  "",
  "## 备注",
  "",
  "## 互动记录",
  "",
  `- ${new Date().toISOString().slice(0, 10)} 创建联系人卡片`,
  "",
].join("\n");

const resolveSetting = async (context, key, fallback) => {
  try {
    const value = await context.settings.get(key);
    return typeof value === "string" && value.trim() ? value.trim() : fallback;
  } catch {
    return fallback;
  }
};

const resolveNotebook = async (context, notebookName) => {
  const notebooks = await context.notebooks.list();
  const existing = notebooks.find(
    (notebook) => (notebook.name ?? "").trim() === notebookName,
  );
  if (existing) return existing;
  return context.notebooks.create({ name: notebookName });
};

const listContacts = async (context, contactTag, keyword) => {
  const request = {
    tags: [contactTag],
    sort: "updated-desc",
    limit: 200,
  };
  if (keyword && keyword.trim()) request.text = keyword.trim();
  const result = await context.notes.query(request);
  return result.notes ?? [];
};

const buildContactRow = (note, onOpen) => {
  const row = document.createElement("button");
  row.type = "button";
  row.style.cssText = [
    "display: block",
    "width: 100%",
    "text-align: left",
    "padding: 10px 14px",
    "margin: 0 0 8px",
    "border: 1px solid rgba(148, 163, 184, 0.45)",
    "border-radius: 10px",
    "background: transparent",
    "cursor: pointer",
    "font: inherit",
    "color: inherit",
  ].join(";");
  row.addEventListener("mouseenter", () => { row.style.background = "rgba(148, 163, 184, 0.15)"; });
  row.addEventListener("mouseleave", () => { row.style.background = "transparent"; });

  const title = document.createElement("div");
  title.textContent = note.title || note.excerpt || "（未命名联系人）";
  title.style.cssText = "font-weight: 600; margin-bottom: 2px;";
  const excerpt = document.createElement("div");
  excerpt.textContent = note.excerpt || "";
  excerpt.style.cssText = "font-size: 13px; opacity: 0.7; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;";
  row.append(title, excerpt);
  row.addEventListener("click", () => onOpen(note));
  return row;
};

const buildCreateForm = (context, contactTag, notebookName, { onCancel, onCreated }) => {
  const form = document.createElement("form");
  form.style.cssText = "display: flex; flex-direction: column; gap: 10px; max-width: 480px; margin: 8px 0 20px;";

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.placeholder = "联系人姓名（必填）";
  nameInput.required = true;
  nameInput.style.cssText = "padding: 8px 10px; border: 1px solid rgba(148, 163, 184, 0.6); border-radius: 8px; font: inherit;";

  const remarkInput = document.createElement("input");
  remarkInput.type = "text";
  remarkInput.placeholder = "备注 / 认识场合（可选，写入互动记录）";
  remarkInput.style.cssText = nameInput.style.cssText;

  const actions = document.createElement("div");
  actions.style.cssText = "display: flex; gap: 8px;";
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.textContent = "创建";
  submit.style.cssText = "padding: 8px 18px; border: none; border-radius: 8px; background: #16a06e; color: #fff; cursor: pointer; font: inherit;";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "取消";
  cancel.style.cssText = "padding: 8px 18px; border: 1px solid rgba(148, 163, 184, 0.6); border-radius: 8px; background: transparent; cursor: pointer; font: inherit;";
  cancel.addEventListener("click", onCancel);
  actions.append(submit, cancel);

  form.append(nameInput, remarkInput, actions);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = nameInput.value.trim();
    if (!name) {
      context.ui.showNotice("请填写联系人姓名。");
      return;
    }
    const remark = remarkInput.value.trim();
    const contentMarkdown = remark
      ? `${CONTACT_TEMPLATE(name)}\n- ${new Date().toISOString().slice(0, 10)} ${remark}\n`
      : CONTACT_TEMPLATE(name);
    try {
      const notebook = await resolveNotebook(context, notebookName);
      const note = await context.notes.create({
        notebookId: notebook.id,
        title: name,
        contentMarkdown,
        tags: [contactTag],
      });
      context.ui.showNotice(`已创建联系人：${name}`);
      await onCreated(note);
    } catch (error) {
      context.ui.showNotice(`创建联系人失败：${error instanceof Error ? error.message : String(error)}`);
    }
  });
  setTimeout(() => nameInput.focus(), 0);
  return form;
};

const renderRelationshipsPanel = async (context, container, shell, options) => {
  const contactTag = await resolveSetting(context, "contact-tag", "人际");
  const notebookName = await resolveSetting(context, "notebook-name", "人际关系");

  const state = { keyword: "", creating: Boolean(options?.startInCreateMode) };

  const listHost = document.createElement("div");
  listHost.style.cssText = "display: flex; flex-direction: column;";
  container.append(listHost);

  const applyChrome = (count) => {
    shell.set({
      header: {
        title: "人际关系",
        description: `标签「${contactTag}」下共 ${count} 位联系人`,
        actions: [
          { id: "new-contact", label: "新建联系人" },
          { id: "refresh", label: "刷新" },
        ],
      },
      toolbar: [
        { type: "search", key: "q", placeholder: "搜索联系人…", value: state.keyword },
      ],
      empty: count === 0 && !state.creating
        ? { title: state.keyword ? "没有匹配的联系人" : "还没有联系人", description: "点击右上角「新建联系人」开始记录你的人脉。" }
        : null,
      onAction(id) {
        if (id === "new-contact") {
          state.creating = true;
          render();
        } else if (id === "refresh") {
          render();
        }
      },
      onChange(key, value) {
        if (key === "q") {
          state.keyword = value;
          render();
        }
      },
    });
  };

  const render = async () => {
    listHost.replaceChildren();
    if (state.creating) {
      listHost.append(buildCreateForm(context, contactTag, notebookName, {
        onCancel() {
          state.creating = false;
          render();
        },
        async onCreated(note) {
          state.creating = false;
          await render();
          if (note?.id) await context.ui.openNote(note.id);
        },
      }));
    }
    let contacts = [];
    try {
      contacts = await listContacts(context, contactTag, state.keyword);
    } catch (error) {
      const errorLine = document.createElement("p");
      errorLine.textContent = `读取联系人失败：${error instanceof Error ? error.message : String(error)}`;
      listHost.append(errorLine);
    }
    for (const note of contacts) {
      listHost.append(buildContactRow(note, async (contact) => {
        await context.ui.openNote(contact.id);
      }));
    }
    applyChrome(contacts.length);
  };

  await render();
};

export default {
  activate(context) {
    const disposePanel = context.ui.panels.register({
      id: "relationships",
      title: "人际关系面板",
      purpose: "dashboard",
      presentation: "fullscreen",
      async mount(container, { state, shell }) {
        await renderRelationshipsPanel(context, container, shell, {
          startInCreateMode: Boolean(state?.create),
        });
      },
    });

    const disposeOpen = context.commands.register({
      id: "open-relationships",
      title: "打开人际关系面板",
      async run() {
        await context.ui.panels.open("relationships");
      },
    });

    const disposeNew = context.commands.register({
      id: "new-contact",
      title: "新建联系人",
      menu: false,
      async run() {
        await context.ui.panels.open("relationships", { state: { create: true } });
      },
    });

    const disposeStats = context.commands.register({
      id: "contact-stats",
      title: "统计联系人数量",
      listed: false,
      async run() {
        const contactTag = await resolveSetting(context, "contact-tag", "人际");
        const contacts = await listContacts(context, contactTag, "");
        context.ui.showNotice(`当前共有 ${contacts.length} 位联系人（标签「${contactTag}」）。`);
      },
    });

    return () => {
      disposePanel();
      disposeOpen();
      disposeNew();
      disposeStats();
    };
  },
};
