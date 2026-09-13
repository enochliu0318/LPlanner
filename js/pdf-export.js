/* ============================================================
    pdf-export.js
    通过浏览器原生打印（Chromium「另存为 PDF」）生成文字版 PDF：
    输出为矢量文字（可选中、可复制、可搜索），文件体积小，且
    与打印视图排版 1:1 一致。不再使用 html2canvas 截图。
    ============================================================ */

import { buildDocumentModel } from "./document-model.js?v=60";

/**
 * 导出教案为 PDF 文件（文字版，通过浏览器打印对话框）
 * @param {Object} plan - 教案数据对象
 * @param {Function} buildPrintHtml - 生成打印视图 HTML 的函数
 */
export async function exportPlanToPdf(plan, buildPrintHtml) {
  // 构建打印视图 HTML 并插入到 #print-root
  const root = document.getElementById("print-root");
  root.innerHTML = buildPrintHtml(plan);

  // 等待 webfont 加载完成，避免打印时字体回退
  if (document.fonts && document.fonts.ready) {
    try { await document.fonts.ready; } catch (e) { /* 忽略字体加载异常 */ }
  }
  await new Promise(r => setTimeout(r, 100));

  // 临时把页面标题改为教案名，打印对话框「另存为 PDF」会以此为默认文件名
  const originalTitle = document.title;
  const suggested = (plan.lessonTitle || "教案").replace(/[\\/:*?"<>|]/g, "");
  document.title = suggested;

  const restore = () => {
    document.title = originalTitle;
    window.removeEventListener("afterprint", restore);
  };
  window.addEventListener("afterprint", restore);

  // 打开系统打印对话框（目标打印机选「另存为 PDF」即得到文字版 PDF）
  window.print();

  // 某些浏览器不触发 afterprint（如对话框被取消），延时兜底恢复标题
  setTimeout(restore, 60_000);
}
