/* ============================================================
   docx-export.js
   使用开源库 docx（https://github.com/dolanmiu/docx）在浏览器端
   生成 .docx 文件，通过 CDN 按需加载，不需要任何服务器或付费 API。
   排版目标：标准《授课教案》表格版式 —— A4 页面、宋体正文、
   细线表格、中文层级编号（一、/ 1. /（1）），与打印视图保持一致。
   ============================================================ */

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

/** 中文序号（一、二、三……），超出后回退为阿拉伯数字 */
const CN_NUM = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二", "十三", "十四", "十五"];

/** 把 yyyy-mm-dd 格式化为「yyyy 年 m 月 d 日」 */
function fmtCnDate(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d)) return iso;
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

export async function exportPlanToDocx(plan) {
  await ensureLibs();
  const docx = window.docx;
  const { Document, Paragraph, TextRun, Table, TableRow, TableCell, WidthType,
          AlignmentType, VerticalAlign, Packer } = docx;

  const PCT = WidthType.PERCENTAGE;
  // 中文文档经典搭配：西文 Times New Roman + 中文宋体；正文 12pt（size 单位为半磅）
  const FONT = { ascii: "Times New Roman", hAnsi: "Times New Roman", eastAsia: "宋体" };
  const CELL_MARGIN = { top: 80, bottom: 80, left: 140, right: 140 };

  const run = (text, opts = {}) =>
    new TextRun({ text: text ?? "", font: FONT, size: 24, ...opts });

  /** 多行文本 → 段落数组（保留换行） */
  const textParagraphs = (text, opts = {}) => {
    const lines = String(text ?? "").split("\n");
    const safe = lines.some(l => l.trim()) ? lines : [""];
    return safe.map(line => new Paragraph({
      spacing: { line: 340 },
      children: [run(line, opts)]
    }));
  };

  /** 表头单元格（灰底、加粗、居中） */
  const labelCell = (text, widthPct) => new TableCell({
    width: { size: widthPct, type: PCT },
    shading: { fill: "F5F5F5" },
    verticalAlign: VerticalAlign.CENTER,
    margins: CELL_MARGIN,
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [run(text, { bold: true })]
    })]
  });

  /** 内容单元格（可跨列），内容为段落数组 */
  const valueCell = (paragraphs, widthPct, span) => new TableCell({
    columnSpan: span,
    width: { size: widthPct, type: PCT },
    verticalAlign: VerticalAlign.CENTER,
    margins: CELL_MARGIN,
    children: paragraphs
  });

  /** 四列行：label | value | label | value */
  const row4 = (l1, v1, l2, v2) => new TableRow({
    children: [
      labelCell(l1, 14),
      valueCell(textParagraphs(v1), 36),
      labelCell(l2, 14),
      valueCell(textParagraphs(v2), 36)
    ]
  });

  /** 两列行：label | value（跨 3 列） */
  const row2 = (l, v) => new TableRow({
    children: [labelCell(l, 14), valueCell(textParagraphs(v), 86, 3)]
  });

  /**
   * 多级内容 → 带中文层级编号与缩进的段落。
   * 一级「一、」加粗顶格；二级「1.」缩进；三级「（1）」再缩进。
   * 高一级出现时，低一级序号归零。
   */
  const outlineParagraphs = () => {
    const blocks = (plan.content || []).filter(b => b.text);
    let c1 = 0, c2 = 0, c3 = 0;
    const paras = [];
    blocks.forEach(b => {
      const level = b.level || 1;
      let label;
      if (level === 2) { c2++; c3 = 0; label = `${c2}. `; }
      else if (level === 3) { c3++; label = `（${c3}）`; }
      else { c1++; c2 = 0; c3 = 0; label = `${CN_NUM[c1 - 1] || c1}、`; }
      paras.push(new Paragraph({
        indent: { left: (level - 1) * 480 },
        spacing: { line: 340, after: 60 },
        children: [run(label + b.text, { bold: level === 1 })]
      }));
    });
    if (paras.length === 0) {
      paras.push(new Paragraph({ children: [run("（暂无内容）")] }));
    }
    return paras;
  };

  const refRows = (plan.references || []).filter(r => r.label || r.url);
  const refText = refRows
    .map(r => `${r.label || "资料"}${r.url ? "：" + r.url : ""}`)
    .join("\n");

  const children = [];

  // 居中大标题
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 280 },
    children: [run("授  课  教  案", { bold: true, size: 36 })]
  }));

  // 基本信息表
  children.push(new Table({
    width: { size: 100, type: PCT },
    rows: [
      row4("课程名称", plan.courseName, "课程类别", plan.courseCategory),
      row4("任课教师", plan.teacher, "任课时间", fmtCnDate(plan.teachDate)),
      row2("课　　题", plan.lessonTitle),
      row2("学　　时", plan.hours ? `${plan.hours} 学时` : ""),
      row2("教学目标与要求", plan.objectives),
      row2("参考资料", refText)
    ]
  }));

  children.push(new Paragraph({ text: "", spacing: { after: 120 } }));

  // 教学内容及过程 + 备注
  const processRows = [
    new TableRow({
      children: [labelCell("教学内容及过程", 14), valueCell(outlineParagraphs(), 86, 3)]
    })
  ];
  if (plan.remarks && plan.remarks.trim()) {
    processRows.push(new TableRow({
      children: [labelCell("备注", 14), valueCell(textParagraphs(plan.remarks), 86, 3)]
    }));
  }
  children.push(new Table({ width: { size: 100, type: PCT }, rows: processRows }));

  children.push(new Paragraph({ text: "", spacing: { after: 120 } }));

  // 作业布置 / 课后小结
  children.push(new Table({
    width: { size: 100, type: PCT },
    rows: [
      row2("作业布置", plan.homework),
      row2("课后小结", plan.summary)
    ]
  }));

  // 签名栏
  children.push(new Paragraph({
    alignment: AlignmentType.RIGHT,
    spacing: { before: 360 },
    children: [run("教师签名：＿＿＿＿＿＿＿　　日期：＿＿＿＿＿＿＿")]
  }));

  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: FONT, size: 24 } }
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

  const blob = await Packer.toBlob(doc);
  const fileName = `${(plan.lessonTitle || "教案").replace(/[\\/:*?"<>|]/g, "")}.docx`;
  window.saveAs(blob, fileName);
}
