import { MAX_FILE_BYTES } from "../crypto";

const BLOCKED_EXTENSIONS = new Set(["exe", "bat", "cmd", "com", "msi", "ps1", "psm1", "scr", "vbs", "vbe", "js", "jse", "jar", "sh", "app", "dmg"]);
const BLOCKED_MIME_TYPES = new Set([
  "application/x-msdownload", "application/x-msdos-program", "application/x-bat",
  "application/x-sh", "application/java-archive"
]);
const MIME_BY_EXTENSION: Record<string, string> = {
  txt: "text/plain", md: "text/markdown", csv: "text/csv", json: "application/json", pdf: "application/pdf",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", zip: "application/zip"
};

export { MAX_FILE_BYTES };

export function validateProjectFile(file: Pick<File, "name" | "size" | "type">): void {
  const extension = file.name.toLowerCase().split(".").pop() ?? "";
  if (BLOCKED_EXTENSIONS.has(extension) || BLOCKED_MIME_TYPES.has(file.type.toLowerCase())) {
    throw new Error("실행 가능한 파일 형식은 업로드할 수 없습니다.");
  }
  if (file.size <= 0) throw new Error("빈 파일은 업로드할 수 없습니다.");
  if (file.size > MAX_FILE_BYTES) throw new Error("파일은 50 MiB 이하여야 합니다.");
}

export function projectFileMimeType(file: Pick<File, "name" | "type">): string {
  const extension = file.name.toLowerCase().split(".").pop() ?? "";
  return file.type.trim().toLowerCase() || MIME_BY_EXTENSION[extension] || "application/octet-stream";
}

export function canPreviewInBrowser(mimeType: string): boolean {
  return /^(image\/(?:png|jpeg|webp)|text\/|application\/(?:pdf|json))/u.test(mimeType);
}
