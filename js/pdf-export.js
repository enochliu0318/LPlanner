/* ============================================================
    pdf-export.js
    使用 html2canvas + jsPDF 在浏览器端生成 .pdf 文件，通过 CDN
    按需加载，不需要任何服务器或付费 API。
    排版目标：1:1 复刻「长江大学教案模板」——与 Word 导出
    使用同一套 document-model.js 数据，确保两个输出一致。
    ============================================================ */

import { buildDocumentModel } from "./document-model.js?v=21";

const HTML2CANVAS_CDN = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
const JSPDF_CDN = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if ([...document.scripts].some(s => s.src === src)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("无法加载脚本：" + src));
    document.head.appendChild(s);
  });
}

async function ensureLibs() {
  if (!window.html2canvas) {
    await loadScript(HTML2CANVAS_CDN);
    if (!window.html2canvas) throw new Error("html2canvas 组件加载失败，请检查网络后重试。");
  }
  if (!window.jspdf) {
    await loadScript(JSPDF_CDN);
    if (!window.jspdf) throw new Error("jsPDF 组件加载失败，请检查网络后重试。");
  }
}

/**
 * 导出教案为 PDF 文件
 * @param {Object} plan - 教案数据对象
 * @param {Function} buildPrintHtml - 生成打印视图 HTML 的函数
 */
export async function exportPlanToPdf(plan, buildPrintHtml) {
  await ensureLibs();

  // 构建打印视图 HTML 并插入到 #print-root
  const root = document.getElementById("print-root");
  root.innerHTML = buildPrintHtml(plan);

  // 添加 .pdf-capture 类让打印视图在屏幕可见（html2canvas 需要元素可见）
  document.body.classList.add("pdf-capture");

  // 等待 DOM 更新和字体加载
  await new Promise(r => setTimeout(r, 200));

  // 使用 html2canvas 捕获打印视图
  // scale: 4 提供 4x 超采样，文字边缘更锐利，打印级清晰度
  const canvas = await window.html2canvas(root, {
    scale: 4,
    useCORS: true,
    logging: false,
    backgroundColor: "#ffffff",
    windowWidth: root.scrollWidth,
    windowHeight: root.scrollHeight,
    letterRendering: true,      // 优化文字渲染
    allowTaint: true,           // 允许跨域图像
    removeContainer: true,      // 捕获后清理临时容器
    foreignObjectRendering: false, // 禁用 foreignObject 以避免渲染问题
  });

  // 移除 .pdf-capture 类
  document.body.classList.remove("pdf-capture");

  // 使用 jsPDF 创建 PDF
  const imgData = canvas.toDataURL("image/png");
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  const imgWidth = 210; // A4 宽度 (mm)
  const pageHeight = 297; // A4 高度 (mm)
  const imgHeight = (canvas.height * imgWidth) / canvas.width;

  let heightLeft = imgHeight;
  let position = 0;

  // 添加第一页
  pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
  heightLeft -= pageHeight;

  // 如果内容超过一页，添加更多页
  while (heightLeft > 0) {
    position -= pageHeight;
    pdf.addPage();
    pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;
  }

  // 下载 PDF
  const fileName = `${(plan.lessonTitle || "教案").replace(/[\\/:*?"<>|]/g, "")}.pdf`;
  pdf.save(fileName);
}
