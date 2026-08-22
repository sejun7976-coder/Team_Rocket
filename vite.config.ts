import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";
import { assertProductionSupabaseConfiguration } from "./src/lib/supabaseConfig";

export default defineConfig(({ command, mode }) => {
  const loadedEnvironment = loadEnv(mode, process.cwd(), "VITE_");
  const environment = {
    VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL ?? loadedEnvironment.VITE_SUPABASE_URL,
    VITE_SUPABASE_PUBLISHABLE_KEY:
      process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? loadedEnvironment.VITE_SUPABASE_PUBLISHABLE_KEY
  };
  if (command === "build" && mode === "production") {
    assertProductionSupabaseConfiguration(environment);
  }

  return {
    base: "./",
    plugins: [react()],
    server: { host: "127.0.0.1", port: 3000, strictPort: true },
    preview: { host: "127.0.0.1", port: 4173, strictPort: true },
    build: {
      target: "es2022",
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks: {
            react: ["react", "react-dom", "react-router-dom"],
            supabase: ["@supabase/supabase-js"],
            query: ["@tanstack/react-query", "zustand"],
            interaction: ["@dnd-kit/core"]
          }
        }
      }
    },
    test: {
      environment: "jsdom",
      setupFiles: ["./src/test/setup.ts"],
      coverage: { reporter: ["text", "html"], exclude: ["src/test/**"] }
    }
  };
});
