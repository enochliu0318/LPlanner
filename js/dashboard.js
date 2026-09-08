import { Storage } from "./storage.js?v=39";
import { renderRailTabs } from "./tabs.js?v=39";
import { isSupported as isFsSupported, connect as connectFs, disconnect as disconnectFs, onStatus as onFsStatus, getStatus as getFsStatus, openInExplorer, getFolderName } from "./fs-sync.js?v=39";

const grid = document.getElementById("card-grid");
const emptyState = document.getElementById("empty-state");
const searchInput = document.getElementById("search-input");
const toast = document.getElementById("toast");
const fileInput = document.getElementById("import-file-input");
const sidebar = document.getElementById("explorer-sidebar");
const breadcrumb = document.getElementById("breadcrumb");
const moveModal = document.getElementById("move-modal");

// 当前选中的文件夹：null = 全部；"NONE" = 未分类；其他值 = 文件夹 id
let currentFolder = null;
let movePlanId = null;

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove("show"), 2200);
}

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function render(keyword = "") {
  const all = Storage.list();
  const kw = keyword.trim().toLowerCase();
  const inFolder = p =>
    currentFolder === null ? !p.folderId :
    currentFolder === "NONE" ? !p.folderId :
    p.folderId === currentFolder;
  const list = all
    .filter(inFolder)
    .filter(p =>
      kw
        ? [p.courseName, p.lessonTitle, p.teacher, p.courseCategory]
            .filter(Boolean)
            .some(v => v.toLowerCase().includes(kw))
        : true
    );

  // 左栏标签页（在列表页不高亮任何标签）
  renderRailTabs(document.getElementById("rail-tabs"), { activeId: null });

  renderSidebar();
  renderBreadcrumb();
  grid.innerHTML = "";

  // 根目录：始终显示顶层文件夹（即使没有教案）
  if (currentFolder === null) {
    Storage.listFolders().filter(f => !f.parentId).forEach(f => grid.appendChild(buildFolderTile(f)));
  } else if (currentFolder !== "NONE") {
    Storage.listFolders().filter(f => f.parentId === currentFolder).forEach(f => grid.appendChild(buildFolderTile(f)));
  }

  if (all.length === 0 && list.length === 0 && Storage.listFolders().length === 0) {
    emptyState.style.display = "block";
    grid.style.display = "none";
    return;
  }
  emptyState.style.display = "none";
  grid.style.display = "grid";

  if (list.length === 0) {
    const msg = kw
      ? `没有找到匹配"${escapeHtml(keyword)}"的教案。`
      : "此处暂无教案，可把教案卡片拖到左侧文件夹，或在卡片上点「移动」。";
    const emptyMsg = document.createElement("p");
    emptyMsg.style.color = "var(--ink-faint)";
    emptyMsg.style.gridColumn = "1 / -1";
    emptyMsg.style.textAlign = "center";
    emptyMsg.style.padding = "40px 0";
    emptyMsg.textContent = msg;
    grid.appendChild(emptyMsg);
    return;
  }

  list.forEach(plan => {
    const card = document.createElement("div");
    card.className = "plan-card";
    card.draggable = true;
    card.innerHTML = `
      <div class="plan-course">${escapeHtml(plan.courseName || "未分类课程")}${plan.courseCategory ? " · " + escapeHtml(plan.courseCategory) : ""}</div>
      <h3>${escapeHtml(plan.lessonTitle || "（未命名课题）")}</h3>
      <div class="plan-meta plan-meta-lines">
        <span>教师：${escapeHtml(plan.teacher || "—")}</span>
        <span>上课时间：${escapeHtml(plan.teachDate || "—")}</span>
        <span>学时：${escapeHtml(String(plan.hours || "1"))}</span>
      </div>
      <div class="plan-meta" style="color:var(--ink-faint)">更新于 ${fmtDate(plan.updatedAt)}</div>
      <div class="plan-actions">
        <a class="btn btn-sm btn-primary" href="editor.html?id=${encodeURIComponent(plan.id)}">编辑</a>
        <button class="btn btn-sm" data-act="dup" data-id="${plan.id}">复制</button>
        <button class="btn btn-sm" data-act="move" data-id="${plan.id}">移动</button>
        <button class="btn btn-sm btn-ghost btn-danger" data-act="del" data-id="${plan.id}">删除</button>
      </div>
    `;
    // 点击卡片任意位置 → 直接进入该教案的编辑页（按钮区域除外）
    card.addEventListener("click", (e) => {
      if (e.target.closest(".plan-actions")) return;
      location.href = "editor.html?id=" + encodeURIComponent(plan.id);
    });
    // 拖拽：把教案拖到文件夹（主区大图标或左侧栏）即可移动
    card.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plan-id", plan.id);
      e.dataTransfer.effectAllowed = "move";
      card.classList.add("dragging");
    });
    card.addEventListener("dragend", () => card.classList.remove("dragging"));
    grid.appendChild(card);
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------------- 资源管理器：侧栏 / 面包屑 / 文件夹图标 ---------------- */

function navigate(target) {
  // target: "root" | "NONE" | 文件夹 id
  currentFolder = target === "root" ? null : target;
  render(searchInput.value);
}

function renderSidebar() {
  const folders = Storage.listFolders();
  const plans = Storage.list();
  // 计数包含子文件夹中的教案
  const countIn = fid => {
    let n = plans.filter(p => p.folderId === fid).length;
    folders.filter(f => f.parentId === fid).forEach(c => { n += countIn(c.id); });
    return n;
  };
  const unclassified = plans.filter(p => !p.folderId).length;

  let html =
    `<button class="xsidebar-item ${currentFolder === null ? "active" : ""}" data-target="root" title="全部内容">🏠 全部内容 <span class="xcount">${plans.length}</span></button>` +
    `<button class="xsidebar-item ${currentFolder === "NONE" ? "active" : ""}" data-target="NONE" title="未分类">📄 未分类 <span class="xcount">${unclassified}</span></button>` +
    `<div class="xsidebar-label">文件夹</div>`;

  // 递归渲染树形结构（缩进体现层级）
  function treeRows(parentId, depth) {
    let out = "";
    folders.filter(f => (f.parentId || null) === parentId).forEach(f => {
      const active = currentFolder === f.id;
      out +=
        `<div class="xsidebar-row ${active ? "active" : ""}" data-target="${f.id}" title="${escapeHtml(f.name)}" style="padding-left:${depth * 12}px">` +
        `<button class="xsidebar-item" data-target="${f.id}"><span class="xcaret">▾</span>📁 ${escapeHtml(f.name)} <span class="xcount">${countIn(f.id)}</span></button>` +
        `<span class="xsidebar-actions">` +
        `<button data-fact="ren" data-id="${f.id}" title="重命名文件夹">✎</button>` +
        `<button data-fact="del" data-id="${f.id}" title="删除文件夹">✕</button>` +
        `</span></div>`;
      out += treeRows(f.id, depth + 1);
    });
    return out;
  }
  html += treeRows(null, 0);

  html += `<button class="xsidebar-item xsidebar-add" data-fact="new" title="新建文件夹">＋ 新建文件夹</button>`;
  sidebar.innerHTML = html;
  // 为侧栏文件夹条目设置拖放目标
  sidebar.querySelectorAll(".xsidebar-row[data-target]").forEach(row => {
    const fid = row.getAttribute("data-target");
    makeDropTarget(row, fid, () => "已移动到该文件夹");
  });
  // 「全部内容」和「未分类」也作为拖放目标
  sidebar.querySelectorAll('.xsidebar-item[data-target="root"]').forEach(el => {
    makeDropTarget(el, null, () => "已移出文件夹");
  });
  sidebar.querySelectorAll('.xsidebar-item[data-target="NONE"]').forEach(el => {
    makeDropTarget(el, null, () => "已移出文件夹");
  });
}

function renderBreadcrumb() {
  let html = `<button class="crumb ${currentFolder === null ? "active" : ""}" data-target="root">🏠 全部内容</button>`;
  if (currentFolder === "NONE") {
    html += `<span class="crumb-sep">›</span><span class="crumb active">📄 未分类</span>`;
  } else if (typeof currentFolder === "string") {
    // 从当前文件夹沿 parentId 向上回溯出完整路径
    const folders = Storage.listFolders();
    const chain = [];
    let cur = folders.find(f => f.id === currentFolder);
    while (cur) { chain.unshift(cur); cur = folders.find(f => f.id === cur.parentId); }
    chain.forEach(f => {
      html += `<span class="crumb-sep">›</span>`;
      if (f.id === currentFolder) {
        html += `<span class="crumb active" title="${escapeHtml(f.name)}">📁 ${escapeHtml(f.name)}</span>`;
      } else {
        html += `<button class="crumb" data-target="${f.id}" title="${escapeHtml(f.name)}">📁 ${escapeHtml(f.name)}</button>`;
      }
    });
  }
  breadcrumb.innerHTML = html;
}

function buildFolderTile(f) {
  const folders = Storage.listFolders();
  const plans = Storage.list();
  // 计数包含子文件夹中的教案
  const countIn = fid => {
    let n = plans.filter(p => p.folderId === fid).length;
    folders.filter(c => c.parentId === fid).forEach(c => { n += countIn(c.id); });
    return n;
  };
  const count = countIn(f.id);
  const tile = document.createElement("div");
  tile.className = "plan-card folder-card";
  tile.title = "打开文件夹：" + f.name + "（可拖拽到其他文件夹）";
  tile.draggable = true;
  tile.innerHTML = `
    <div class="folder-card-icon">📁</div>
    <h3>${escapeHtml(f.name)}</h3>
    <div class="plan-meta">
      <span>${count} 份教案</span>
    </div>
    <div class="plan-actions">
      <button class="btn btn-sm btn-ghost" data-fact="ren" data-id="${f.id}" title="重命名文件夹">✎ 重命名</button>
      <button class="btn btn-sm btn-ghost btn-danger" data-fact="del" data-id="${f.id}" title="删除文件夹">✕ 删除</button>
    </div>`;
  tile.addEventListener("click", (e) => {
    if (e.target.closest("button[data-fact]")) return;
    navigate(f.id);
  });
  // 文件夹拖拽：把文件夹拖到其他文件夹里
  tile.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("text/folder-id", f.id);
    e.dataTransfer.effectAllowed = "move";
    tile.classList.add("dragging");
    e.stopPropagation();
  });
  tile.addEventListener("dragend", () => tile.classList.remove("dragging"));
  makeDropTarget(tile, f.id, () => "已移动到 " + f.name);
  return tile;
}

/** 共享 drop 目标：文件夹大图标、左侧栏各条目（支持教案和文件夹拖入） */
function makeDropTarget(el, folderId, msgFn) {
  el.addEventListener("dragover", (e) => {
    const isPlan = e.dataTransfer.types.includes("text/plan-id");
    const isFolder = e.dataTransfer.types.includes("text/folder-id");
    if (!isPlan && !isFolder) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    el.classList.add("drag-over");
  });
  el.addEventListener("dragleave", (e) => {
    if (!el.contains(e.relatedTarget)) el.classList.remove("drag-over");
  });
  el.addEventListener("drop", (e) => {
    e.preventDefault();
    el.classList.remove("drag-over");
    const planId = e.dataTransfer.getData("text/plan-id");
    const draggedFolderId = e.dataTransfer.getData("text/folder-id");
    // 教案拖入
    if (planId) {
      Storage.movePlan(planId, folderId || null);
      showToast(msgFn ? msgFn() : "已移动");
    }
    // 文件夹拖入（不能拖到自己里面）
    else if (draggedFolderId && draggedFolderId !== folderId) {
      Storage.moveFolder(draggedFolderId, folderId || null);
      showToast("文件夹已移动");
    } else {
      return;
    }
    // 延迟渲染，确保拖拽事件链完全结束
    setTimeout(() => render(searchInput.value), 100);
  });
}

/* 新建 / 重命名文件夹弹窗（应用内输入框，不再用浏览器 prompt） */
const folderModal = document.getElementById("folder-modal");
const folderNameInput = document.getElementById("folder-name-input");
let folderModalMode = null; // { mode: "new" | "ren", id, parentId }

function openFolderModal(mode, folderId) {
  const folder = folderId ? Storage.listFolders().find(f => f.id === folderId) : null;
  // 新建时：当前位于某个文件夹内 → 在其中创建子文件夹；否则创建顶层文件夹
  let parentId = null;
  if (mode === "new" && typeof currentFolder === "string" && currentFolder !== "NONE") {
    parentId = currentFolder;
  }
  folderModalMode = { mode, id: folderId || null, parentId };
  document.getElementById("folder-modal-title").textContent =
    mode === "new"
      ? (parentId ? "在「" + (Storage.listFolders().find(f => f.id === parentId) || {}).name + "」中新建文件夹" : "新建文件夹")
      : "重命名文件夹";
  folderNameInput.value = folder ? folder.name : "";
  folderModal.style.display = "flex";
  setTimeout(() => folderNameInput.focus(), 50);
}

function closeFolderModal() {
  folderModal.style.display = "none";
  folderModalMode = null;
}

function confirmFolderModal() {
  if (!folderModalMode) return;
  const mode = folderModalMode.mode;
  const name = folderNameInput.value.trim();
  if (!name) { folderNameInput.focus(); return; }
  if (mode === "new") Storage.createFolder(name, folderModalMode.parentId);
  else Storage.renameFolder(folderModalMode.id, name);
  closeFolderModal();
  showToast(mode === "new" ? "文件夹已创建" : "已重命名");
  render(searchInput.value);
}

document.getElementById("folder-modal-ok").addEventListener("click", confirmFolderModal);
document.getElementById("folder-modal-cancel").addEventListener("click", closeFolderModal);
document.getElementById("folder-modal-backdrop").addEventListener("click", closeFolderModal);
folderNameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") confirmFolderModal();
  if (e.key === "Escape") closeFolderModal();
});

function handleFolderAction(fact, id) {
  if (fact === "new") {
    openFolderModal("new", null);
  } else if (fact === "ren") {
    openFolderModal("ren", id);
  } else if (fact === "del") {
    if (confirm("删除该文件夹后，里面的教案会移到「未分类」、子文件夹会上移一级，不会丢失。确定删除吗？")) {
      Storage.removeFolder(id);
      if (currentFolder === id) currentFolder = null;
      render(searchInput.value);
    }
  }
}

sidebar.addEventListener("click", (e) => {
  const actBtn = e.target.closest("button[data-fact]");
  if (actBtn) { handleFolderAction(actBtn.dataset.fact, actBtn.dataset.id); return; }
  const item = e.target.closest("[data-target]");
  if (item) navigate(item.dataset.target);
});
breadcrumb.addEventListener("click", (e) => {
  const crumb = e.target.closest("button[data-target]");
  if (crumb) navigate(crumb.dataset.target);
});
document.getElementById("new-folder-btn").addEventListener("click", () => handleFolderAction("new", null));

// 左侧栏整体作为拖放区（事件委托，重渲染后依然有效）：
// 拖到文件夹条目 → 移入该文件夹；拖到「全部教案」/「未分类」→ 移到未分类
sidebar.addEventListener("dragover", (e) => {
  const row = e.target.closest("[data-target]");
  if (!row || !e.dataTransfer.types.includes("text/plan-id")) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  row.classList.add("drag-over");
});
sidebar.addEventListener("dragleave", (e) => {
  const row = e.target.closest("[data-target]");
  if (row && !row.contains(e.relatedTarget)) row.classList.remove("drag-over");
});
sidebar.addEventListener("drop", (e) => {
  const row = e.target.closest("[data-target]");
  if (!row) return;
  e.preventDefault();
  row.classList.remove("drag-over");
  const planId = e.dataTransfer.getData("text/plan-id");
  if (!planId) return;
  const target = row.dataset.target;
  const folder = Storage.listFolders().find(f => f.id === target);
  Storage.movePlan(planId, folder ? folder.id : null);
  showToast("已移动到 " + (folder ? folder.name : "未分类"));
  render(searchInput.value);
});

/* ---------------- 移动教案弹窗 ---------------- */

function openMoveModal(planId) {
  movePlanId = planId;
  const folders = Storage.listFolders();
  // 树形列表（缩进体现层级）
  function treeItems(parentId, depth) {
    let out = "";
    folders.filter(f => (f.parentId || null) === parentId).forEach(f => {
      out += `<button class="move-item" data-target="${f.id}" style="padding-left:${12 + depth * 16}px" title="${escapeHtml(f.name)}">📁 ${escapeHtml(f.name)}</button>`;
      out += treeItems(f.id, depth + 1);
    });
    return out;
  }
  moveModal.querySelector("#move-list").innerHTML =
    treeItems(null, 0) +
    `<button class="move-item" data-target="">📄 未分类</button>`;
  moveModal.style.display = "flex";
}

function closeMoveModal() {
  moveModal.style.display = "none";
  movePlanId = null;
}

moveModal.querySelector("#move-list").addEventListener("click", (e) => {
  const item = e.target.closest("button.move-item");
  if (!item || !movePlanId) return;
  Storage.movePlan(movePlanId, item.dataset.target || null);
  closeMoveModal();
  showToast("已移动");
  renderSidebar();
  renderBreadcrumb();
  render(searchInput.value);
});
moveModal.querySelector("#move-modal-backdrop").addEventListener("click", closeMoveModal);
moveModal.querySelector("#move-cancel").addEventListener("click", closeMoveModal);

grid.addEventListener("click", (e) => {
  const factBtn = e.target.closest("button[data-fact]");
  if (factBtn) { handleFolderAction(factBtn.dataset.fact, factBtn.dataset.id); return; }
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.dataset.act === "dup") {
    Storage.duplicate(id);
    showToast("已复制该教案");
    render(searchInput.value);
  } else if (btn.dataset.act === "move") {
    openMoveModal(id);
  } else if (btn.dataset.act === "del") {
    if (confirm("确定要删除这份教案吗？此操作无法撤销。")) {
      Storage.remove(id);
      showToast("已删除");
      render(searchInput.value);
    }
  }
});

searchInput.addEventListener("input", () => render(searchInput.value));

// 备份导出
document.getElementById("export-backup-btn").addEventListener("click", () => {
  const json = Storage.exportJSON();
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `lesson-planner-backup-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast("备份文件已下载");
});

// 备份导入
document.getElementById("import-backup-btn").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", async () => {
  const file = fileInput.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const mode = confirm("点击“确定”将合并导入（保留本地已有教案）；点击“取消”将完全替换本地数据。") ? "merge" : "replace";
    const count = Storage.importJSON(text, mode);
    showToast(mode === "merge" ? `已合并导入 ${count} 份教案` : `已恢复 ${count} 份教案`);
    render(searchInput.value);
  } catch (err) {
    alert("导入失败：备份文件格式不正确。\n" + err.message);
  } finally {
    fileInput.value = "";
  }
});

/* ---------------- 本地文件夹连接 ---------------- */

const fsBtn = document.getElementById("fs-sync-btn");
const fsStatusEl = document.getElementById("fs-status");

function updateFsBtn(status, name) {
  if (!fsBtn) return;
  if (status === "connected") {
    fsBtn.textContent = "📁 " + (name || "已连接");
    fsBtn.className = "btn fs-btn-connected";
    fsBtn.onclick = handleDisconnect;
  } else if (status === "connecting") {
    fsBtn.textContent = "连接中...";
    fsBtn.className = "btn";
    fsBtn.onclick = null;
  } else if (status === "need-permission") {
    fsBtn.textContent = "🔑 需要权限";
    fsBtn.className = "btn fs-btn-need-perm";
    fsBtn.onclick = handleConnect;
  } else {
    fsBtn.textContent = "📂 连接本地文件夹";
    fsBtn.className = "btn";
    fsBtn.onclick = handleConnect;
  }
}

async function handleConnect() {
  try {
    const result = await connectFs();
    showToast(`已连接文件夹，导入 ${result.importedPlans} 份教案`);
    render(searchInput.value);
  } catch (err) {
    if (err.name !== "AbortError") {
      showToast("连接失败: " + err.message);
    }
  }
}

async function handleDisconnect() {
  if (confirm("确定要断开本地文件夹吗？数据仍会保留在浏览器中。")) {
    await disconnectFs();
    showToast("已断开本地文件夹连接");
  }
}

async function handleOpenFolder() {
  try {
    await openInExplorer();
  } catch (err) {
    if (err.name !== "AbortError") {
      showToast("打开失败: " + err.message);
    }
  }
}

// 初始化文件系统同步
if (isFsSupported()) {
  if (fsBtn) fsBtn.style.display = "inline-flex";
  updateFsBtn(getFsStatus().status, getFsStatus().name);
  onFsStatus(updateFsBtn);
}

// 打开文件夹按钮
const openFolderBtn = document.getElementById("open-folder-btn");
if (openFolderBtn) {
  openFolderBtn.addEventListener("click", handleOpenFolder);
  // 只在已连接时显示
  onFsStatus((status) => {
    openFolderBtn.style.display = status === "connected" ? "inline-flex" : "none";
  });
}

render();
