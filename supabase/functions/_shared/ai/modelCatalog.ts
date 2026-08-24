export type AIModelFamily =
  | "openai"
  | "claude"
  | "gemini"
  | "grok"
  | "gemma"
  | "perplexity"
  | "upstage"
  | "exaone"
  | "qwen"
  | "glm"
  | "kimi"
  | "seed"
  | "deepseek";

export interface AIModelDefinition {
  id: string;
  displayName: string;
  family: AIModelFamily;
  sortOrder: number;
}

export const AI_MODEL_CATALOG = [
  { id: "gpt-5.6-luna", displayName: "GPT-5.6 Luna", family: "openai", sortOrder: 10 },
  { id: "gpt-5.6-terra", displayName: "GPT-5.6 Terra", family: "openai", sortOrder: 20 },
  { id: "gpt-5.6-sol", displayName: "GPT-5.6 Sol", family: "openai", sortOrder: 30 },
  { id: "gpt-5.5", displayName: "GPT-5.5", family: "openai", sortOrder: 40 },
  { id: "claude-sonnet-5", displayName: "Claude Sonnet 5", family: "claude", sortOrder: 110 },
  { id: "claude-opus-5", displayName: "Claude Opus 5", family: "claude", sortOrder: 120 },
  { id: "claude-fable-5", displayName: "Claude Fable 5", family: "claude", sortOrder: 130 },
  { id: "claude-opus-4-8", displayName: "Claude 4.8 Opus", family: "claude", sortOrder: 140 },
  { id: "claude-haiku-4-5-20251001", displayName: "Claude 4.5 Haiku", family: "claude", sortOrder: 150 },
  { id: "gemini-3.7-flash", displayName: "Gemini 3.7 Flash", family: "gemini", sortOrder: 210 },
  { id: "gemini-3.6-flash", displayName: "Gemini 3.6 Flash", family: "gemini", sortOrder: 220 },
  { id: "gemini-3.5-flash", displayName: "Gemini 3.5 Flash", family: "gemini", sortOrder: 230 },
  { id: "gemini-3.5-flash-lite", displayName: "Gemini 3.5 Flash-Lite", family: "gemini", sortOrder: 240 },
  { id: "gemini-3.1-pro-preview", displayName: "Gemini 3.1 Pro", family: "gemini", sortOrder: 250 },
  { id: "grok-4.6", displayName: "Grok 4.6", family: "grok", sortOrder: 310 },
  { id: "grok-4.5", displayName: "Grok 4.5", family: "grok", sortOrder: 320 },
  { id: "grok-4-1-fast", displayName: "Grok 4.1 Fast", family: "grok", sortOrder: 330 },
  { id: "google/gemma-4-31B-it", displayName: "Gemma 4", family: "gemma", sortOrder: 410 },
  { id: "sonar-pro", displayName: "Sonar Pro", family: "perplexity", sortOrder: 510 },
  { id: "sonar-reasoning-pro", displayName: "Sonar Reasoning Pro", family: "perplexity", sortOrder: 520 },
  { id: "solar-pro4", displayName: "Solar Pro 4", family: "upstage", sortOrder: 610 },
  { id: "LGAI-EXAONE/K-EXAONE-2.0-750B-A37B", displayName: "K-EXAONE 2.0", family: "exaone", sortOrder: 710 },
  { id: "qwen3.8-max", displayName: "Qwen 3.8 Max", family: "qwen", sortOrder: 810 },
  { id: "qwen3.7-plus", displayName: "Qwen 3.7 Plus", family: "qwen", sortOrder: 820 },
  { id: "qwen3.7-max", displayName: "Qwen 3.7 Max", family: "qwen", sortOrder: 830 },
  { id: "glm-5.2", displayName: "GLM-5.2", family: "glm", sortOrder: 910 },
  { id: "kimi-k3", displayName: "Kimi K3", family: "kimi", sortOrder: 1010 },
  { id: "kimi-k2.6", displayName: "Kimi K2.6", family: "kimi", sortOrder: 1020 },
  { id: "seed-2-0-pro-260328", displayName: "Seed 2.0 Pro", family: "seed", sortOrder: 1110 },
  { id: "seed-2-0-lite-260428", displayName: "Seed 2.0 Lite", family: "seed", sortOrder: 1120 },
  { id: "deepseek-v4-pro", displayName: "DeepSeek V4 Pro", family: "deepseek", sortOrder: 1210 },
  { id: "deepseek-v4-flash", displayName: "DeepSeek V4 Flash", family: "deepseek", sortOrder: 1220 },
] as const satisfies readonly AIModelDefinition[];

export type AIModelId = (typeof AI_MODEL_CATALOG)[number]["id"];

const MODEL_BY_ID = new Map<string, AIModelDefinition>(
  AI_MODEL_CATALOG.map((model) => [model.id, model]),
);

export function findAIModel(modelId: unknown): AIModelDefinition | null {
  return typeof modelId === "string" ? MODEL_BY_ID.get(modelId) ?? null : null;
}
