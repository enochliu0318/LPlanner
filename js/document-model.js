/* ============================================================
   document-model.js
   教案文档的共享结构模型——PDF 打印和 Word 导出共用同一套数据，
   确保两个输出 1:1 一致。
   ============================================================ */

/** 多行文本 → 数组（保留换行） */
function splitLines(text) {
  return String(text ?? "").split("\n").map(s => s.trim()).filter(Boolean);
}

/** 参考资料 → 纯文本（标签 + URL 分行） */
function buildRefText(references) {
  const rows = (references || []).filter(r => r.label || r.url);
  return rows.map(r => `${r.label || "资料"}${r.url ? "：" + r.url : ""}`).join("\n");
}

/** 讲稿内容：保留原始 HTML，不加中文数字编号 */
function contentWithNumbering(html) {
  if (!html || !html.trim()) return "";
  return html;
}

/** 讲稿内容：一级条目纯文本行（用于 Word，不加中文数字编号） */
function contentNumberedPlainLines(html) {
  if (!html || !html.trim()) return [];
  const container = document.createElement("div");
  container.innerHTML = html;
  const topLis = container.querySelectorAll(":scope > ul > li");
  const lines = [];
  topLis.forEach((li, i) => {
    const text = li.textContent.trim();
    if (text) {
      lines.push({ depth: 1, text: text });
    }
    // 子级条目
    const subUls = li.querySelectorAll(":scope > ul > li");
    subUls.forEach((subLi, j) => {
      const subText = subLi.textContent.trim();
      if (subText) {
        lines.push({ depth: 2, text: subText });
      }
    });
  });
  return lines;
}

/**
 * 构建教案文档结构（PDF / Word 共用）
 * @param {Object} plan - 教案数据对象
 * @returns {Object} 文档结构
 */
export function buildDocumentModel(plan) {
  return {
    title: "授课教案",
    info: [
      { label: "课程名称：", value: plan.courseName },
      { label: "课程类别：", value: plan.courseCategory },
      { label: "任课教师：", value: plan.teacher },
      { label: "任课时间：", value: plan.teachDate },
    ],
    lessonPlanBanner: "教案部分",
    lessonPlanRows: [
      { label: "课题", value: plan.lessonTitle },
      { label: "学时", value: String(plan.hours || "") },
      { label: "教学目标与要求", value: plan.objectives },
      { label: "重点", value: plan.keyPoints },
      { label: "难点", value: plan.difficultPoints },
      { label: "教学方法与手段", value: plan.methods },
      { label: "参考资料", value: buildRefText(plan.references) },
    ],
    lectureBanner: "讲稿部分",
    contentHtml: plan.contentHtml || "",
    contentNumberedHtml: contentWithNumbering(plan.contentHtml || ""),
    contentLines: contentNumberedPlainLines(plan.contentHtml || ""),
    remarks: plan.remarks,
    homework: splitLines(plan.homework),
    homeworkRaw: plan.homework,
    summary: plan.summary,
    references: (plan.references || []).filter(r => r.label || r.url),
  };
}
