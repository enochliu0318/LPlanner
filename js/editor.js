import { Storage } from "./storage.js?v=70";
import { exportPlanToDocx } from "./docx-export.js?v=70";
import { exportPlanToPdf } from "./pdf-export.js?v=70";
import { Tabs, NEW_TAB, renderRailTabs } from "./tabs.js?v=70";
import { buildDocumentModel } from "./document-model.js?v=70";
import { sendMessage, getAiConfig, saveAiConfig } from "./ai.js?v=70";
import { onStatus as onFsStatus, getFolderName } from "./fs-sync.js?v=70";

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
    <button type="button" class="icon-btn ref-open" title="打开链接" aria-label="打开链接" disabled>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg>
    </button>
    <button type="button" class="icon-btn ref-remove" title="删除">✕</button>
  `;
  row.querySelector(".ref-remove").addEventListener("click", () => {
    row.remove();
  });

  // 打开链接：新标签页跳转到该网页
  const urlInput = row.querySelector(".ref-url");
  const openBtn = row.querySelector(".ref-open");
  const updateOpenBtn = () => { openBtn.disabled = !urlInput.value.trim(); };
  urlInput.addEventListener("input", updateOpenBtn);
  updateOpenBtn();
  openBtn.addEventListener("click", () => {
    let url = urlInput.value.trim();
    if (!url) return;
    // 没写协议时默认按 https 处理
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)) url = "https://" + url;
    window.open(url, "_blank", "noopener");
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

/* ---------------- 自动保存 + 状态显示 ---------------- */

let dirty = false;
let autoSaveTimer = null;

function updateSaveStatus(status) {
  const el = $("#save-status");
  el.setAttribute("data-status", status);
  if (status === "saved") {
    el.textContent = "已保存 · " + new Date().toLocaleTimeString("zh-CN");
    el.style.color = "#2a7d4a";
  } else if (status === "unsaved") {
    el.textContent = "未保存";
    el.style.color = "#ac3b2a";
  } else if (status === "saving") {
    el.textContent = "保存中...";
    el.style.color = "#2a5d8c";
  }
}

function autoSave() {
  if (!dirty) return;
  readFormIntoPlan();
  if (!plan.lessonTitle.trim()) return;
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    doSave(false);
  }, 800);
}

$("#plan-form").addEventListener("input", () => {
  dirty = true;
  updateSaveStatus("unsaved");
  autoSave();
});

window.addEventListener("beforeunload", (e) => {
  if (dirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});

/* ---------------- 保存 / 删除 ---------------- */

function doSave(showToastFlag) {
  readFormIntoPlan();
  if (!plan.lessonTitle.trim()) {
    alert("请至少填写”课题“后再保存。");
    return false;
  }
  const wasNew = isNew;
  updateSaveStatus("saving");
  Storage.save(plan);
  isNew = false;
  dirty = false;
  const url = new URL(location.href);
  url.searchParams.set("id", plan.id);
  history.replaceState(null, "", url);
  if (wasNew) Tabs.replace(NEW_TAB, plan.id);
  Tabs.setActive(plan.id);
  renderRailTabs($("#rail-tabs"), { activeId: plan.id });
  updateSaveStatus("saved");
  updatePageTitle();
  if (showToastFlag) showToast("教案已保存");
  return true;
}

$("#save-btn").addEventListener("click", () => {
  clearTimeout(autoSaveTimer);
  doSave(true);
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
    alert("导出 PDF 失败，请重试。");
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

/* ---------------- 导出备份（当前教案 JSON） ---------------- */

$("#export-backup-btn").addEventListener("click", () => {
  readFormIntoPlan();
  const payload = JSON.stringify({ exportedAt: new Date().toISOString(), plans: [plan] }, null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  const safeTitle = (plan.lessonTitle || "未命名教案").replace(/[\\/:*?"<>|]/g, "_");
  a.href = url;
  a.download = `lesson-plan-${safeTitle}-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast("备份文件已下载");
});

/* ---------------- AI Chat ---------------- */

let aiChatOpen = false;
let aiIsLoading = false;
let aiHistory = [];

// Toggle chat window
$("#ai-fab").addEventListener("click", () => {
  aiChatOpen = !aiChatOpen;
  $("#ai-chat").style.display = aiChatOpen ? "flex" : "none";
  if (aiChatOpen) $("#ai-input").focus();
});

$("#ai-chat-close").addEventListener("click", () => {
  aiChatOpen = false;
  $("#ai-chat").style.display = "none";
});

/* ---------- AI 窗口拖动 & 缩放（位置/大小持久化） ---------- */

const AI_CHAT_RECT_KEY = "lesson_planner_ai_chat_v1";
const aiChatEl = $("#ai-chat");
const aiChatHeader = $(".ai-chat-header");
const aiChatGrip = $("#ai-chat-resize");
let aiChatDrag = null;

function saveAiChatRect() {
  try {
    localStorage.setItem(AI_CHAT_RECT_KEY, JSON.stringify({
      left: aiChatEl.style.left,
      top: aiChatEl.style.top,
      width: aiChatEl.style.width,
      height: aiChatEl.style.height,
    }));
  } catch (err) { /* 存储不可用时忽略 */ }
}

function restoreAiChatRect() {
  try {
    const raw = localStorage.getItem(AI_CHAT_RECT_KEY);
    if (!raw) return;
    const rect = JSON.parse(raw);
    if (rect.left) {
      aiChatEl.style.left = rect.left;
      aiChatEl.style.top = rect.top;
      aiChatEl.style.right = "auto";
      aiChatEl.style.bottom = "auto";
    }
    if (rect.width) aiChatEl.style.width = rect.width;
    if (rect.height) {
      aiChatEl.style.height = rect.height;
      aiChatEl.classList.add("ai-chat-resized");
    }
  } catch (err) { /* 数据损坏时忽略 */ }
}

// 小屏/触屏设备禁用拖动缩放（CSS 已把窗口改为全屏面板）
const aiDragDisabled = () => window.matchMedia("(max-width: 600px)").matches;

// 按住标题栏拖动窗口位置
aiChatHeader.addEventListener("mousedown", (e) => {
  if (aiDragDisabled()) return;
  if (e.target.closest(".ai-chat-tool")) return; // 点工具按钮不触发拖动
  const rect = aiChatEl.getBoundingClientRect();
  aiChatDrag = {
    type: "move",
    startX: e.clientX, startY: e.clientY,
    origLeft: rect.left, origTop: rect.top,
    origW: rect.width, origH: rect.height,
  };
  document.body.style.userSelect = "none";
  e.preventDefault();
});

// 左下角把手调整窗口大小（向左拖变宽，向下拖变高）
aiChatGrip.addEventListener("mousedown", (e) => {
  if (aiDragDisabled()) return;
  const rect = aiChatEl.getBoundingClientRect();
  aiChatDrag = {
    type: "resize",
    startX: e.clientX, startY: e.clientY,
    origLeft: rect.left, origTop: rect.top,
    origW: rect.width, origH: rect.height,
  };
  aiChatEl.classList.add("ai-chat-resized");
  document.body.style.userSelect = "none";
  e.preventDefault();
  e.stopPropagation();
});

window.addEventListener("mousemove", (e) => {
  if (!aiChatDrag) return;
  const dx = e.clientX - aiChatDrag.startX;
  const dy = e.clientY - aiChatDrag.startY;
  if (aiChatDrag.type === "move") {
    // 限制在视口内：至少露出 120px 宽度，标题栏不拖出顶部
    const minLeft = -(aiChatDrag.origW - 120);
    const maxLeft = window.innerWidth - 120;
    const minTop = 0;
    const maxTop = window.innerHeight - 48;
    const left = Math.min(Math.max(aiChatDrag.origLeft + dx, minLeft), maxLeft);
    const top = Math.min(Math.max(aiChatDrag.origTop + dy, minTop), maxTop);
    aiChatEl.style.left = Math.round(left) + "px";
    aiChatEl.style.top = Math.round(top) + "px";
    aiChatEl.style.right = "auto";
    aiChatEl.style.bottom = "auto";
  } else {
    // 锁定右边缘，让左边缘跟随鼠标（把手在左下角）
    const rightEdge = aiChatDrag.origLeft + aiChatDrag.origW;
    const newW = Math.min(Math.max(aiChatDrag.origW - dx, 300), window.innerWidth * 0.92);
    aiChatEl.style.width = Math.round(newW) + "px";
    aiChatEl.style.left = Math.round(rightEdge - newW) + "px";
    aiChatEl.style.right = "auto";
    aiChatEl.style.height = Math.min(Math.max(aiChatDrag.origH + dy, 320), window.innerHeight * 0.92) + "px";
  }
});

window.addEventListener("mouseup", () => {
  if (!aiChatDrag) return;
  aiChatDrag = null;
  document.body.style.userSelect = "";
  saveAiChatRect();
});

restoreAiChatRect();

// Add message to chat（带一键复制）
const COPY_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const CHECK_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
const X_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>';
const EDIT_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>';

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    // 剪贴板 API 不可用（如非安全上下文）时的降级方案
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch (e) {
      return false;
    }
  }
}

function addMessage(role, content, historyEntry = null) {
  const messages = $("#ai-messages");
  // 外层行容器：气泡 + 悬停时显示在气泡下方的操作按钮
  const row = document.createElement("div");
  row.className = "ai-message-row ai-message-row-" + role;

  const msg = document.createElement("div");
  msg.className = "ai-message ai-message-" + role;
  const contentDiv = document.createElement("div");
  contentDiv.className = "ai-message-content";
  contentDiv.textContent = content;
  msg.appendChild(contentDiv);
  row.appendChild(msg);

  // 悬停时显示的操作按钮：复制（输入/输出都有）+ 编辑（仅自己发送的消息）
  if (role === "user" || role === "ai") {
    const actions = document.createElement("div");
    actions.className = "ai-message-actions";

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "ai-msg-btn";
    copyBtn.title = "复制内容";
    copyBtn.innerHTML = COPY_ICON_SVG;
    copyBtn.addEventListener("click", async () => {
      const ok = await copyText(contentDiv.textContent);
      copyBtn.innerHTML = ok ? CHECK_ICON_SVG : X_ICON_SVG;
      copyBtn.title = ok ? "已复制" : "复制失败";
      setTimeout(() => {
        copyBtn.innerHTML = COPY_ICON_SVG;
        copyBtn.title = "复制内容";
      }, 1500);
    });
    actions.appendChild(copyBtn);

    if (role === "user") {
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "ai-msg-btn";
      editBtn.title = "编辑消息";
      editBtn.innerHTML = EDIT_ICON_SVG;
      editBtn.addEventListener("click", () =>
        startEditMessage(msg, contentDiv, historyEntry, actions));
      actions.appendChild(editBtn);
    }

    row.appendChild(actions);
  }

  messages.appendChild(row);
  messages.scrollTop = messages.scrollHeight;
  return row;
}

/* ---------- 编辑已发送的消息 ---------- */

function startEditMessage(msgEl, contentDiv, historyEntry, actions) {
  if (msgEl.querySelector(".ai-edit-area")) return; // 已在编辑中
  actions.style.display = "none";
  const original = contentDiv.textContent;
  contentDiv.style.display = "none";

  const editArea = document.createElement("div");
  editArea.className = "ai-edit-area";

  const ta = document.createElement("textarea");
  ta.value = original;
  ta.rows = Math.min(10, Math.max(2, original.split("\n").length + 1));

  const btns = document.createElement("div");
  btns.className = "ai-edit-btns";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "ai-edit-cancel";
  cancelBtn.textContent = "取消";

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "ai-edit-save";
  saveBtn.textContent = "保存";
  saveBtn.disabled = !original.trim();

  ta.addEventListener("input", () => { saveBtn.disabled = !ta.value.trim(); });

  const restore = () => {
    editArea.remove();
    contentDiv.style.display = "";
    actions.style.display = "";
  };

  cancelBtn.addEventListener("click", restore);
  saveBtn.addEventListener("click", () => {
    const newText = ta.value.trim();
    if (!newText) return;
    contentDiv.textContent = newText;
    // 同步更新会话历史，后续对话基于修改后的内容
    if (historyEntry) historyEntry.content = newText;
    restore();
  });

  btns.appendChild(cancelBtn);
  btns.appendChild(saveBtn);
  editArea.appendChild(ta);
  editArea.appendChild(btns);
  msgEl.appendChild(editArea);
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
}

// Show typing indicator
function showTyping() {
  const messages = $("#ai-messages");
  const msg = document.createElement("div");
  msg.className = "ai-message ai-message-ai";
  msg.id = "ai-typing";
  const typing = document.createElement("div");
  typing.className = "ai-typing";
  typing.innerHTML = '<span class="ai-typing-dot"></span><span class="ai-typing-dot"></span><span class="ai-typing-dot"></span>';
  msg.appendChild(typing);
  messages.appendChild(msg);
  messages.scrollTop = messages.scrollHeight;
}

function hideTyping() {
  const typing = $("#ai-typing");
  if (typing) typing.remove();
}

// Send message
async function sendAiMessage() {
  if (aiIsLoading) return;
  const input = $("#ai-input").value.trim();
  if (!input) return;

  $("#ai-input").value = "";
  const userEntry = { role: "user", content: input };
  aiHistory.push(userEntry);
  addMessage("user", input, userEntry);
  showTyping();
  aiIsLoading = true;

  try {
    const result = await sendMessage(input, aiHistory.slice(0, -1));
    const aiEntry = { role: "assistant", content: result };
    aiHistory.push(aiEntry);
    hideTyping();
    addMessage("ai", result, aiEntry);
  } catch (err) {
    hideTyping();
    addMessage("error", "Error: " + err.message);
  } finally {
    aiIsLoading = false;
  }
}

$("#ai-send").addEventListener("click", sendAiMessage);
$("#ai-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendAiMessage();
  }
});

// AI Settings modal
function openAiSettings() {
  const config = getAiConfig();
  $(`#ai-api-key`).value = config.apiKey || "";
  $(`#ai-model-custom`).value = config.model || "";
  $(`#ai-modal`).style.display = "flex";
}

function closeAiSettings() {
  $("#ai-modal").style.display = "none";
}

$("#ai-chat-settings").addEventListener("click", openAiSettings);
$("#ai-modal-backdrop").addEventListener("click", closeAiSettings);
$("#ai-cancel-settings").addEventListener("click", closeAiSettings);
$("#ai-save-settings").addEventListener("click", () => {
  const model = $("#ai-model-custom").value.trim() || "qwen3.8-27b";
  const apiKey = $("#ai-api-key").value.trim();
  saveAiConfig({ model, apiKey });
  closeAiSettings();
  showToast("AI settings saved");
});

// Test connection
$("#ai-test-btn").addEventListener("click", async () => {
  const result = $("#ai-test-result");
  const btn = $("#ai-test-btn");
  result.textContent = "Testing...";
  result.className = "ai-test-result";
  btn.disabled = true;

  try {
    const config = {
      model: $("#ai-model-custom").value.trim() || "qwen3.8-27b",
      apiKey: $("#ai-api-key").value.trim(),
    };
    const headers = { "Content-Type": "application/json" };
    if (config.apiKey) headers["Authorization"] = "Bearer " + config.apiKey;

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: "user", content: "Hello" }],
        max_tokens: 10,
      }),
    });

    if (response.ok) {
      result.textContent = "Success!";
      result.className = "ai-test-result success";
    } else {
      const err = await response.json().catch(() => ({}));
      result.textContent = "Failed: " + (err.error?.message || response.status);
      result.className = "ai-test-result error";
    }
  } catch (err) {
    result.textContent = "Failed: " + err.message;
    result.className = "ai-test-result error";
  } finally {
    btn.disabled = false;
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
