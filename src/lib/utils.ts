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
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / 1024 ** 2).toFixed(1)} MiB`;
}

export function initials(name: string): string {
  return name.trim().split(/\s+/u).map((part) => part[0] ?? "").join("").slice(0, 2).toUpperCase() || "?";
}
