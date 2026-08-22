import { decryptContent, decryptFile, encryptContent, encryptFile } from "../crypto";
import { supabase } from "../lib/supabase";
import { useAuthStore } from "../stores/authStore";
import { useProjectKeyStore } from "../stores/projectKeyStore";
import type { ProjectFile } from "../types/domain";
import { projectFileMimeType, validateProjectFile } from "../lib/filePolicy";

export async function listFiles(projectId: string): Promise<ProjectFile[]> {
  const key = await useProjectKeyStore.getState().unlock(projectId);
  const { data, error } = await supabase.from("files").select(
    "*, uploader:profiles!files_uploaded_by_fkey(id, name, avatar_url), task:tasks(id, title)"
  ).eq("project_id", projectId).is("deleted_at", null).order("created_at", { ascending: false });
  if (error) throw new Error("파일 목록을 불러올 수 없습니다.");
  return Promise.all(((data ?? []) as unknown as ProjectFile[]).map(async (file) => ({
    ...file,
    filename: await decryptContent<string>(file.original_name_encrypted, key, {
      projectId,
      entityType: "filename",
      entityId: file.id
    })
  })));
}

export async function uploadProjectFile(
  projectId: string,
  file: File,
  taskId?: string,
  onProgress?: (phase: "encrypting" | "uploading", percent: number) => void
): Promise<ProjectFile> {
  validateProjectFile(file);
  const user = useAuthStore.getState().user;
  if (!user) throw new Error("로그인이 필요합니다.");
  const key = await useProjectKeyStore.getState().unlock(projectId);
  const id = crypto.randomUUID();
  const encrypted = await encryptFile(file, key, projectId, id, (percent) => onProgress?.("encrypting", percent));
  const path = `${projectId}/${id}/encrypted.bin`;
  onProgress?.("uploading", 5);
  const { error: storageError } = await supabase.storage.from("project-files").upload(path, encrypted.encryptedBlob, {
    contentType: "application/octet-stream",
    upsert: false,
    cacheControl: "0"
  });
  if (storageError) throw new Error("암호화 파일을 Storage에 업로드할 수 없습니다.");
  onProgress?.("uploading", 80);
  const [filenameEncrypted, checksumEncrypted] = await Promise.all([
    encryptContent(file.name, key, { projectId, entityType: "filename", entityId: id }),
    encryptContent(encrypted.checksum, key, { projectId, entityType: "checksum", entityId: id })
  ]);
  const { data: metadata, error: metadataError } = await supabase.from("files").insert({
    id,
    project_id: projectId,
    task_id: taskId ?? null,
    storage_path: path,
    original_name_encrypted: filenameEncrypted,
    mime_type: projectFileMimeType(file),
    original_size: file.size,
    encrypted_size: encrypted.encryptedBlob.size,
    chunk_count: encrypted.chunkCount,
    checksum_encrypted: checksumEncrypted,
    uploaded_by: user.id
  }).select("*, uploader:profiles!files_uploaded_by_fkey(id, name, avatar_url), task:tasks(id, title)").single();
  if (metadataError) {
    await supabase.storage.from("project-files").remove([path]);
    throw new Error("파일 metadata를 저장할 수 없습니다.");
  }
  onProgress?.("uploading", 100);
  return { ...(metadata as unknown as ProjectFile), filename: file.name };
}

export async function listTaskFiles(projectId: string, taskId: string): Promise<ProjectFile[]> {
  return (await listFiles(projectId)).filter((file) => file.task_id === taskId);
}

export async function deleteProjectFile(file: ProjectFile): Promise<void> {
  const { error: storageError } = await supabase.storage.from("project-files").remove([file.storage_path]);
  if (storageError) throw new Error("파일 저장소에서 첨부 파일을 삭제할 수 없습니다.");
  const { error: metadataError } = await supabase.from("files").delete().eq("id", file.id);
  if (metadataError) throw new Error("첨부 파일 metadata를 삭제할 수 없습니다.");
}

export async function downloadProjectFile(file: ProjectFile, onProgress?: (percent: number) => void): Promise<Blob> {
  const key = await useProjectKeyStore.getState().unlock(file.project_id);
  const { data, error } = await supabase.storage.from("project-files").download(file.storage_path);
  if (error || !data) throw new Error("암호화 파일을 다운로드할 수 없습니다.");
  const checksum = await decryptContent<string>(file.checksum_encrypted, key, {
    projectId: file.project_id,
    entityType: "checksum",
    entityId: file.id
  });
  return decryptFile(data, key, file.project_id, file.id, checksum, file.mime_type, onProgress);
}
