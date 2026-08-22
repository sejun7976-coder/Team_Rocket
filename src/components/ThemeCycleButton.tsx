import { Monitor, Moon, Sun } from "lucide-react";
import { useThemeStore } from "../stores/themeStore";
import { cn } from "../lib/utils";

export function ThemeCycleButton({ className, showLabel = true }: { className?: string; showLabel?: boolean }) {
  const preference = useThemeStore((state) => state.preference);
  const cyclePreference = useThemeStore((state) => state.cyclePreference);
  const Icon = preference === "light" ? Sun : preference === "dark" ? Moon : Monitor;
  const label = preference === "light" ? "라이트" : preference === "dark" ? "다크" : "시스템";
  return <button type="button" aria-label={`현재 테마: ${label}. 다음 테마로 변경`} title={`테마: ${label}`} onClick={cyclePreference} className={cn("inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-line px-2.5 text-sm font-semibold text-muted transition hover:bg-raised hover:text-ink", className)}><Icon size={17} />{showLabel && <span>{label}</span>}</button>;
}
