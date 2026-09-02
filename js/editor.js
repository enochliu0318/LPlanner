import { Storage } from "./storage.js?v=10";
import { exportPlanToDocx } from "./docx-export.js?v=10";
import { exportPlanToPdf } from "./pdf-export.js?v=10";
import { Tabs, NEW_TAB, renderRailTabs } from "./tabs.js?v=10";
import { buildDocumentModel } from "./document-model.js?v=10";

const params = new URLSearchParams(location.search);
const existingId = params.get("id");

let plan = existingId ? Storage.get(existingId) : null;
let isNew = false;
if (existingId && !plan) {
  // 带着 id 打开却找不到教案：可能是已被删除，或浏览器缓存了旧版页面。
  // 明确提示，避免用户误以为在"编辑"，保存后凭空多出一份新教案。
  alert("未找到要编辑的教案（它可能已被删除，或页面缓存了旧版本）。已为你打开一份新的空白教案。");
}
if (!plan) {
  plan = Storage.blankPlan();
  isNew = true;
}

// 左栏标签页：进入编辑页即注册为"已打开"，可随时从左栏切回
const tabId = isNew ? NEW_TAB : plan.id;
Tabs.open(tabId);
Tabs.setActive(tabId);

const $ = (sel) => document.querySelector(sel);
const toast = $("#toast");
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove("show"), 2200);
}

/* ---------------- 基本字段绑定 ---------------- */

const basicFields = ["courseName", "courseCategory", "teacher", "teachDate", "lessonTitle", "hours", "objectives", "keyPoints", "difficultPoints", "methods", "remarks", "homework", "summary"];

function fillFormFromPlan() {
  basicFields.forEach(key => {
    const el = document.getElementById(key);
    if (el) el.value = plan[key] ?? "";
  });
  renderReferences();
  fillContentEditor();
  updatePageTitle();
}

function readFormIntoPlan() {
  basicFields.forEach(key => {
    const el = document.getElementById(key);
    if (el) plan[key] = el.value;
  });
  plan.references = readReferencesFromDOM();
  readContentEditor();
}

function updatePageTitle() {
  const prefix = isNew ? "新建教案" : "编辑教案";
  $("#page-title").textContent = plan.lessonTitle ? `${prefix} · ${plan.lessonTitle}` : prefix;
  document.title = (plan.lessonTitle || prefix) + " · 备课本";
}

/* ---------------- 参考资料（重复行） ---------------- */

const refList = $("#references-list");

function renderReferences() {
  refList.innerHTML = "";
  (plan.references || []).forEach((ref, i) => refList.appendChild(buildReferenceRow(ref, i)));
}

function buildReferenceRow(ref, i) {
  const row = document.createElement("div");
  row.className = "repeat-row";
  row.dataset.index = i;
  row.innerHTML = `
    <input type="text" class="ref-label" placeholder="标签，如 PPT" value="${escapeAttr(ref.label || "")}" />
    <input type="url" class="ref-url" placeholder="https://..." value="${escapeAttr(ref.url || "")}" />
    <button type="button" class="icon-btn ref-remove" title="删除">✕</button>
  `;
  row.querySelector(".ref-remove").addEventListener("click", () => {
    row.remove();
  });
  return row;
}

$("#add-reference-btn").addEventListener("click", () => {
  refList.appendChild(buildReferenceRow({ label: "", url: "" }, refList.children.length));
});

function readReferencesFromDOM() {
  return [...refList.querySelectorAll(".repeat-row")]
    .map(row => ({
      label: row.querySelector(".ref-label").value.trim(),
      url: row.querySelector(".ref-url").value.trim()
    }))
    .filter(r => r.label || r.url);
}

/* ---------------- 教学内容及过程（Word 式富文本编辑） ---------------- */

const contentEditor = $("#content-editor");

/** 旧版行级数据 [{level, text}] → 嵌套 <ul> HTML（兼容历史教案） */
function legacyToHtml(blocks) {
  if (!blocks || !blocks.length) return "";
  const parts = [];
  let depth = 0, liOpen = false;
  blocks.filter(b => b.text).forEach(b => {
    const lv = Math.min(Math.max(b.level || 1, 1), 3);
    while (depth < lv) { parts.push("<ul>"); depth++; liOpen = false; }
    while (depth > lv) { parts.push("</li></ul>"); depth--; liOpen = true; }
    parts.push((liOpen ? "</li><li>" : "<li>") + escapeHtml(b.text));
    liOpen = true;
  });
  while (depth > 0) { parts.push(liOpen ? "</li></ul>" : "</ul>"); depth--; liOpen = false; }
  if (liOpen) parts.push("</li>");
  return parts.join("");
}

/** 页面加载时把编辑内容填入富文本窗口 */
function fillContentEditor() {
  // 兼容旧数据：没有 contentHtml 时从旧的行级数据转换
  if (!plan.contentHtml) plan.contentHtml = legacyToHtml(plan.content);
  contentEditor.innerHTML = plan.contentHtml || "";
}

/** 读取富文本窗口内容（空内容归一化为空字符串） */
function readContentEditor() {
  const raw = contentEditor.innerHTML.trim();
  plan.contentHtml = (raw === "" || raw === "<br>" || raw === "<div><br></div>") ? "" : contentEditor.innerHTML;
}

// 工具栏：mousedown 阻止编辑器失焦，保持选区
document.querySelectorAll("#rich-toolbar [data-cmd]").forEach(btn => {
  btn.addEventListener("mousedown", e => e.preventDefault());
  btn.addEventListener("click", () => {
    contentEditor.focus();
    document.execCommand(btn.dataset.cmd, false, btn.dataset.value || null);
  });
});

// Word 式快捷键：Tab 降级 / Shift+Tab 升级
contentEditor.addEventListener("keydown", (e) => {
  if (e.key === "Tab") {
    e.preventDefault();
    document.execCommand(e.shiftKey ? "outdent" : "indent");
  }
});

// 粘贴外部内容时清理为纯文本，避免带入奇怪的样式
contentEditor.addEventListener("paste", (e) => {
  e.preventDefault();
  const text = (e.clipboardData || window.clipboardData).getData("text/plain");
  document.execCommand("insertText", false, text);
});

/* ---------------- 未保存更改提醒 ---------------- */

let dirty = false;
$("#plan-form").addEventListener("input", () => { dirty = true; });
window.addEventListener("beforeunload", (e) => {
  if (dirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});

/* ---------------- 保存 / 删除 ---------------- */

$("#save-btn").addEventListener("click", () => {
  readFormIntoPlan();
  if (!plan.lessonTitle.trim()) {
    alert("请至少填写“课题”后再保存。");
    return;
  }
  const wasNew = isNew;
  Storage.save(plan);
  isNew = false;
  dirty = false;
  const url = new URL(location.href);
  url.searchParams.set("id", plan.id);
  history.replaceState(null, "", url);
  // 标签页同步：新教案保存后把「新建」占位标签换成真实教案
  if (wasNew) Tabs.replace(NEW_TAB, plan.id);
  Tabs.setActive(plan.id);
  renderRailTabs($("#rail-tabs"), { activeId: plan.id });
  $("#save-status").textContent = "已保存 · " + new Date().toLocaleTimeString("zh-CN");
  updatePageTitle();
  showToast("教案已保存");
});

$("#delete-btn").addEventListener("click", () => {
  if (isNew) {
    Tabs.close(NEW_TAB);
    location.href = "index.html";
    return;
  }
  if (confirm("确定要删除这份教案吗？此操作无法撤销。")) {
    Storage.remove(plan.id);
    Tabs.close(plan.id);
    location.href = "index.html";
  }
});

/* ---------------- 导出 PDF（浏览器打印） ---------------- */

$("#export-pdf-btn").addEventListener("click", async () => {
  readFormIntoPlan();
  try {
    await exportPlanToPdf(plan, buildPrintHtml);
  } catch (err) {
    console.error(err);
    alert("导出 PDF 失败，请检查网络是否可以访问 PDF 组件（首次导出需要联网加载一次）。");
  }
});

/** 生成打印视图的 HTML 字符串（供 PDF 导出和浏览器打印共用） */
function buildPrintHtml(p) {
  const doc = buildDocumentModel(p);

  const infoHtml = doc.info.map(i =>
    `<p><span class="doc-label">${escapeHtml(i.label)}</span><span class="doc-value">${escapeHtml(i.value)}</span></p>`
  ).join("");

  const formatLabel = (label) => {
    const map = { "课题": "课&emsp;题", "学时": "学&emsp;时", "重点": "重&emsp;点", "难点": "难&emsp;点" };
    return map[label] || escapeHtml(label);
  };
  const lessonRowsHtml = doc.lessonPlanRows.map(r =>
    `<tr><th>${formatLabel(r.label)}</th><td class="doc-multiline">${nl2br(r.value)}</td></tr>`
  ).join("");

  const homeworkHtml = doc.homework.map(l =>
    `<div class="doc-bullet">• ${escapeHtml(l)}</div>`
  ).join("");

  return `
    <h1 class="doc-title">授&nbsp;课&nbsp;教&nbsp;案</h1>
    <div class="doc-info">${infoHtml}</div>
    <div class="doc-banner">●&ensp;${escapeHtml(doc.lessonPlanBanner)}</div>
    <table class="doc-table">${lessonRowsHtml}</table>
    <div class="doc-banner page-break">●&ensp;${escapeHtml(doc.lectureBanner)}</div>
    <table class="doc-table doc-process">
      <tr><th class="doc-process-head">教学内容及过程</th><th class="doc-process-remarks-head">备注</th></tr>
      <tr>
        <td class="doc-process-content doc-multiline">${doc.contentNumberedHtml}</td>
        <td class="doc-process-remarks doc-multiline">${nl2br(doc.remarks)}</td>
      </tr>
      <tr><td class="doc-row-label">作业布置</td><td class="doc-process-remarks"></td></tr>
      <tr><td class="doc-multiline">${homeworkHtml}</td><td class="doc-process-remarks"></td></tr>
      <tr><td class="doc-row-label">课后小结</td><td class="doc-process-remarks"></td></tr>
      <tr><td class="doc-tall doc-multiline">${nl2br(doc.summary)}</td><td class="doc-process-remarks"></td></tr>
    </table>
  `;
}

function buildPrintView(p) {
  $("#print-root").innerHTML = buildPrintHtml(p);
}

/* ---------------- 导出 Word ---------------- */

$("#export-docx-btn").addEventListener("click", async () => {
  readFormIntoPlan();
  try {
    await exportPlanToDocx(plan);
  } catch (err) {
    console.error(err);
    alert("导出 Word 失败，请检查网络是否可以访问 docx 组件（首次导出需要联网加载一次）。");
  }
});

/* ---------------- 工具函数 ---------------- */

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
function nl2br(s) { return escapeHtml(s).replace(/\n/g, "<br/>"); }

/* ---------------- 初始化 ---------------- */

fillFormFromPlan();
renderRailTabs($("#rail-tabs"), { activeId: tabId });
