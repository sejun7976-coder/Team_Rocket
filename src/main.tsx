import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { ConfigurationErrorScreen } from "./components/ConfigurationErrorScreen";
import { isSupabaseConfigured, supabaseConfigurationIssues } from "./lib/supabase";
import { initializeThemePreference } from "./stores/themeStore";
import "./styles.css";

initializeThemePreference();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: true },
    mutations: { retry: 0 }
  }
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isSupabaseConfigured
      ? <QueryClientProvider client={queryClient}><App /></QueryClientProvider>
      : <ConfigurationErrorScreen issues={supabaseConfigurationIssues} />}
  </React.StrictMode>
);
