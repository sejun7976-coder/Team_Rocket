import { supabase } from "../lib/supabase";
import type { Activity, Notification } from "../types/domain";

export async function listActivities(projectId?: string): Promise<Activity[]> {
  let query = supabase
    .from("activities")
    .select("*, actor:profiles!activities_actor_id_fkey(id, name, avatar_url), project:projects!activities_project_id_fkey(id, name)")
    .order("created_at", { ascending: false })
    .limit(100);
  if (projectId) query = query.eq("project_id", projectId);
  const { data, error } = await query;
  if (error) throw new Error("활동 기록을 불러올 수 없습니다.");
  return (data ?? []) as unknown as Activity[];
}

export async function listProjectActivities(projectId: string): Promise<Activity[]> {
  if (!projectId.trim()) throw new Error("프로젝트 ID가 필요합니다.");
  return listActivities(projectId);
}

export async function listNotifications(): Promise<Notification[]> {
  await supabase.rpc("refresh_due_notifications");
  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error("알림을 불러올 수 없습니다.");
  return (data ?? []) as Notification[];
}

export async function markAllNotificationsRead(): Promise<void> {
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .is("read_at", null);
  if (error) throw new Error("알림을 모두 읽음 처리할 수 없습니다.");
}

export async function markNotificationRead(id: string): Promise<void> {
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error("알림을 읽음 처리할 수 없습니다.");
}
