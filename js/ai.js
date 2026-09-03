/* ============================================================
    ai.js
    AI 辅助备课功能 —— 前端直接调用 Hugging Face Inference API
    （免费开源模型推理服务，无需后端服务器）

    支持的模型：
    - Qwen/Qwen2.5-72B-Instruct (中文能力强)
    - mistralai/Mistral-7B-Instruct-v0.3 (综合能力强)
    - meta-llama/Meta-Llama-3-8B-Instruct

    用户可在设置中填入自己的 Hugging Face API Key 以获得更高速率。
    免费的 API Key 在 https://huggingface.co/settings/tokens 创建。

    如果遇到网络错误，可开启"使用代理"选项。
    ============================================================ */

const AI_STORAGE_KEY = "lesson_planner_ai_v2";

// CORS 代理列表（用于解决浏览器跨域问题）
const CORS_PROXIES = [
  "https://corsproxy.io/?",
  "https://api.allorigins.win/raw?url=",
];

// 可用模型列表
export const AI_MODELS = [
  {
    id: "Qwen/Qwen2.5-72B-Instruct",
    name: "Qwen 2.5 72B（中文最佳）",
    description: "阿里巴巴开源，中文理解能力强",
  },
  {
    id: "mistralai/Mistral-7B-Instruct-v0.3",
    name: "Mistral 7B（综合能力）",
    description: "Mistral AI 开源，综合能力强",
  },
  {
    id: "meta-llama/Meta-Llama-3-8B-Instruct",
    name: "Llama 3 8B（英文最佳）",
    description: "Meta 开源，英文能力强",
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
    if (!raw) return { apiKey: "", model: AI_MODELS[0].id, useProxy: true };
    const config = JSON.parse(raw);
    // 确保 useProxy 有默认值
    if (config.useProxy === undefined) config.useProxy = true;
    return config;
  } catch (err) {
    return { apiKey: "", model: AI_MODELS[0].id, useProxy: true };
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

// 构建 API URL
function getApiUrl(model) {
  return `https://api-inference.huggingface.co/models/${model}`;
}

// 调用 Hugging Face Inference API
async function callHuggingFace(prompt, config) {
  const url = getApiUrl(config.model);
  const headers = { "Content-Type": "application/json" };
  if (config.apiKey) {
    headers["Authorization"] = `Bearer ${config.apiKey}`;
  }

  // 设置超时
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120000); // 120 秒超时

  const body = JSON.stringify({
    inputs: prompt,
    parameters: {
      max_new_tokens: 1024,
      temperature: 0.7,
      top_p: 0.9,
      do_sample: true,
    },
  });

  try {
    let response;

    if (config.useProxy) {
      // 使用 CORS 代理
      const proxyUrl = CORS_PROXIES[0] + encodeURIComponent(url);
      response = await fetch(proxyUrl, {
        method: "POST",
        headers,
        signal: controller.signal,
        body,
      });
    } else {
      // 直接调用
      response = await fetch(url, {
        method: "POST",
        headers,
        signal: controller.signal,
        body,
      });
    }

    clearTimeout(timeoutId);

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || `API 请求失败 (${response.status})`);
    }

    const data = await response.json();
    // Hugging Face 返回格式: [{ generated_text: "..." }]
    if (Array.isArray(data) && data.length > 0) {
      return data[0].generated_text || "";
    }
    return data.generated_text || JSON.stringify(data);
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError") {
      throw new Error("请求超时，请检查网络连接后重试");
    }
    if (err.message.includes("Failed to fetch") || err.message.includes("NetworkError")) {
      throw new Error("网络连接失败，请检查网络或开启代理后重试");
    }
    throw err;
  }
}

// 构建系统提示词
function buildSystemPrompt(feature, context = {}) {
  const prompts = {
    [AI_FEATURES.POLISH]: `你是一位专业的英语教案编辑。请对以下教学内容进行润色，使其更清晰、更专业。保持原意不变，优化语言表达。只输出润色后的内容，不要解释。`,

    [AI_FEATURES.EXPAND]: `你是一位专业的英语教案设计师。请根据以下教学主题，扩展和丰富教学内容。提供具体的教学步骤、活动和例子。用中文输出。`,

    [AI_FEATURES.GENERATE_OUTLINE]: `你是一位专业的英语教案设计师。请根据以下课程信息，生成一份详细的教学大纲（教学内容及过程）。

要求：
1. 按讲课顺序列出教学步骤
2. 每个步骤包含具体活动和时间分配
3. 使用项目符号列表格式（• 一级条目，◦ 二级条目）
4. 用中文输出`,

    [AI_FEATURES.GENERATE_OBJECTIVES]: `你是一位专业的英语教案设计师。请根据以下课程信息，生成3-5条具体、可衡量的教学目标。

要求：
1. 使用行为动词（如"学生能够..."）
2. 每条目标具体可衡量
3. 用中文输出，每条一行`,

    [AI_FEATURES.TRANSLATE]: `你是一位专业的英语教育翻译。请将以下教学内容在中英文之间翻译。保持教育专业术语的准确性。只输出翻译结果，不要解释。`,
  };

  return prompts[feature] || "";
}

// 构建用户提示词
function buildUserPrompt(feature, content, context = {}) {
  switch (feature) {
    case AI_FEATURES.POLISH:
      return `请润色以下教学内容：\n\n${content}`;

    case AI_FEATURES.EXPAND:
      return `教学主题：${context.lessonTitle || "未指定"}\n课程名称：${context.courseName || "未指定"}\n\n请扩展以下教学内容：\n\n${content}`;

    case AI_FEATURES.GENERATE_OUTLINE:
      return `课程名称：${context.courseName || "未指定"}\n课题：${context.lessonTitle || "未指定"}\n学时：${context.hours || "1"}\n\n请生成教学大纲：`;

    case AI_FEATURES.GENERATE_OBJECTIVES:
      return `课程名称：${context.courseName || "未指定"}\n课题：${context.lessonTitle || "未指定"}\n\n请生成教学目标：`;

    case AI_FEATURES.TRANSLATE:
      return `请翻译：\n\n${content}`;

    default:
      return content;
  }
}

// 调用 AI
export async function callAI(feature, content, context = {}) {
  const config = getAiConfig();
  const systemPrompt = buildSystemPrompt(feature, context);
  const userPrompt = buildUserPrompt(feature, content, context);

  // 构建完整提示词（Qwen 格式）
  const fullPrompt = `<|im_start|>system
${systemPrompt}
<|im_end|>
<|im_start|>user
${userPrompt}
<|im_end|>
<|im_start|>assistant
`;

  return callHuggingFace(fullPrompt, config);
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
