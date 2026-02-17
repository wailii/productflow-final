export const AI_PROVIDER_IDS = [
  "qwen",
  "kimi",
  "zhipu",
  "qingyan",
  "minimax",
  "doubao",
  "openrouter",
  "siliconflow",
  "ai302",
  "custom",
] as const;

export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

export type AiProviderPreset = {
  id: AiProviderId;
  label: string;
  category: "domestic" | "integrator" | "custom";
  description: string;
  defaultBaseUrl: string;
  defaultModel: string;
  docsUrl?: string;
};

export const AI_PROVIDER_PRESETS: AiProviderPreset[] = [
  {
    id: "qwen",
    label: "通义千问 (Qwen)",
    category: "domestic",
    description: "阿里云百炼 OpenAI 兼容接口。",
    defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-plus",
    docsUrl:
      "https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope",
  },
  {
    id: "kimi",
    label: "Kimi (Moonshot)",
    category: "domestic",
    description: "Moonshot OpenAI 兼容接口。",
    defaultBaseUrl: "https://api.moonshot.cn/v1",
    defaultModel: "moonshot-v1-128k",
    docsUrl: "https://platform.moonshot.cn/docs",
  },
  {
    id: "zhipu",
    label: "智谱 AI (GLM)",
    category: "domestic",
    description: "智谱 GLM OpenAI 兼容接口。",
    defaultBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
    defaultModel: "glm-4-plus",
    docsUrl: "https://open.bigmodel.cn/dev/api#glm-4.5",
  },
  {
    id: "qingyan",
    label: "文心一言 / 清言",
    category: "domestic",
    description: "百度千帆兼容 OpenAI 风格接口。",
    defaultBaseUrl: "https://qianfan.baidubce.com/v2",
    defaultModel: "ernie-4.0-8k",
    docsUrl: "https://cloud.baidu.com/doc/WENXINWORKSHOP/s/hlrk4akp7",
  },
  {
    id: "minimax",
    label: "MiniMax",
    category: "domestic",
    description: "MiniMax OpenAI 兼容模式（如已开通）。",
    defaultBaseUrl: "https://api.minimax.chat/v1",
    defaultModel: "MiniMax-Text-01",
    docsUrl: "https://www.minimaxi.com/document",
  },
  {
    id: "doubao",
    label: "豆包 (火山方舟)",
    category: "domestic",
    description: "火山方舟 OpenAI 兼容接口（可切换 Doubao 模型）。",
    defaultBaseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    defaultModel: "doubao-1-5-pro-32k-250115",
    docsUrl: "https://www.volcengine.com/docs/82379/1298454",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    category: "integrator",
    description: "聚合多家模型供应商的 OpenAI 兼容接口。",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "deepseek/deepseek-chat-v3-0324",
    docsUrl: "https://openrouter.ai/docs",
  },
  {
    id: "siliconflow",
    label: "硅基流动 (SiliconFlow)",
    category: "integrator",
    description: "兼容 OpenAI 接口，可选国内外多模型。",
    defaultBaseUrl: "https://api.siliconflow.cn/v1",
    defaultModel: "Qwen/Qwen3-235B-A22B-Instruct-2507",
    docsUrl: "https://docs.siliconflow.cn/cn/api-reference/chat-completions/chat-completions",
  },
  {
    id: "ai302",
    label: "302.AI",
    category: "integrator",
    description: "多模型聚合平台，支持 OpenAI 兼容调用。",
    defaultBaseUrl: "https://api.302.ai/v1",
    defaultModel: "gpt-4o-mini",
    docsUrl: "https://doc.302.ai/api-reference/openai-chat-completion",
  },
  {
    id: "custom",
    label: "自定义 OpenAI 兼容",
    category: "custom",
    description: "填写任意兼容 /chat/completions 的网关。",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    docsUrl: "https://platform.openai.com/docs/api-reference/chat/create",
  },
];

export const AI_PROVIDER_PRESET_MAP = Object.fromEntries(
  AI_PROVIDER_PRESETS.map((preset) => [preset.id, preset])
) as Record<AiProviderId, AiProviderPreset>;
