import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "../lib/supabase";

const TABLES = ["projects", "project_members", "tasks", "task_assignees", "task_checklist_items", "comments", "activities", "files", "github_sync_jobs"] as const;

export function useProjectRealtime(projectId: string | undefined): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!projectId) return;
    let channel = supabase.channel(`project:${projectId}`, { config: { private: true } });
    for (const table of TABLES) {
      const filter = table === "projects"
        ? `id=eq.${projectId}`
        : ["project_members", "tasks", "activities", "files", "github_sync_jobs"].includes(table)
          ? `project_id=eq.${projectId}`
          : undefined;
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table, ...(filter ? { filter } : {}) },
        () => { void queryClient.invalidateQueries({ predicate: (query) => query.queryKey.includes(projectId) }); }
      );
    }
    channel.subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [projectId, queryClient]);
}
