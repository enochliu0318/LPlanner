/* ============================================================
   docx-export.js
   使用开源库 docx（https://github.com/dolanmiu/docx）在浏览器端
   生成 .docx 文件，通过 CDN 按需加载，不需要任何服务器或付费 API。
   排版目标：1:1 复刻「长江大学教案模板」——大标题 + 加粗下划线
   信息行 + 灰底横幅 + 教案部分表格（含重点/难点/教学方法）+
   讲稿部分大表（左宽栏圆点讲稿 + 右侧贯通的备注列）。
   ============================================================ */

import { buildDocumentModel } from "./document-model.js?v=23";

const DOCX_CDN = "https://unpkg.com/docx@8.5.0/build/index.umd.js";
const DOCX_CDN_FALLBACK = "https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js";
const FILESAVER_CDN = "https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/2.0.5/FileSaver.min.js";

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

/** 依次尝试多个 CDN，全部失败才抛错 */
async function loadScriptWithFallback(urls) {
  let lastErr = null;
  for (const url of urls) {
    try {
      await loadScript(url);
      return;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

async function ensureLibs() {
  if (!window.docx) {
    await loadScriptWithFallback([DOCX_CDN, DOCX_CDN_FALLBACK]);
    if (!window.docx) throw new Error("docx 组件加载失败，请检查网络后重试。");
  }
  if (!window.saveAs) await loadScript(FILESAVER_CDN);
}

/** 多级讲稿的圆点符号（与模板一致） */
const BULLET = { 1: "• ", 2: "◦ ", 3: "▪ " };

export async function exportPlanToDocx(plan) {
  await ensureLibs();
  const docx = window.docx;
  const { Document, Paragraph, TextRun, Table, TableRow, TableCell, WidthType,
          AlignmentType, VerticalAlign, ShadingType, TableLayoutType, Packer } = docx;

  // 使用共享文档模型，确保与 PDF 打印 1:1 一致
  const doc = buildDocumentModel(plan);

  const PCT = WidthType.PERCENTAGE;
  const DXA = WidthType.DXA;
  // A4 宽 11906，减左右 2cm(1134+1134) 后正文可用宽 9638 twips
  const PAGE_W = 9638;
  const W = (tw) => ({ size: tw, type: DXA });
  // 教案表：标签 15% / 内容 85%；讲稿表：内容 80% / 备注 20%
  const INFO_LABEL_W = 1446, INFO_VALUE_W = PAGE_W - 1446;
  const PROC_CONTENT_W = Math.round(PAGE_W * 0.80), PROC_REMARK_W = PAGE_W - PROC_CONTENT_W;
  // 中文文档经典搭配：西文 Times New Roman + 中文宋体；正文 11pt（size 单位为半磅）
  const FONT = { ascii: "Times New Roman", hAnsi: "Times New Roman", eastAsia: "宋体" };
  const CELL_MARGIN = { top: 60, bottom: 60, left: 140, right: 140 };

  const run = (text, opts = {}) =>
    new TextRun({ text: text ?? "", font: FONT, size: 22, ...opts });

  /** 多行文本 → 段落数组（保留换行） */
  const textParagraphs = (text, opts = {}) => {
    const lines = String(text ?? "").split("\n");
    const safe = lines.some(l => l.trim()) ? lines : [""];
    return safe.map(line => new Paragraph({
      spacing: { line: 320 },
      children: [run(line, opts)]
    }));
  };

  /** 作业布置等条目 → 「• 内容」悬挂缩进段落 */
  const bulletParagraphs = (lines) => {
    if (!lines.length) return textParagraphs("");
    return lines.map(line => new Paragraph({
      indent: { left: 320, hanging: 240 },
      spacing: { line: 320, after: 40 },
      children: [run("• " + line)]
    }));
  };

  /** 讲稿大纲 → 使用共享模型的 contentLines（与 PDF 编号一致） */
  const outlineParagraphs = () => {
    if (!doc.contentLines.length) return textParagraphs("（暂无内容）");
    return doc.contentLines.map(item => {
      const prefix = item.depth === 1
        ? run(item.text.split("、")[0] + "、", { bold: true })
        : run(BULLET[item.depth] || "• ");
      const text = item.depth === 1 ? item.text.split("、").slice(1).join("、").trim() : item.text;
      return new Paragraph({
        indent: { left: (item.depth - 1) * 360 + 280, hanging: 240 },
        spacing: { line: 320, after: 40 },
        children: [prefix, run(text || " ")]
      });
    });
  };

  /** 标签格式化：短标签加全角空格对齐（如"课题"→"课　题"） */
  const formatLabel = (label) => {
    const map = { "课题": "课　题", "学时": "学　时", "重点": "重　点", "难点": "难　点" };
    return map[label] || label;
  };

  /** 表格标签单元格（居中，模板中不加粗） */
  const labelCell = (text, tw) => new TableCell({
    width: W(tw),
    verticalAlign: VerticalAlign.CENTER,
    margins: CELL_MARGIN,
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [run(formatLabel(text))]
    })]
  });

  /** 内容单元格（可跨列合并） */
  const valueCell = (paragraphs, tw, span) => new TableCell({
    columnSpan: span,
    width: W(tw),
    verticalAlign: VerticalAlign.TOP,
    margins: CELL_MARGIN,
    children: paragraphs
  });

  /** 简单单元格（作业布置/课后小结的标签行、备注空列） */
  const simpleCell = (paragraphs, tw) => new TableCell({
    width: W(tw),
    verticalAlign: VerticalAlign.CENTER,
    margins: CELL_MARGIN,
    children: paragraphs
  });

  /** 灰底横幅段落（模拟模板的斜纹分隔条） */
  const banner = (text, breakBefore) => new Paragraph({
    shading: { type: ShadingType.CLEAR, fill: "ECECEC" },
    pageBreakBefore: !!breakBefore,
    spacing: { before: 200, after: 200 },
    children: [run("● " + text, { size: 21 })]
  });

  /** 标题下的信息行：标签 + 加粗下划线的值 */
  const infoLine = (label, value) => new Paragraph({
    indent: { left: 1440 },
    spacing: { after: 240 },
    children: [
      run(label, { size: 28 }),
      run(value || "", { bold: true, size: 28, underline: {} })
    ]
  });

  const children = [];

  // 大标题
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 400, after: 800 },
    children: [run("授  课  教  案", { bold: true, size: 72 })]
  }));

  // 信息行（使用共享模型）
  doc.info.forEach(i => children.push(infoLine(i.label, i.value)));

  // 教案部分（使用共享模型）
  children.push(banner(doc.lessonPlanBanner));
  children.push(new Table({
    width: { size: PAGE_W, type: DXA },
    layout: TableLayoutType.FIXED,
    columnWidths: [INFO_LABEL_W, INFO_VALUE_W],
    rows: doc.lessonPlanRows.map(r =>
      new TableRow({
        children: [
          labelCell(r.label, INFO_LABEL_W),
          valueCell(textParagraphs(r.value), INFO_VALUE_W)
        ]
      })
    )
  }));

  // 讲稿部分（另起一页，使用共享模型）
  children.push(banner(doc.lectureBanner, true));
  const emptyRemark = parts => simpleCell(parts, PROC_REMARK_W);
  children.push(new Table({
    width: { size: PAGE_W, type: DXA },
    layout: TableLayoutType.FIXED,
    columnWidths: [PROC_CONTENT_W, PROC_REMARK_W],
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: W(PROC_CONTENT_W),
            verticalAlign: VerticalAlign.CENTER,
            margins: CELL_MARGIN,
            children: [new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [run("教学内容及过程", { size: 28 })]
            })]
          }),
          new TableCell({
            width: W(PROC_REMARK_W),
            verticalAlign: VerticalAlign.CENTER,
            margins: CELL_MARGIN,
            children: [new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [run("备注", { size: 28 })]
            })]
          })
        ]
      }),
      new TableRow({
        children: [
          valueCell(outlineParagraphs(), PROC_CONTENT_W),
          valueCell(textParagraphs(doc.remarks), PROC_REMARK_W)
        ]
      }),
      new TableRow({
        children: [
          simpleCell([new Paragraph({ children: [run("作业布置")] })], PROC_CONTENT_W),
          emptyRemark([])
        ]
      }),
      new TableRow({
        children: [valueCell(bulletParagraphs(doc.homework), PROC_CONTENT_W), emptyRemark([])]
      }),
      new TableRow({
        children: [
          simpleCell([new Paragraph({ children: [run("课后小结")] })], PROC_CONTENT_W),
          emptyRemark([])
        ]
      }),
      new TableRow({
        children: [
          valueCell(
            textParagraphs(doc.summary).concat([new Paragraph({ text: "" }), new Paragraph({ text: "" })]),
            PROC_CONTENT_W
          ),
          emptyRemark([])
        ]
      })
    ]
  }));

  const document = new Document({
    styles: {
      default: {
        document: { run: { font: FONT, size: 22 } }
      }
    },
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 },                      // A4
          margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 } // 2cm
        }
      },
      children
    }]
  });

  const blob = await Packer.toBlob(document);
  const fileName = `${(doc.lessonPlanRows[0].value || "教案").replace(/[\\/:*?"<>|]/g, "")}.docx`;
  window.saveAs(blob, fileName);
}