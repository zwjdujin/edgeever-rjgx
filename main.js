const FIELD_DEFS = [
  { key: "name", label: "姓名", input: "text", required: true, placeholder: "必填" },
  { key: "gender", label: "性别", input: "select", options: ["男", "女", "其他", "保密"] },
  { key: "married", label: "婚况", input: "select", options: ["未婚", "已婚", "离异", "丧偶", "保密"] },
  { key: "height", label: "身高(cm)", input: "text", inputMode: "decimal", inputFilter: /[^0-9.]/g, placeholder: "如 175", validate: numberInRange(0, 300, "身高") },
  { key: "weight", label: "体重(kg)", input: "text", inputMode: "decimal", inputFilter: /[^0-9.]/g, placeholder: "如 65.5", validate: numberInRange(0, 500, "体重") },
  { key: "shoeSize", label: "鞋子尺码", input: "text", inputMode: "decimal", inputFilter: /[^0-9.]/g, placeholder: "如 42.5", validate: numberInRange(0, 100, "鞋子尺码") },
  { key: "phone", label: "手机号", input: "text", inputMode: "numeric", inputFilter: /\D/g, placeholder: "仅可输入数字", aliases: ["电话"], validate: digitsOnly("手机号") },
  { key: "formerPhone", label: "曾用手机号", input: "text", inputMode: "numeric", inputFilter: /\D/g, placeholder: "仅可输入数字", validate: digitsOnly("曾用手机号") },
  { key: "idCard", label: "身份证号", input: "text", placeholder: "18位，末位可为X", normalize: (value) => value.toUpperCase(), validate: validateIdCard },
  { key: "email", label: "邮箱", input: "text", inputMode: "email", placeholder: "name@example.com", validate: validateEmail },
  { key: "birthday", label: "生日", input: "date" },
  { key: "relation", label: "关系", input: "text", placeholder: "朋友 / 同事 / 客户 / 家人 / 其他" },
  { key: "company", label: "公司 / 单位", input: "text" },
  { key: "metAt", label: "认识场合", input: "text", aliases: ["认识于"], placeholder: "时间 / 场合" },
];

const TEMPLATE_DEFS = FIELD_DEFS.filter((def) => def.key !== "name");

function numberInRange(minimum, maximum, label) {
  return (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
      return `${label}需为 ${minimum}-${maximum} 之间的数字`;
    }
    return null;
  };
}

function digitsOnly(label) {
  return (value) => (/^\d{5,20}$/.test(value) ? null : `${label}仅限纯数字（5-20位）`);
}

function validateIdCard(value) {
  return /^\d{17}[\dX]$/.test(value) ? null : "身份证号须为18位（前17位数字，末位可为X）";
}

function validateEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? null : "邮箱格式不正确";
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const parseListSetting = (value) => {
  const seen = new Set();
  const labels = [];
  for (const item of String(value ?? "").split(/[,，、;；\n]/)) {
    const label = item.trim();
    if (!label || seen.has(label) || label.length > 30) continue;
    seen.add(label);
    labels.push(label);
    if (labels.length >= 20) break;
  }
  return labels;
};

const resolveSetting = async (context, key, fallback) => {
  try {
    const value = await context.settings.get(key);
    return typeof value === "string" && value.trim() ? value.trim() : fallback;
  } catch {
    return fallback;
  }
};

const resolveExtraLabels = async (context) =>
  parseListSetting(await resolveSetting(context, "additional-fields", "微信,QQ,住址"));

const resolveNotebook = async (context, notebookName) => {
  const notebooks = await context.notebooks.list();
  const existing = notebooks.find((notebook) => (notebook.name ?? "").trim() === notebookName);
  if (existing) return existing;
  return context.notebooks.create({ name: notebookName });
};

const listContacts = async (context, contactTag, keyword) => {
  const request = { tags: [contactTag], sort: "updated-desc", limit: 200 };
  if (keyword && keyword.trim()) request.text = keyword.trim();
  const result = await context.notes.query(request);
  return result.notes ?? [];
};

const findFieldLineIndex = (lines, def) => {
  const labels = [def.label, ...(def.aliases ?? [])].map(escapeRegExp).join("|");
  const pattern = new RegExp(`^- (?:${labels})：`);
  return lines.findIndex((line) => pattern.test(line));
};

const parseNoteValues = (content, extraLabels) => {
  const lines = content.split("\n");
  const values = {};
  for (const def of TEMPLATE_DEFS) {
    const index = findFieldLineIndex(lines, def);
    if (index >= 0) {
      const match = lines[index].match(/：(.*)$/);
      values[def.key] = match ? match[1].trim() : "";
    } else {
      values[def.key] = "";
    }
  }
  for (const label of extraLabels) {
    const index = lines.findIndex((line) => new RegExp(`^- ${escapeRegExp(label)}：`).test(line));
    if (index >= 0) {
      const match = lines[index].match(/：(.*)$/);
      values[`x_${label}`] = match ? match[1].trim() : "";
    } else {
      values[`x_${label}`] = "";
    }
  }
  return values;
};

const parseRemark = (content) => {
  const lines = content.split("\n");
  const heading = lines.findIndex((line) => line.trim() === "## 备注");
  if (heading < 0) return "";
  const body = [];
  for (let index = heading + 1; index < lines.length; index += 1) {
    if (lines[index].trim().startsWith("## ")) break;
    body.push(lines[index]);
  }
  return body.join("\n").trim();
};

const today = () => new Date().toISOString().slice(0, 10);

const buildContactContent = (values, remark, extraLabels) => {
  const lines = ["## 基本信息", ""];
  for (const def of TEMPLATE_DEFS) lines.push(`- ${def.label}：${values[def.key] ?? ""}`);
  for (const label of extraLabels) lines.push(`- ${label}：${values[`x_${label}`] ?? ""}`);
  lines.push("", "## 备注", "");
  if (remark) lines.push(...remark.split("\n"), "");
  lines.push("## 互动记录", "", `- ${today()} 创建联系人卡片`, "");
  return lines.join("\n");
};

const buildUpdatedContent = (content, values, remark, extraLabels) => {
  const lines = content.split("\n");
  const missing = [];

  for (const def of TEMPLATE_DEFS) {
    const value = values[def.key] ?? "";
    const index = findFieldLineIndex(lines, def);
    if (index >= 0) lines[index] = `- ${def.label}：${value}`;
    else if (value) missing.push(`- ${def.label}：${value}`);
  }
  for (const label of extraLabels) {
    const value = values[`x_${label}`] ?? "";
    const index = lines.findIndex((line) => new RegExp(`^- ${escapeRegExp(label)}：`).test(line));
    if (index >= 0) lines[index] = `- ${label}：${value}`;
    else if (value) missing.push(`- ${label}：${value}`);
  }

  const remarkHeading = lines.findIndex((line) => line.trim() === "## 备注");
  if (remarkHeading >= 0) {
    let end = lines.length;
    for (let index = remarkHeading + 1; index < lines.length; index += 1) {
      if (lines[index].trim().startsWith("## ")) { end = index; break; }
    }
    lines.splice(remarkHeading + 1, end - remarkHeading - 1, ...(remark ? [...remark.split("\n"), ""] : [""]));
  }

  if (missing.length > 0) {
    const heading = lines.findIndex((line) => line.trim() === "## 基本信息");
    if (heading >= 0) {
      let insertAt = heading + 1;
      if (lines[insertAt]?.trim() === "") insertAt += 1;
      lines.splice(insertAt, 0, ...missing);
    } else {
      lines.push("", "## 基本信息", ...missing);
    }
  }

  const logLine = `- ${today()} 更新联系人信息`;
  const logHeading = lines.findIndex((line) => line.trim() === "## 互动记录");
  if (logHeading >= 0) {
    let insertAt = lines.length;
    for (let index = logHeading + 1; index < lines.length; index += 1) {
      if (lines[index].trim().startsWith("## ")) { insertAt = index; break; }
    }
    lines.splice(insertAt, 0, logLine);
  } else {
    lines.push("", "## 互动记录", logLine);
  }

  return lines.join("\n");
};

const INPUT_STYLE = "width:100%; box-sizing:border-box; padding:8px 10px; border:1px solid rgba(148,163,184,.6); border-radius:8px; font:inherit; background:transparent; color:inherit;";
const ERROR_STYLE = "color:#dc2626; font-size:12px; margin-top:3px; min-height:14px; line-height:14px;";

const buildFieldCell = (def, initialValue, wrappers) => {
  const cell = document.createElement("div");
  const label = document.createElement("label");
  label.textContent = def.label + (def.required ? " *" : "");
  label.style.cssText = "display:block; font-size:13px; font-weight:600; margin-bottom:4px; opacity:.85;";

  let input;
  const filteredInitial = def.inputFilter
    ? String(initialValue ?? "").replace(def.inputFilter, "")
    : String(initialValue ?? "");

  if (def.input === "select") {
    input = document.createElement("select");
    for (const option of ["", ...def.options]) {
      const element = document.createElement("option");
      element.value = option;
      element.textContent = option || "（未填）";
      if (option === filteredInitial) element.selected = true;
      input.append(element);
    }
  } else {
    input = document.createElement("input");
    input.type = def.input === "date" ? "date" : "text";
    input.value = filteredInitial;
    if (def.placeholder) input.placeholder = def.placeholder;
  }
  if (def.inputMode) input.setAttribute("inputmode", def.inputMode);
  input.style.cssText = INPUT_STYLE;

  const error = document.createElement("div");
  error.style.cssText = ERROR_STYLE;

  input.addEventListener("input", () => {
    if (def.inputFilter) {
      const filtered = input.value.replace(def.inputFilter, "");
      if (filtered !== input.value) input.value = filtered;
    }
    error.textContent = "";
  });

  cell.append(label, input, error);
  wrappers.set(def.key, { def, input, error });
  return cell;
};

const collectFormValues = (wrappers) => {
  const values = {};
  for (const entry of wrappers.values()) {
    let value = entry.input.value.trim();
    if (entry.def.normalize) value = entry.def.normalize(value);
    values[entry.def.key] = value;
  }
  return values;
};

const validateFormValues = (wrappers, values) => {
  let firstInvalid = null;
  for (const entry of wrappers.values()) {
    const value = values[entry.def.key] ?? "";
    let message = null;
    if (entry.def.required && !value) message = `${entry.def.label}为必填项`;
    else if (value && entry.def.validate) message = entry.def.validate(value);
    entry.error.textContent = message ?? "";
    if (message && !firstInvalid) firstInvalid = entry.input;
  }
  if (firstInvalid) {
    firstInvalid.focus();
    return false;
  }
  return true;
};

const buildContactForm = (context, options) => {
  const { mode, note, extraLabels, contactTag, notebookName, onCancel, onSaved } = options;
  const initial = mode === "edit" && note
    ? { ...parseNoteValues(note.contentMarkdown ?? "", extraLabels), name: note.title ?? "" }
    : {};
  const initialRemark = mode === "edit" && note ? parseRemark(note.contentMarkdown ?? "") : "";

  const form = document.createElement("form");
  form.style.cssText = "display:flex; flex-direction:column; gap:4px; margin:8px 0 24px; max-width:960px;";

  const heading = document.createElement("h3");
  heading.textContent = mode === "edit" ? `编辑联系人：${note?.title ?? ""}` : "新建联系人";
  heading.style.cssText = "margin:0 0 4px; font-size:17px;";
  form.append(heading);

  const grid = document.createElement("div");
  grid.style.cssText = "display:grid; grid-template-columns:repeat(auto-fill, minmax(240px, 1fr)); gap:12px 16px;";
  form.append(grid);

  const wrappers = new Map();
  for (const def of FIELD_DEFS) {
    grid.append(buildFieldCell(def, initial[def.key] ?? "", wrappers));
  }
  for (const label of extraLabels) {
    grid.append(buildFieldCell({ key: `x_${label}`, label, input: "text" }, initial[`x_${label}`] ?? "", wrappers));
  }

  const remarkLabel = document.createElement("label");
  remarkLabel.textContent = "备注";
  remarkLabel.style.cssText = "display:block; font-size:13px; font-weight:600; margin:8px 0 4px; opacity:.85;";
  const remarkInput = document.createElement("textarea");
  remarkInput.value = initialRemark;
  remarkInput.rows = 3;
  remarkInput.placeholder = "性格、喜好、注意事项等自由记录";
  remarkInput.style.cssText = `${INPUT_STYLE} resize:vertical;`;
  form.append(remarkLabel, remarkInput);

  const actions = document.createElement("div");
  actions.style.cssText = "display:flex; gap:8px; margin-top:12px;";
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.textContent = mode === "edit" ? "保存" : "创建";
  submit.style.cssText = "padding:8px 22px; border:none; border-radius:8px; background:#16a06e; color:#fff; cursor:pointer; font:inherit;";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "取消";
  cancel.style.cssText = "padding:8px 22px; border:1px solid rgba(148,163,184,.6); border-radius:8px; background:transparent; color:inherit; cursor:pointer; font:inherit;";
  cancel.addEventListener("click", onCancel);
  actions.append(submit, cancel);
  form.append(actions);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = collectFormValues(wrappers);
    if (!validateFormValues(wrappers, values)) return;
    const remark = remarkInput.value.trim();
    try {
      if (mode === "edit" && note) {
        const contentMarkdown = buildUpdatedContent(note.contentMarkdown ?? "", values, remark, extraLabels);
        const titleChanged = values.name !== note.title;
        await context.notes.update(note.id, titleChanged
          ? { title: values.name, contentMarkdown }
          : { contentMarkdown });
        context.ui.showNotice(`已保存联系人：${values.name}`);
        await onSaved(null);
      } else {
        const notebook = await resolveNotebook(context, notebookName);
        const created = await context.notes.create({
          notebookId: notebook.id,
          title: values.name,
          contentMarkdown: buildContactContent(values, remark, extraLabels),
          tags: [contactTag],
        });
        context.ui.showNotice(`已创建联系人：${values.name}`);
        await onSaved(created);
      }
    } catch (error) {
      context.ui.showNotice(`保存失败：${error instanceof Error ? error.message : String(error)}`);
    }
  });

  queueMicrotask(() => form.querySelector("input")?.focus());
  return form;
};

const buildContactRow = (note, { onOpen, onEdit }) => {
  const row = document.createElement("div");
  row.style.cssText = "display:flex; gap:8px; align-items:stretch; margin:0 0 8px;";

  const openButton = document.createElement("button");
  openButton.type = "button";
  openButton.style.cssText = [
    "flex:1",
    "min-width:0",
    "text-align:left",
    "padding:10px 14px",
    "border:1px solid rgba(148, 163, 184, 0.45)",
    "border-radius:10px",
    "background: transparent",
    "cursor: pointer",
    "font: inherit",
    "color: inherit",
  ].join(";");
  openButton.addEventListener("mouseenter", () => { openButton.style.background = "rgba(148, 163, 184, 0.15)"; });
  openButton.addEventListener("mouseleave", () => { openButton.style.background = "transparent"; });

  const title = document.createElement("div");
  title.textContent = note.title || note.excerpt || "（未命名联系人）";
  title.style.cssText = "font-weight: 600; margin-bottom: 2px;";
  const excerpt = document.createElement("div");
  excerpt.textContent = note.excerpt || "";
  excerpt.style.cssText = "font-size: 13px; opacity: 0.7; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;";
  openButton.append(title, excerpt);
  openButton.addEventListener("click", () => onOpen(note));

  const editButton = document.createElement("button");
  editButton.type = "button";
  editButton.textContent = "编辑";
  editButton.title = "通过表单编辑结构化字段";
  editButton.style.cssText = "padding:0 16px; border:1px solid rgba(148,163,184,.45); border-radius:10px; background:transparent; color:inherit; cursor:pointer; font:inherit;";
  editButton.addEventListener("click", () => onEdit(note));

  row.append(openButton, editButton);
  return row;
};

const renderRelationshipsPanel = async (context, container, shell, options) => {
  const contactTag = await resolveSetting(context, "contact-tag", "人际");
  const notebookName = await resolveSetting(context, "notebook-name", "人际关系");
  const extraLabels = await resolveExtraLabels(context);

  const state = {
    keyword: "",
    formMode: options?.startInCreateMode ? { mode: "create" } : null,
  };

  const listHost = document.createElement("div");
  listHost.style.cssText = "display: flex; flex-direction: column;";
  container.append(listHost);

  const applyChrome = (mode, count) => {
    const inForm = mode !== null;
    shell.set({
      header: {
        title: "人际关系",
        description: inForm
          ? (mode === "edit" ? "正在编辑联系人" : "新建联系人")
          : `标签「${contactTag}」下共 ${count} 位联系人`,
        actions: inForm
          ? [{ id: "back", label: "返回列表" }]
          : [
            { id: "new-contact", label: "新建联系人" },
            { id: "refresh", label: "刷新" },
          ],
      },
      toolbar: inForm ? [] : [
        { type: "search", key: "q", placeholder: "搜索联系人…", value: state.keyword },
      ],
      empty: null,
      onAction(id) {
        if (id === "back") { state.formMode = null; render(); }
        else if (id === "new-contact") { state.formMode = { mode: "create" }; render(); }
        else if (id === "refresh") { render(); }
      },
      onChange(key, value) {
        if (key === "q") { state.keyword = value; render(); }
      },
    });
  };

  const render = async () => {
    listHost.replaceChildren();
    if (state.formMode) {
      applyChrome(state.formMode.mode, 0);
      listHost.append(buildContactForm(context, {
        mode: state.formMode.mode,
        note: state.formMode.note,
        extraLabels,
        contactTag,
        notebookName,
        onCancel() {
          state.formMode = null;
          render();
        },
        async onSaved(created) {
          state.formMode = null;
          await render();
          if (created?.id) await context.ui.openNote(created.id);
        },
      }));
      return;
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
      listHost.append(buildContactRow(note, {
        onOpen: async (contact) => { await context.ui.openNote(contact.id); },
        onEdit: async (contact) => {
          try {
            const full = await context.notes.get(contact.id);
            state.formMode = { mode: "edit", note: full };
            render();
          } catch (error) {
            context.ui.showNotice(`读取笔记失败：${error instanceof Error ? error.message : String(error)}`);
          }
        },
      }));
    }
    applyChrome(null, contacts.length);
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
