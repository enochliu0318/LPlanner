/* ============================================================
    ai.js
    Simple AI chat - directly call Groq API
    ============================================================ */

const AI_STORAGE_KEY = "lesson_planner_ai_v5";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

// 系统提示：只说明身份，其余交给自然对话
export const AI_SYSTEM_PROMPT =
  "You are my lesson-planning assistant. I am an English teacher, and I use you while preparing my English classes. " +
  "Talk with me naturally like a normal AI assistant — no fixed format, no templates. " +
  "Help me with lesson plans, teaching content, classroom activities, vocabulary, exercises, and anything else I ask. " +
  "Reply in the same language I write in. " +
  "Always reply in PLAIN TEXT only: never use Markdown symbols (no **, *, #, `, bullet dashes like '- ' at line start). " +
  "Use plain line breaks for structure, and simple numbering (1. 2. 3.) when a list is needed.";

export const AI_MODELS = [
  { id: "qwen3.8-27b", name: "Qwen 3.8 27B", description: "推荐 / 中英文" },
  { id: "gpt-oss-120b", name: "GPT OSS 120B", description: "OpenAI 开源 / 强" },
  { id: "gpt-oss-20b", name: "GPT OSS 20B", description: "OpenAI 开源 / 快" },
  { id: "qwen3.6-27b", name: "Qwen 3.6 27B", description: "备选" },
  { id: "compound-mini", name: "Compound Mini", description: "轻量" },
];

export function getAiConfig() {
  try {
    const raw = localStorage.getItem(AI_STORAGE_KEY);
    if (!raw) return { apiKey: "", model: AI_MODELS[0].id };
    return JSON.parse(raw);
  } catch (err) {
    return { apiKey: "", model: AI_MODELS[0].id };
  }
}

export function saveAiConfig(config) {
  localStorage.setItem(AI_STORAGE_KEY, JSON.stringify(config));
}

/** 去掉常见 Markdown 符号，返回纯文本（双保险：即使模型没听话也兜底清理） */
function stripMarkdown(text) {
  return String(text ?? "")
    .replace(/```[\s\S]*?```/g, m => m.replace(/```\w*\n?/g, "")) // 代码块
    .replace(/`([^`]*)`/g, "$1")            // 行内代码
    .replace(/^#{1,6}\s+/gm, "")            // 标题 #
    .replace(/\*\*\*(.+?)\*\*\*/g, "$1")    // 粗斜体
    .replace(/\*\*(.+?)\*\*/g, "$1")        // 粗体
    .replace(/\*(.+?)\*/g, "$1")            // 斜体
    .replace(/__(.+?)__/g, "$1")            // 粗体
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")// 链接只留文字
    .replace(/^\s*[-*+]\s+/gm, "")          // 无序列表符号
    .replace(/^\s*>\s?/gm, "")              // 引用
    .replace(/^\s*[-—=_]{3,}\s*$/gm, "");   // 分隔线
}

export async function sendMessage(userMessage, history = []) {
  const config = getAiConfig();
  const headers = { "Content-Type": "application/json" };
  if (config.apiKey) headers["Authorization"] = `Bearer ${config.apiKey}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120000);

  try {
    const messages = [
      { role: "system", content: AI_SYSTEM_PROMPT },
      ...history,
      { role: "user", content: userMessage },
    ];
    const response = await fetch(GROQ_URL, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: config.model,
        messages,
        max_tokens: 2048,
        temperature: 0.7,
      }),
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error?.message || `API Error (${response.status})`);
    }

    const data = await response.json();
    if (data.choices && data.choices.length > 0) {
      return stripMarkdown(data.choices[0].message?.content || "");
    }
    return "No response";
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError") throw new Error("Request timeout");
    throw err;
  }
}