import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Github, Lock, Plus, Users } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { repositorySlug } from "../lib/utils";
import { usePermissions } from "../hooks/usePermissions";
import { ADMIN_PERMISSIONS } from "../../supabase/functions/_shared/adminPermissions";
import { createProject } from "../services/projects";
import { Alert, Button, Input, Modal, Spinner, useToast } from "./ui";

export function NewProjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const permissions = usePermissions();
  const canCreate = permissions.has(ADMIN_PERMISSIONS.PROJECTS_CREATE);
  const { showToast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [createRepository, setCreateRepository] = useState(false);
  const [repositoryName, setRepositoryName] = useState("");
  const [repositoryEdited, setRepositoryEdited] = useState(false);
  const [visibility, setVisibility] = useState<"private" | "public">("private");

  const reset = () => {
    setName("");
    setDescription("");
    setCreateRepository(false);
    setRepositoryName("");
    setRepositoryEdited(false);
    setVisibility("private");
  };

  useEffect(() => {
    if (!repositoryEdited) setRepositoryName(repositorySlug(name));
  }, [name, repositoryEdited]);

  const mutation = useMutation({
    mutationFn: (input: Parameters<typeof createProject>[0]) => {
      if (!canCreate) throw new Error("프로젝트를 생성할 권한이 없습니다.");
      return createProject(input);
    },
    onSuccess: async (project) => {
      queryClient.setQueryData(["project", project.id], project);
      reset();
      mutation.reset();
      onClose();
      showToast("프로젝트가 생성되었습니다.", { tone: "success", dedupeKey: `project-created:${project.id}` });
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      navigate(`/projects/${project.id}`);
    },
    onError: () => showToast("프로젝트를 생성하지 못했습니다.", { tone: "error" }),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!canCreate) return;
    mutation.mutate({ name, description: description || undefined, createRepository, repositoryName, visibility });
  };

  if (!canCreate || !open) return null;
  return (
    <Modal open={open} onClose={onClose} title="새 프로젝트" description="팀 업무 공간을 먼저 만들고 GitHub 연동은 선택할 수 있습니다." className="max-w-xl">
      <form onSubmit={submit} className="space-y-4">
        <div><label className="label" htmlFor="project-name">프로젝트 이름</label><Input id="project-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="캡스톤 디자인" maxLength={120} required autoFocus /></div>
        <div><label className="label" htmlFor="project-description">설명</label><textarea id="project-description" className="field min-h-24 resize-y" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} placeholder="프로젝트 목표와 범위를 적어주세요." /></div>
        <label className="flex items-center justify-between rounded-xl border border-line bg-raised p-3">
          <div><div className="flex items-center gap-2 text-sm font-bold text-ink"><Github size={16} /> GitHub 저장소 자동 생성</div><div className="mt-1 text-xs text-muted">선택하지 않아도 프로젝트의 모든 업무 기능을 사용할 수 있습니다.</div></div>
          <input type="checkbox" checked={createRepository} onChange={(event) => setCreateRepository(event.target.checked)} />
        </label>
        {createRepository && <div className="space-y-4 rounded-xl border border-line p-4">
          <div><label className="label" htmlFor="repository-name">저장소 이름</label><div className="relative"><Github className="pointer-events-none absolute left-3 top-3 text-muted" size={17} /><Input id="repository-name" value={repositoryName} onChange={(event) => { setRepositoryEdited(true); setRepositoryName(event.target.value); }} pattern="[A-Za-z0-9._-]{1,100}" className="pl-10 font-mono" placeholder="capstone-design" required /></div></div>
          <fieldset><legend className="label">공개 범위</legend><div className="grid grid-cols-2 gap-3">
            <button type="button" onClick={() => setVisibility("private")} className={`rounded-xl border p-3 text-left transition ${visibility === "private" ? "border-brand bg-brand/5" : "border-line bg-surface hover:bg-raised"}`}><div className="flex items-center gap-2 text-sm font-bold text-ink"><Lock size={15} /> 비공개</div><div className="mt-1 text-xs text-muted">기본값 · 팀원만 접근</div></button>
            <button type="button" onClick={() => setVisibility("public")} className={`rounded-xl border p-3 text-left transition ${visibility === "public" ? "border-brand bg-brand/5" : "border-line bg-surface hover:bg-raised"}`}><div className="flex items-center gap-2 text-sm font-bold text-ink"><Users size={15} /> 공개</div><div className="mt-1 text-xs text-muted">누구나 코드를 볼 수 있음</div></button>
          </div></fieldset>
        </div>}
        <Alert tone="info"><strong>프로젝트 소유자는 자동으로 나로 설정됩니다.</strong><br />GitHub 저장소를 만들지 못해도 프로젝트는 정상 생성되며 설정에서 다시 시도할 수 있습니다.</Alert>
        <div className="flex justify-end gap-2 pt-2"><Button variant="secondary" onClick={onClose}>취소</Button><Button type="submit" disabled={mutation.isPending || (createRepository && !repositoryName)}>{mutation.isPending ? <><Spinner className="h-4 w-4 border-white/30 border-t-white" /> 생성 중</> : <><Plus size={16} /> 프로젝트 생성</>}</Button></div>
      </form>
    </Modal>
  );
}
