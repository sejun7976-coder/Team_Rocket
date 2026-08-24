import { useQuery } from "@tanstack/react-query";
import { listMyPermissions } from "../services/admin";
import { useAuthStore } from "../stores/authStore";
import type { Permission } from "../../supabase/functions/_shared/adminPermissions";

export const PERMISSIONS_QUERY_KEY = ["my-permissions"] as const;

export function usePermissions() {
  const user = useAuthStore((state) => state.user);
  const profile = useAuthStore((state) => state.profile);
  const active = Boolean(user && profile?.account_status === "active");
  const query = useQuery({
    queryKey: PERMISSIONS_QUERY_KEY,
    queryFn: listMyPermissions,
    enabled: active,
    staleTime: 30_000,
  });
  const permissions = query.data ?? [];
  return {
    ...query,
    permissions,
    has: (permission: Permission) => active && permissions.includes(permission),
  };
}
