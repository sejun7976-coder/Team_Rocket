import { createClient } from "@supabase/supabase-js";
import { resolveSupabaseConfiguration } from "./supabaseConfig";

const configuration = resolveSupabaseConfiguration({
  VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
  VITE_SUPABASE_PUBLISHABLE_KEY: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
});

export const isSupabaseConfigured = configuration.configured;
export const supabaseConfigurationIssues = configuration.issues;

export const supabase = createClient(
  configuration.clientUrl,
  configuration.clientPublishableKey,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      flowType: "pkce"
    },
    realtime: { params: { eventsPerSecond: 10 } }
  }
);
