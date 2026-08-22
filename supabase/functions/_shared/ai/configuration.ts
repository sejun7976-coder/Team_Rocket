import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { ApiError } from "../http.ts";

export interface StoredAIGateway {
  enabled: boolean;
  base_url: string | null;
  api_key_ciphertext: string | null;
  api_key_iv: string | null;
  updated_at: string;
}
export interface StoredAIModel {
  id: string;
  family: string;
  model_id: string;
  display_name: string;
  enabled: boolean;
  is_default: boolean;
  sort_order: number;
  is_builtin: boolean;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  try {
    return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
  } catch {
    throw new ApiError(500, "AI_MASTER_KEY_INVALID", "AI master key 설정이 올바르지 않습니다.");
  }
}

async function masterKey(): Promise<CryptoKey> {
  const secret = Deno.env.get("AI_CONFIG_MASTER_KEY")?.trim();
  if (!secret) throw new ApiError(500, "AI_MASTER_KEY_MISSING", "AI master key가 설정되지 않았습니다.");
  const bytes = base64UrlToBytes(secret);
  if (bytes.length !== 32) throw new ApiError(500, "AI_MASTER_KEY_INVALID", "AI master key 설정이 올바르지 않습니다.");
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptGatewayKey(value: string): Promise<{ ciphertext: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await masterKey(), new TextEncoder().encode(value));
  return { ciphertext: bytesToBase64Url(new Uint8Array(encrypted)), iv: bytesToBase64Url(iv) };
}

export async function decryptGatewayKey(ciphertext: string, iv: string): Promise<string> {
  try {
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64UrlToBytes(iv) }, await masterKey(), base64UrlToBytes(ciphertext));
    return new TextDecoder("utf-8", { fatal: true }).decode(decrypted);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, "AI_KEY_DECRYPT_FAILED", "AI Gateway API Key를 사용할 수 없습니다.");
  }
}

export async function loadAIGateway(admin: SupabaseClient): Promise<StoredAIGateway | null> {
  const { data, error } = await admin.from("ai_gateway_settings").select("enabled, base_url, api_key_ciphertext, api_key_iv, updated_at").eq("singleton", true).maybeSingle();
  if (error) throw new ApiError(500, "AI_CONFIGURATION_FAILED", "AI Gateway 설정을 확인할 수 없습니다.");
  return data as StoredAIGateway | null;
}

export async function loadAIModel(admin: SupabaseClient, id: string): Promise<StoredAIModel | null> {
  const { data, error } = await admin.from("ai_model_settings").select("id, family, model_id, display_name, enabled, is_default, sort_order, is_builtin").eq("id", id).maybeSingle();
  if (error) throw new ApiError(500, "AI_CONFIGURATION_FAILED", "AI 모델 설정을 확인할 수 없습니다.");
  return data as StoredAIModel | null;
}
