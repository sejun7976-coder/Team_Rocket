import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function studentIdToInternalEmail(studentId: string): string {
  const normalized = studentId.trim();
  if (!/^[0-9]{6,12}$/u.test(normalized)) throw new Error("학번은 숫자 6~12자리여야 합니다.");
  return `${normalized}@project-manager.local`;
}

export function repositorySlug(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 100);
}

export function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"] as const;
  const index = Math.min(
    Math.floor(Math.log(value) / Math.log(1024)),
    units.length - 1,
  );
  const size = value / 1024 ** index;
  return `${size.toFixed(index === 0 || size >= 10 ? 0 : 1)} ${units[index]}`;
}

export function initials(name: string): string {
  return name.trim().split(/\s+/u).map((part) => part[0] ?? "").join("").slice(0, 2).toUpperCase() || "?";
}
