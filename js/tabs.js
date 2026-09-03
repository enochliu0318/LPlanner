/* ============================================================
   tabs.js
   左侧栏的「已打开教案」标签页：像浏览器标签一样，
   可以同时打开多份教案并在它们之间随时切换。
   标签列表保存在 localStorage（key: lesson_planner_tabs_v1），
   其中 "new" 是「新建教案（尚未保存）」的占位标签。
   ============================================================ */

import { Storage } from "./storage.js?v=18";

const TABS_KEY = "lesson_planner_tabs_v1";
export const NEW_TAB = "new";

function readState() {
  try {
    const raw = localStorage.getItem(TABS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && Array.isArray(parsed.tabs)) {
      return { tabs: parsed.tabs, active: parsed.active ?? null };
    }
  } catch (err) { /* 数据损坏时按空处理 */ }
  return { tabs: [], active: null };
}

function writeState(state) {
  try {
    localStorage.setItem(TABS_KEY, JSON.stringify(state));
  } catch (err) { /* 存储不可用时静默降级 */ }
}

export const Tabs = {
  NEW_TAB,

  /** 当前打开的标签 id 列表（自动清掉对应教案已被删除的标签） */
  list() {
    const state = readState();
    const tabs = state.tabs.filter(id => id === NEW_TAB || Storage.get(id));
    writeState({ tabs, active: state.active });
    return tabs;
  },

  active() {
    return readState().active;
  },

  setActive(id) {
    const state = readState();
    state.active = id;
    writeState(state);
  },

  /** 打开一个标签（已存在则不重复添加） */
  open(id) {
    const state = readState();
    if (!state.tabs.includes(id)) state.tabs.push(id);
    writeState(state);
  },

  /** 关闭标签；若关闭的是当前激活标签，激活位顺延到剩余第一个 */
  close(id) {
    const state = readState();
    state.tabs = state.tabs.filter(t => t !== id);
    if (state.active === id) {
      state.active = state.tabs.length ? state.tabs[0] : null;
    }
    writeState(state);
  },

  /** 新教案保存后，把「新建」占位标签替换为真实教案 id */
  replace(oldId, newId) {
    const state = readState();
    state.tabs = [...new Set(state.tabs.map(t => (t === oldId ? newId : t)))];
    if (state.active === oldId) state.active = newId;
    writeState(state);
  }
};

/** 某个标签对应的编辑页地址 */
export function tabHref(id) {
  return id === NEW_TAB ? "editor.html" : "editor.html?id=" + encodeURIComponent(id);
}

/**
 * 渲染左侧栏的标签区。
 * @param {HTMLElement} container 挂载容器（.rail-tabs）
 * @param {{activeId?: string|null}} opts 当前页面对应的标签 id；列表页传 null
 */
export function renderRailTabs(container, opts = {}) {
  const activeId = opts.activeId ?? null;
  const tabs = Tabs.list();
  container.innerHTML = "";

  if (tabs.length === 0) {
    container.style.display = "none";
    return;
  }
  container.style.display = "flex";

  const head = document.createElement("div");
  head.className = "rail-tabs-head";
  head.textContent = "已打开 · 教案";
  container.appendChild(head);

  tabs.forEach(id => {
    const plan = id === NEW_TAB ? null : Storage.get(id);
    const label = id === NEW_TAB
      ? "新建教案（未保存）"
      : (plan && (plan.lessonTitle || plan.courseName)) || "（未命名教案）";

    const row = document.createElement("div");
    row.className = "rail-tab" + (id === activeId ? " active" : "");
    row.title = label;

    const title = document.createElement("span");
    title.className = "rail-tab-title";
    title.textContent = label;

    const close = document.createElement("button");
    close.className = "rail-tab-close";
    close.type = "button";
    close.title = "关闭标签";
    close.textContent = "✕";

    row.appendChild(title);
    row.appendChild(close);
    container.appendChild(row);

    // 点击标签 → 切换到该教案的编辑页（有未保存修改时 beforeunload 会拦截提醒）
    row.addEventListener("click", () => { location.href = tabHref(id); });

    close.addEventListener("click", (e) => {
      e.stopPropagation();
      const isActive = activeId != null && id === activeId;
      Tabs.close(id);
      const remaining = Tabs.list();
      if (isActive) {
        // 关闭的是当前正打开的教案 → 跳到下一个标签或回首页
        location.href = remaining.length ? tabHref(remaining[0]) : "index.html";
      } else {
        renderRailTabs(container, opts);
      }
    });
  });
}
