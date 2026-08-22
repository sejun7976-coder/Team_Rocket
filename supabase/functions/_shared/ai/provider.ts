import type { AIProvider } from "./configuration.ts";
import type { RocketAIResult } from "./schema.ts";
import { callAnthropic } from "./anthropic.ts";
import { callGoogle } from "./google.ts";
import { callOpenAI } from "./openai.ts";

export interface AIProviderRequest { apiKey: string; model: string; system: string; prompt: string; signal?: AbortSignal }
export interface AIProviderResponse { result: RocketAIResult; inputTokens: number | null; outputTokens: number | null }
export function callAIProvider(provider: AIProvider, input: AIProviderRequest): Promise<AIProviderResponse> {
  if (provider === "anthropic") return callAnthropic(input);
  if (provider === "google") return callGoogle(input);
  return callOpenAI(input);
}
