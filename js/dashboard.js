import { Storage } from "./storage.js?v=4";
import { renderRailTabs } from "./tabs.js?v=4";

const grid = document.getElementById("card-grid");
const emptyState = document.getElementById("empty-state");
const searchInput = document.getElementById("search-input");
const toast = document.getElementById("toast");
const fileInput = document.getElementById("import-file-input");

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
  const list = kw
    ? all.filter(p =>
        [p.courseName, p.lessonTitle, p.teacher, p.courseCategory]
          .filter(Boolean)
          .some(v => v.toLowerCase().includes(kw))
      )
    : all;

  // 左栏标签页（在列表页不高亮任何标签）
  renderRailTabs(document.getElementById("rail-tabs"), { activeId: null });

  grid.innerHTML = "";

  if (all.length === 0) {
    emptyState.style.display = "block";
    grid.style.display = "none";
    return;
  }
  emptyState.style.display = "none";
  grid.style.display = "grid";

  if (list.length === 0) {
    grid.innerHTML = `<p style="color:var(--ink-faint)">没有找到匹配"${escapeHtml(keyword)}"的教案。</p>`;
    return;
  }

  list.forEach(plan => {
    const card = document.createElement("div");
    card.className = "plan-card";
    card.innerHTML = `
      <div class="plan-course">${escapeHtml(plan.courseName || "未分类课程")}${plan.courseCategory ? " · " + escapeHtml(plan.courseCategory) : ""}</div>
      <h3>${escapeHtml(plan.lessonTitle || "（未命名课题）")}</h3>
      <div class="plan-meta">
        <span>教师：${escapeHtml(plan.teacher || "—")}</span>
        <span>上课时间：${escapeHtml(plan.teachDate || "—")}</span>
        <span>学时：${escapeHtml(String(plan.hours || "1"))}</span>
      </div>
      <div class="plan-meta" style="color:var(--ink-faint)">更新于 ${fmtDate(plan.updatedAt)}</div>
      <div class="plan-actions">
        <a class="btn btn-sm btn-primary" href="editor.html?id=${encodeURIComponent(plan.id)}">编辑</a>
        <button class="btn btn-sm" data-act="dup" data-id="${plan.id}">复制</button>
        <button class="btn btn-sm btn-ghost btn-danger" data-act="del" data-id="${plan.id}">删除</button>
      </div>
    `;
    // 点击卡片任意位置 → 直接进入该教案的编辑页
    card.addEventListener("click", () => {
      location.href = "editor.html?id=" + encodeURIComponent(plan.id);
    });
    // 按钮区域不触发卡片跳转，保证 复制 / 删除 / 编辑 按钮各自正常工作
    card.querySelector(".plan-actions").addEventListener("click", (e) => e.stopPropagation());
    grid.appendChild(card);
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

grid.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.dataset.act === "dup") {
    Storage.duplicate(id);
    showToast("已复制该教案");
    render(searchInput.value);
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

render();
