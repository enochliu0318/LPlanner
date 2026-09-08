/* ============================================================
   fs-sync.js
   本地文件夹实时镜像（File System Access API，Chrome / Edge）
   ------------------------------------------------------------
   - localStorage 是工作数据源，本地文件夹是持久化备份
   - 用户选择一个本地文件夹后，每次数据变更自动镜像为真实文件：
       <所选文件夹>/
         folders.json              ← 文件夹树元数据
         课题名 [编号].json         ← 未分类教案
         Unit 3/
           课题名 [编号].json       ← 文件夹内教案
   - 重连时自动扫描磁盘上的 JSON 导入回来（按 updatedAt 取较新者），
     因此清空浏览器缓存也不会丢数据
   - 提供"打开文件夹"功能，可在系统资源管理器中查看文件
   - 仅支持 Chrome / Edge；其他浏览器自动隐藏该功能
   ============================================================ */

import { Storage } from "./storage.js?v=39";

const DB_NAME = "lesson_planner_fs";
const STORE = "handles";
const KEY = "root";
const ID_RE = /\[([A-Za-z0-9_-]{4,12})\]\.json$/;

let rootHandle = null;        // 当前连接的目录句柄
let ourDirs = new Set();      // 我们创建过的目录路径（用于安全清理空目录）
let status = "off";           // off | connecting | connected | need-permission | unsupported
const statusCbs = [];
const importedCbs = [];

export function isSupported() {
  return typeof window.showDirectoryPicker === "function";
}

export function onStatus(cb) {
  statusCbs.push(cb);
  cb(status, rootHandle ? rootHandle.name : "");
}
function setStatus(s, name) {
  status = s;
  statusCbs.forEach(cb => { try { cb(s, name); } catch (err) {} });
}
export function getStatus() {
  return { status, name: rootHandle ? rootHandle.name : "" };
}
export function onImported(cb) {
  importedCbs.push(cb);
}

/* ---------- IndexedDB：记住用户选过的文件夹 ---------- */
function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function saveHandle(handle) {
  const db = await idbOpen();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(handle, KEY);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
async function loadHandle() {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(KEY);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}
async function clearHandle() {
  const db = await idbOpen();
  await new Promise((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(KEY);
    tx.oncomplete = resolve;
    tx.onerror = resolve;
  });
}

/* ---------- 名称与路径 ---------- */
function sanitize(name) {
  const s = String(name || "").replace(/[\\/:*?"<>|]/g, "_").trim();
  return (s || "未命名").slice(0, 80);
}
function planFileName(plan) {
  return `${sanitize(plan.lessonTitle)} [${String(plan.id).slice(-6)}].json`;
}
function folderPathOf(folderId, folders) {
  const path = [];
  let cur = folders.find(f => f.id === folderId);
  const seen = new Set();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    path.unshift(sanitize(cur.name));
    cur = folders.find(f => f.id === cur.parentId);
  }
  return path;
}
async function getDirByPath(parts, create) {
  let dir = rootHandle;
  for (const p of parts) dir = await dir.getDirectoryHandle(p, { create: !!create });
  return dir;
}
async function listDir(dir) {
  const entries = [];
  for await (const [name, handle] of dir.entries()) entries.push({ name, handle });
  return entries;
}
async function writeJson(fileHandle, data) {
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(data, null, 2));
  await writable.close();
}

/* ---------- 串行同步队列：避免并发写坏文件 ---------- */
let chain = Promise.resolve();
function enqueue(fn) {
  chain = chain.then(fn).catch(err => console.warn("[fs-sync] 同步出错（本地数据不受影响）:", err));
  return chain;
}

let mirrorTimer = null;
function scheduleMirror() {
  if (!rootHandle) return;
  clearTimeout(mirrorTimer);
  mirrorTimer = setTimeout(() => enqueue(mirrorAll), 600);
}

/* ---------- 全量镜像 ---------- */
async function mirrorAll() {
  if (!rootHandle) return;
  const folders = JSON.parse(localStorage.getItem("lesson_planner_folders_v1") || "[]");
  const plans = JSON.parse(localStorage.getItem("lesson_planner_v1") || "[]");

  // 1. 文件夹树元数据
  await writeJson(await rootHandle.getFileHandle("folders.json", { create: true }), { folders });

  // 2. 确保每个文件夹的目录存在，并写入教案文件
  const validPaths = new Set();
  for (const f of folders) {
    const parts = folderPathOf(f.id, folders);
    validPaths.add(parts.join("/"));
    await getDirByPath(parts, true);
  }
  const validId6 = new Set();
  for (const p of plans) {
    validId6.add(String(p.id).slice(-6));
    const dirPath = p.folderId ? folderPathOf(p.folderId, folders) : [];
    const dir = await getDirByPath(dirPath, true);
    await writeJson(await dir.getFileHandle(planFileName(p), { create: true }), p);
  }

  // 3. 清理不再存在的教案文件（只删匹配我们命名模式的 .json，绝不碰用户自己的文件）
  const dirsToCheck = [[[], rootHandle]];
  for (const f of folders) {
    try { dirsToCheck.push([folderPathOf(f.id, folders), await getDirByPath(folderPathOf(f.id, folders), false)]); } catch (err) {}
  }
  for (const [path, dir] of dirsToCheck) {
    for (const { name, handle } of await listDir(dir)) {
      if (handle.kind !== "file") continue;
      const m = name.match(ID_RE);
      if (m && !validId6.has(m[1])) {
        try { await dir.removeEntry(name); } catch (err) {}
      }
    }
  }

  // 4. 清理我们之前创建、现在已空的文件夹目录
  const currentPaths = [...validPaths];
  for (const old of ourDirs) {
    if (currentPaths.some(p => p === old || p.startsWith(old + "/"))) continue;
    try {
      const parts = old.split("/");
      const parent = await getDirByPath(parts.slice(0, -1), false);
      await parent.removeEntry(parts[parts.length - 1]);
    } catch (err) { /* 目录非空或已不存在，忽略 */ }
  }
  ourDirs = new Set(currentPaths);
}

/* ---------- 从磁盘导入 ---------- */
async function importFromDir() {
  let importedFolders = 0, importedPlans = 0;

  // 1. 文件夹树
  try {
    const fh = await rootHandle.getFileHandle("folders.json");
    const data = JSON.parse(await (await fh.getFile()).text());
    if (Array.isArray(data.folders)) {
      const cur = JSON.parse(localStorage.getItem("lesson_planner_folders_v1") || "[]");
      const byId = new Map(cur.map(f => [f.id, f]));
      for (const f of data.folders) {
        if (!f || !f.id || byId.has(f.id)) continue;
        cur.push({ id: f.id, name: sanitize(f.name), parentId: f.parentId || null, createdAt: f.createdAt || new Date().toISOString() });
        importedFolders++;
      }
      localStorage.setItem("lesson_planner_folders_v1", JSON.stringify(cur));
    }
  } catch (err) { /* 没有 folders.json，跳过 */ }

  // 2. 递归扫描教案 .json
  const curPlans = JSON.parse(localStorage.getItem("lesson_planner_v1") || "[]");
  const byId = new Map(curPlans.map(p => [p.id, p]));
  async function walk(dir, depth) {
    if (depth > 6) return;
    for (const { name, handle } of await listDir(dir)) {
      if (handle.kind === "directory") { await walk(handle, depth + 1); continue; }
      if (!ID_RE.test(name)) continue;
      try {
        const data = JSON.parse(await (await handle.getFile()).text());
        if (!data || !data.id) continue;
        const exist = byId.get(data.id);
        if (!exist || String(data.updatedAt || "") > String(exist.updatedAt || "")) {
          if (!exist) importedPlans++;
          data.folderId = data.folderId || null;
          byId.set(data.id, data);
        }
      } catch (err) { /* 跳过无法解析的文件 */ }
    }
  }
  await walk(rootHandle, 0);
  localStorage.setItem("lesson_planner_v1", JSON.stringify([...byId.values()]));

  return { importedFolders, importedPlans };
}

/* ---------- 连接 / 断开 / 自动重连 ---------- */
async function finishConnect() {
  setStatus("connecting", rootHandle.name);
  const res = await enqueue(async () => {
    const imp = await importFromDir();
    await mirrorAll();
    return imp;
  });
  setStatus("connected", rootHandle.name);
  importedCbs.forEach(cb => { try { cb(res); } catch (err) {} });
  return res;
}

export async function connect() {
  if (!isSupported()) throw new Error("当前浏览器不支持本地文件夹访问（需要 Chrome 或 Edge）");
  let handle = null;
  // 先尝试之前记住的文件夹（请求权限需在用户手势内）
  try {
    handle = await loadHandle();
    if (handle) {
      const perm = await handle.queryPermission({ mode: "readwrite" });
      if (perm !== "granted") {
        const req = await handle.requestPermission({ mode: "readwrite" });
        if (req !== "granted") handle = null;
      }
    }
  } catch (err) { handle = null; }
  // 没有可用句柄 → 让用户重新选择
  if (!handle) {
    handle = await window.showDirectoryPicker({ mode: "readwrite" });
    const perm = await handle.requestPermission({ mode: "readwrite" });
    if (perm !== "granted") throw new Error("未获得文件夹写入权限");
  }
  rootHandle = handle;
  await saveHandle(handle);
  return finishConnect();
}

export async function disconnect() {
  rootHandle = null;
  ourDirs = new Set();
  await clearHandle();
  setStatus("off");
}

async function tryAutoConnect() {
  if (!isSupported()) { setStatus("unsupported"); return false; }
  try {
    const handle = await loadHandle();
    if (!handle) { setStatus("off"); return false; }
    rootHandle = handle;
    const perm = await handle.queryPermission({ mode: "readwrite" });
    if (perm !== "granted") { setStatus("need-permission", handle.name); rootHandle = null; return false; }
    await finishConnect();
    return true;
  } catch (err) {
    rootHandle = null;
    setStatus("off");
    return false;
  }
}

/* 订阅数据变更 → 防抖后镜像到磁盘 */
Storage.onChange(scheduleMirror);

/* ---------- 打开文件夹在系统资源管理器中 ---------- */

/**
 * 尝试在系统文件资源管理器中打开当前连接的文件夹
 * 由于浏览器安全限制，无法直接打开 file:// 路径
 * 这里使用 showDirectoryPicker 重新选择（浏览器会高亮之前选的文件夹）
 */
export async function openInExplorer() {
  if (!rootHandle) return false;
  try {
    // 方法1：尝试使用 showDirectoryPicker 让用户重新选择（会记住上次位置）
    // 这不是完美的"打开资源管理器"，但是最接近的跨浏览器方案
    const handle = await window.showDirectoryPicker({ mode: "readwrite" });
    if (handle) {
      rootHandle = handle;
      await saveHandle(handle);
      await finishConnect();
      return true;
    }
  } catch (err) {
    // 用户取消选择
    if (err.name === "AbortError") return false;
    console.error("打开文件夹失败:", err);
  }
  return false;
}

/**
 * 获取当前连接文件夹的名称
 */
export function getFolderName() {
  return rootHandle ? rootHandle.name : "";
}

/**
 * 获取当前连接文件夹的句柄（供其他模块使用）
 */
export function getRootHandle() {
  return rootHandle;
}

/* 模块加载即尝试自动重连（权限仍有效时静默完成） */
tryAutoConnect();