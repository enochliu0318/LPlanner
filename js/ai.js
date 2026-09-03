/* ============================================================
    ai.js
    AI 辅助备课功能 —— 前端直接调用 Groq API
    （免费开源模型推理服务，无需后端服务器）

    Groq 提供免费的高速推理服务，支持 CORS，可直接在浏览器调用。
    免费模型推荐：
    - llama-3.3-70b-versatile（Meta，综合能力强）
    - llama-3.1-8b-instant（Meta，速度快）
    - gemma2-9b-it（Google）

    用户可在设置中填入自己的 Groq API Key 以获得更高速率。
    免费的 API Key 在 https://console.groq.com/keys 创建。
    ============================================================ */

const AI_STORAGE_KEY = "lesson_planner_ai_v4";

// Groq API 端点
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

// 可用模型列表（免费模型 - 更新于 2025-09-03）
// 注意：Groq 会定期更新模型，如果某个模型不可用，
// 请访问 https://console.groq.com/playground 查看最新可用模型
export const AI_MODELS = [
  {
    id: "qwen3.8-27b",
    name: "Qwen 3.8 27B（推荐）",
    description: "阿里巴巴开源，中文能力强",
  },
  {
    id: "qwen3.6-27b",
    name: "Qwen 3.6 27B",
    description: "阿里巴巴开源",
  },
  {
    id: "gpt-oss-120b",
    name: "GPT OSS 120B",
    description: "OpenAI 开源，综合能力强",
  },
  {
    id: "gpt-oss20b",
    name: "GPT OSS 20B",
    description: "OpenAI 开源，速度较快",
  },
  {
    id: "compound",
    name: "Compound",
    description: "复合模型",
  },
  {
    id: "compound-mini",
    name: "Compound Mini",
    description: "复合模型（轻量）",
  },
];

// AI 功能类型
export const AI_FEATURES = {
  POLISH: "polish",
  EXPAND: "expand",
  GENERATE_OUTLINE: "generate_outline",
  GENERATE_OBJECTIVES: "generate_objectives",
  TRANSLATE: "translate",
};

// 获取 AI 配置
export function getAiConfig() {
  try {
    const raw = localStorage.getItem(AI_STORAGE_KEY);
    if (!raw) return { apiKey: "", model: AI_MODELS[0].id };
    return JSON.parse(raw);
  } catch (err) {
    return { apiKey: "", model: AI_MODELS[0].id };
  }
}

// 保存 AI 配置
export function saveAiConfig(config) {
  try {
    localStorage.setItem(AI_STORAGE_KEY, JSON.stringify(config));
    return true;
  } catch (err) {
    return false;
  }
}

// 调用 Groq API
async function callGroq(systemPrompt, userPrompt, config) {
  const headers = { "Content-Type": "application/json" };
  if (config.apiKey) {
    headers["Authorization"] = `Bearer ${config.apiKey}`;
  }

  // 设置超时
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120000); // 120 秒超时

  try {
    const response = await fetch(GROQ_URL, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 1024,
        temperature: 0.7,
        top_p: 0.9,
      }),
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error?.message || `API 请求失败 (${response.status})`);
    }

    const data = await response.json();
    // Groq 返回格式与 OpenAI 兼容: { choices: [{ message: { content: "..." } }] }
    if (data.choices && data.choices.length > 0) {
      return data.choices[0].message?.content || "";
    }
    return JSON.stringify(data);
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError") {
      throw new Error("请求超时，请检查网络连接后重试");
    }
    if (err.message.includes("Failed to fetch") || err.message.includes("NetworkError")) {
      throw new Error("网络连接失败，请检查网络后重试");
    }
    throw err;
  }
}

// 构建系统提示词（全部使用英文输出）
function buildSystemPrompt(feature, context = {}) {
  const prompts = {
    [AI_FEATURES.POLISH]: `You are a professional English lesson plan editor. Polish the following teaching content to make it clearer and more professional. Keep the original meaning intact, optimize language expression. Output only the polished content without explanation. Output in English.`,

    [AI_FEATURES.EXPAND]: `You are a professional English lesson plan designer. Based on the following teaching topic, expand and enrich the content. Provide specific teaching steps, activities, and examples. Output in English.`,

    [AI_FEATURES.GENERATE_OUTLINE]: `You are a professional English lesson plan designer. Based on the following course information, generate a detailed teaching outline (teaching content and process).

Requirements:
1. List teaching steps in lecture order
2. Each step includes specific activities and time allocation
3. Use bullet point format (• main items, ◦ sub-items)
4. Output in English`,

    [AI_FEATURES.GENERATE_OBJECTIVES]: `You are a professional English lesson plan designer. Based on the following course information, generate 3-5 specific, measurable learning objectives.

Requirements:
1. Use action verbs (e.g., "Students will be able to...")
2. Each objective should be specific and measurable
3. Output in English, one per line`,
  };

  return prompts[feature] || "";
}

// 构建用户提示词（英文）
function buildUserPrompt(feature, content, context = {}) {
  switch (feature) {
    case AI_FEATURES.POLISH:
      return `Please polish the following teaching content:\n\n${content}`;

    case AI_FEATURES.EXPAND:
      return `Lesson title: ${context.lessonTitle || "Not specified"}\nCourse: ${context.courseName || "Not specified"}\n\nPlease expand the following content:\n\n${content}`;

    case AI_FEATURES.GENERATE_OUTLINE:
      return `Course: ${context.courseName || "Not specified"}\nLesson: ${context.lessonTitle || "Not specified"}\nHours: ${context.hours || "1"}\n\nGenerate a teaching outline:`;

    case AI_FEATURES.GENERATE_OBJECTIVES:
      return `Course: ${context.courseName || "Not specified"}\nLesson: ${context.lessonTitle || "Not specified"}\n\nGenerate learning objectives:`;

    default:
      return content;
  }
}

// 调用 AI
export async function callAI(feature, content, context = {}) {
  const config = getAiConfig();
  const systemPrompt = buildSystemPrompt(feature, context);
  const userPrompt = buildUserPrompt(feature, content, context);

  return callGroq(systemPrompt, userPrompt, config);
}

// 内容润色
export async function polishContent(content) {
  return callAI(AI_FEATURES.POLISH, content);
}

// 内容扩展
export async function expandContent(content, context) {
  return callAI(AI_FEATURES.EXPAND, content, context);
}

// 生成教学大纲
export async function generateOutline(context) {
  return callAI(AI_FEATURES.GENERATE_OUTLINE, "", context);
}

// 生成教学目标
export async function generateObjectives(context) {
  return callAI(AI_FEATURES.GENERATE_OBJECTIVES, "", context);
}

// 翻译
export async function translateContent(content) {
  return callAI(AI_FEATURES.TRANSLATE, content);
}