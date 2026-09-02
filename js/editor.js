import { Storage } from "./storage.js?v=2";
import { exportPlanToDocx } from "./docx-export.js?v=2";

const params = new URLSearchParams(location.search);
const existingId = params.get("id");

let plan = existingId ? Storage.get(existingId) : null;
let isNew = false;
if (existingId && !plan) {
  // 带着 id 打开却找不到教案：可能是已被删除，或浏览器缓存了旧版页面。
  // 明确提示，避免用户误以为在"编辑"，保存后凭空多出一份新教案。
  alert("未找到要编辑的教案（它可能已被删除，或页面缓存了旧版本）。\n已为你打开一份新的空白教案。");
}
if (!plan) {
  plan = Storage.blankPlan();
  isNew = true;
}

const $ = (sel) => document.querySelector(sel);
const toast = $("#toast");
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove("show"), 2200);
}

/* ---------------- 基本字段绑定 ---------------- */

const basicFields = ["courseName", "courseCategory", "teacher", "teachDate", "lessonTitle", "hours", "objectives", "remarks", "homework", "summary"];

function fillFormFromPlan() {
  basicFields.forEach(key => {
    const el = document.getElementById(key);
    if (el) el.value = plan[key] ?? "";
  });
  renderReferences();
  renderContent();
  updatePageTitle();
}

function readFormIntoPlan() {
  basicFields.forEach(key => {
    const el = document.getElementById(key);
    if (el) plan[key] = el.value;
  });
  plan.references = readReferencesFromDOM();
  plan.content = readContentFromDOM();
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

/* ---------------- 教学内容大纲（多级、可排序） ---------------- */

const contentList = $("#content-list");

function renderContent() {
  contentList.innerHTML = "";
  const blocks = plan.content && plan.content.length ? plan.content : [{ level: 1, text: "" }];
  blocks.forEach(block => contentList.appendChild(buildContentRow(block)));
}

function levelLabel(level) {
  return level === 1 ? "一级" : level === 2 ? "二级" : "三级";
}

function buildContentRow(block) {
  const row = document.createElement("div");
  row.className = "outline-row";
  row.dataset.level = block.level || 1;
  row.innerHTML = `
    <div class="level-tag" title="点击切换层级">${levelLabel(block.level || 1)}</div>
    <textarea class="outline-text" rows="1" placeholder="填写这一条教学内容...">${escapeHtml(block.text || "")}</textarea>
    <div class="row-actions">
      <button type="button" class="icon-btn move-up" title="上移">↑</button>
      <button type="button" class="icon-btn move-down" title="下移">↓</button>
      <button type="button" class="icon-btn remove-row" title="删除">✕</button>
    </div>
  `;

  row.querySelector(".level-tag").addEventListener("click", () => {
    const cur = Number(row.dataset.level) || 1;
    const next = cur >= 3 ? 1 : cur + 1;
    row.dataset.level = next;
    row.querySelector(".level-tag").textContent = levelLabel(next);
  });

  row.querySelector(".move-up").addEventListener("click", () => {
    const prev = row.previousElementSibling;
    if (prev) contentList.insertBefore(row, prev);
  });
  row.querySelector(".move-down").addEventListener("click", () => {
    const next = row.nextElementSibling;
    if (next) contentList.insertBefore(next, row);
  });
  row.querySelector(".remove-row").addEventListener("click", () => {
    if (contentList.children.length > 1) {
      row.remove();
    } else {
      row.querySelector(".outline-text").value = "";
    }
  });

  // 自适应高度
  const ta = row.querySelector(".outline-text");
  autoGrow(ta);
  ta.addEventListener("input", () => autoGrow(ta));

  return row;
}

function autoGrow(ta) {
  ta.style.height = "auto";
  ta.style.height = (ta.scrollHeight) + "px";
}

$("#add-content-btn").addEventListener("click", () => {
  contentList.appendChild(buildContentRow({ level: 1, text: "" }));
});

function readContentFromDOM() {
  return [...contentList.querySelectorAll(".outline-row")]
    .map(row => ({
      level: Number(row.dataset.level) || 1,
      text: row.querySelector(".outline-text").value.trim()
    }))
    .filter(b => b.text);
}

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
  Storage.save(plan);
  isNew = false;
  dirty = false;
  const url = new URL(location.href);
  url.searchParams.set("id", plan.id);
  history.replaceState(null, "", url);
  $("#save-status").textContent = "已保存 · " + new Date().toLocaleTimeString("zh-CN");
  updatePageTitle();
  showToast("教案已保存");
});

$("#delete-btn").addEventListener("click", () => {
  if (isNew) {
    location.href = "index.html";
    return;
  }
  if (confirm("确定要删除这份教案吗？此操作无法撤销。")) {
    Storage.remove(plan.id);
    location.href = "index.html";
  }
});

/* ---------------- 导出 PDF（浏览器打印） ---------------- */

$("#export-pdf-btn").addEventListener("click", () => {
  readFormIntoPlan();
  buildPrintView(plan);
  window.print();
});

/** 把 yyyy-mm-dd 格式化为「yyyy 年 m 月 d 日」，无法解析时原样返回 */
function fmtCnDate(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d)) return iso;
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

/** 多级内容 → 中文层级编号（一级「一、」二级「1.」三级「（1）」），高一级出现时低一级序号归零 */
function buildOutlineHtml(blocks) {
  const CN = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二", "十三", "十四", "十五"];
  let c1 = 0, c2 = 0, c3 = 0;
  const html = (blocks || []).filter(b => b.text).map(b => {
    const t = escapeHtml(b.text);
    if (b.level === 2) { c2++; c3 = 0; return `<div class="lvl-2">${c2}. ${t}</div>`; }
    if (b.level === 3) { c3++; return `<div class="lvl-3">（${c3}）${t}</div>`; }
    c1++; c2 = 0; c3 = 0;
    return `<div class="lvl-1">${CN[c1 - 1] || c1}、${t}</div>`;
  }).join("");
  return html || '<div class="lvl-1">（暂无内容）</div>';
}

function buildPrintView(p) {
  const root = $("#print-root");
  const refRows = (p.references || []).filter(r => r.label || r.url);
  const refHtml = refRows
    .map(r => `${escapeHtml(r.label || "资料")}${r.url ? "：" + escapeHtml(r.url) : ""}`)
    .join("<br/>");

  root.innerHTML = `
    <h1 class="doc-title">授&nbsp;课&nbsp;教&nbsp;案</h1>

    <table class="doc-table doc-info">
      <tr>
        <th>课程名称</th><td>${escapeHtml(p.courseName)}</td>
        <th>课程类别</th><td>${escapeHtml(p.courseCategory)}</td>
      </tr>
      <tr>
        <th>任课教师</th><td>${escapeHtml(p.teacher)}</td>
        <th>任课时间</th><td>${escapeHtml(fmtCnDate(p.teachDate))}</td>
      </tr>
      <tr><th>课&emsp;题</th><td colspan="3">${escapeHtml(p.lessonTitle)}</td></tr>
      <tr><th>学&emsp;时</th><td colspan="3">${p.hours ? escapeHtml(String(p.hours)) + " 学时" : ""}</td></tr>
      <tr><th>教学目标<br/>与要求</th><td colspan="3" class="doc-multiline">${nl2br(p.objectives)}</td></tr>
      <tr><th>参考资料</th><td colspan="3" class="doc-multiline">${refHtml}</td></tr>
    </table>

    <table class="doc-table">
      <tr>
        <th>教学内容<br/>及过程</th>
        <td colspan="3">${buildOutlineHtml(p.content)}</td>
      </tr>
      ${p.remarks && p.remarks.trim() ? `<tr><th>备&emsp;注</th><td colspan="3" class="doc-multiline">${nl2br(p.remarks)}</td></tr>` : ""}
    </table>

    <table class="doc-table">
      <tr><th>作业布置</th><td colspan="3" class="doc-multiline">${nl2br(p.homework)}</td></tr>
      <tr><th>课后小结</th><td colspan="3" class="doc-multiline">${nl2br(p.summary)}</td></tr>
    </table>

    <div class="doc-sign">
      <span>教师签名：＿＿＿＿＿＿＿</span>
      <span>日期：＿＿＿＿＿＿＿</span>
    </div>
  `;
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
