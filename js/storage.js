/* ============================================================
   storage.js
   所有教案数据保存在浏览器 localStorage 中，key 为 LP_STORE_KEY。
   不依赖任何后端服务，因此零成本、无需登录。
   同时提供 JSON 导出/导入，方便换设备或手动备份。
   ============================================================ */

const LP_STORE_KEY = "lesson_planner_v1";
const LP_FOLDER_KEY = "lesson_planner_folders_v1";

/** 生成一个简单的唯一 ID */
function genId() {
  return "lp_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

/** 读取全部教案（数组），若不存在则返回空数组 */
function readAll() {
  try {
    const raw = localStorage.getItem(LP_STORE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error("读取本地教案数据失败：", err);
    return [];
  }
}

/** 写入全部教案 */
function writeAll(list) {
  try {
    localStorage.setItem(LP_STORE_KEY, JSON.stringify(list));
    return true;
  } catch (err) {
    console.error("保存本地教案数据失败：", err);
    return false;
  }
}

/** 读取全部文件夹（数组），若不存在则返回空数组 */
function readFolders() {
  try {
    const raw = localStorage.getItem(LP_FOLDER_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error("读取文件夹数据失败：", err);
    return [];
  }
}

/** 写入全部文件夹 */
function writeFolders(list) {
  try {
    localStorage.setItem(LP_FOLDER_KEY, JSON.stringify(list));
    return true;
  } catch (err) {
    console.error("保存文件夹数据失败：", err);
    return false;
  }
}

/** 返回一个空白教案的默认结构 */
function blankPlan() {
  const now = new Date().toISOString();
  return {
    id: genId(),
    createdAt: now,
    updatedAt: now,
    folderId: null,
    courseName: "",
    courseCategory: "",
    teacher: "",
    teachDate: "",
    lessonTitle: "",
    hours: "1",
    objectives: "",
    keyPoints: "",
    difficultPoints: "",
    methods: "",
    references: [
      { label: "PPT", url: "" },
      { label: "参考资料", url: "" }
    ],
    content: [
      { level: 1, text: "" }
    ],
    remarks: "",
    homework: "",
    summary: ""
  };
}

/* 变更通知：fs-sync 等模块订阅，数据变化时自动镜像到本地文件夹 */
const changeListeners = [];
function notifyChange() {
  changeListeners.forEach(cb => { try { cb(); } catch (err) { console.warn("[storage] listener error:", err); } });
}

export const Storage = {
  /** 订阅数据变更（返回取消订阅函数） */
  onChange(cb) {
    changeListeners.push(cb);
    return () => { const i = changeListeners.indexOf(cb); if (i > -1) changeListeners.splice(i, 1); };
  },

  list() {
    return readAll().sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  },

  get(id) {
    return readAll().find(p => p.id === id) || null;
  },

  /** 新建或更新一份教案，返回保存后的对象 */
  save(plan) {
    const list = readAll();
    const now = new Date().toISOString();
    const idx = list.findIndex(p => p.id === plan.id);
    plan.updatedAt = now;
    if (idx === -1) {
      plan.createdAt = plan.createdAt || now;
      list.push(plan);
    } else {
      list[idx] = plan;
    }
    writeAll(list);
    notifyChange();
    return plan;
  },

  remove(id) {
    const list = readAll().filter(p => p.id !== id);
    writeAll(list);
    notifyChange();
  },

  /* ---------- 文件夹管理 ---------- */

  /** 列出全部文件夹（按创建时间排序） */
  listFolders() {
    return readFolders().sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
  },

  /** 新建文件夹（parentId 为空表示顶层），返回创建的对象；名称为空返回 null */
  createFolder(name, parentId = null) {
    name = String(name || "").trim();
    if (!name) return null;
    const folder = { id: genId(), name, parentId: parentId || null, createdAt: new Date().toISOString() };
    const list = readFolders();
    list.push(folder);
    writeFolders(list);
    notifyChange();
    return folder;
  },

  /** 重命名文件夹 */
  renameFolder(id, name) {
    name = String(name || "").trim();
    if (!name) return null;
    const list = readFolders();
    const folder = list.find(f => f.id === id);
    if (!folder) return null;
    folder.name = name;
    writeFolders(list);
    notifyChange();
    return folder;
  },

  /** 删除文件夹：其中的教案移回「未分类」不会丢失；子文件夹上移到被删文件夹的父级 */
  removeFolder(id) {
    const folders = readFolders();
    const folder = folders.find(f => f.id === id);
    if (!folder) return;
    folders.forEach(f => {
      if (f.parentId === id) f.parentId = folder.parentId || null;
    });
    writeFolders(folders.filter(f => f.id !== id));
    const list = readAll();
    let changed = false;
    list.forEach(p => {
      if (p.folderId === id) { p.folderId = null; changed = true; }
    });
    if (changed) writeAll(list);
    notifyChange();
  },

  /** 把教案移动到文件夹（folderId 为空表示移到「未分类」） */
  movePlan(planId, folderId) {
    const list = readAll();
    const plan = list.find(p => p.id === planId);
    if (!plan) return false;
    plan.folderId = folderId || null;
    plan.updatedAt = new Date().toISOString();
    writeAll(list);
    notifyChange();
    return true;
  },

  duplicate(id) {
    const original = this.get(id);
    if (!original) return null;
    const copy = JSON.parse(JSON.stringify(original));
    copy.id = genId();
    copy.lessonTitle = (copy.lessonTitle || "未命名教案") + "（副本）";
    const now = new Date().toISOString();
    copy.createdAt = now;
    copy.updatedAt = now;
    const list = readAll();
    list.push(copy);
    writeAll(list);
    notifyChange();
    return copy;
  },

  blankPlan,

  /** 导出全部数据为 JSON 字符串，用于备份 */
  exportJSON() {
    return JSON.stringify({ exportedAt: new Date().toISOString(), plans: readAll() }, null, 2);
  },

  /** 从备份 JSON 导入，mode: 'merge' 追加合并 / 'replace' 完全替换 */
  importJSON(jsonText, mode = "merge") {
    const parsed = JSON.parse(jsonText);
    const incoming = Array.isArray(parsed) ? parsed : (parsed.plans || []);
    if (!Array.isArray(incoming)) throw new Error("备份文件格式不正确");

    if (mode === "replace") {
      writeAll(incoming);
      notifyChange();
      return incoming.length;
    }

    const list = readAll();
    const existingIds = new Set(list.map(p => p.id));
    let added = 0;
    incoming.forEach(p => {
      if (existingIds.has(p.id)) {
        // ID 冲突时视为新记录，避免覆盖本地已有数据
        p = { ...p, id: genId() };
      }
      list.push(p);
      added++;
    });
    writeAll(list);
    notifyChange();
    return added;
  }
};
