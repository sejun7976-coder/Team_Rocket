import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Github, Lock, Plus, Users } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { repositorySlug } from "../lib/utils";
import { createProject } from "../services/projects";
import { Alert, Button, Input, Modal, Spinner } from "./ui";

export function NewProjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [repositoryName, setRepositoryName] = useState("");
  const [repositoryEdited, setRepositoryEdited] = useState(false);
  const [visibility, setVisibility] = useState<"private" | "public">("private");
  useEffect(() => { if (!repositoryEdited) setRepositoryName(repositorySlug(name)); }, [name, repositoryEdited]);
  const mutation = useMutation({
    mutationFn: createProject,
    onSuccess: async (project) => {
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      onClose(); navigate(`/projects/${project.id}`);
    }
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    mutation.mutate({ name, description: description || undefined, repositoryName, visibility });
  };
  return <Modal open={open} onClose={onClose} title="새 프로젝트" description="프로젝트와 실제 GitHub Repository를 함께 만듭니다." className="max-w-xl"><form onSubmit={submit} className="space-y-4">{mutation.error && <Alert>{mutation.error.message}</Alert>}<div><label className="label" htmlFor="project-name">프로젝트 이름</label><Input id="project-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="AI Pilot" maxLength={120} required autoFocus /></div><div><label className="label" htmlFor="project-description">설명</label><textarea id="project-description" className="field min-h-24 resize-y" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} placeholder="프로젝트 목표와 범위를 적어주세요." /></div><div><label className="label" htmlFor="repository-name">GitHub Repository 이름</label><div className="relative"><Github className="pointer-events-none absolute left-3 top-3 text-muted" size={17} /><Input id="repository-name" value={repositoryName} onChange={(event) => { setRepositoryEdited(true); setRepositoryName(event.target.value); }} pattern="[A-Za-z0-9._-]{1,100}" className="pl-10 font-mono" placeholder="ai-pilot" required /></div></div><fieldset><legend className="label">Repository</legend><div className="grid grid-cols-2 gap-3"><button type="button" onClick={() => setVisibility("private")} className={`rounded-xl border p-3 text-left transition ${visibility === "private" ? "border-brand bg-brand/5" : "border-line bg-surface hover:bg-raised"}`}><div className="flex items-center gap-2 text-sm font-bold text-ink"><Lock size={15} />Private</div><div className="mt-1 text-xs text-muted">기본값 · 팀원만 접근</div></button><button type="button" onClick={() => setVisibility("public")} className={`rounded-xl border p-3 text-left transition ${visibility === "public" ? "border-brand bg-brand/5" : "border-line bg-surface hover:bg-raised"}`}><div className="flex items-center gap-2 text-sm font-bold text-ink"><Users size={15} />Public</div><div className="mt-1 text-xs text-muted">누구나 코드 열람 가능</div></button></div></fieldset><Alert tone="info"><strong>Owner는 자동으로 나로 설정됩니다.</strong><br />팀원은 프로젝트 생성 직후 추가할 수 있습니다. GitHub credential은 Edge Function 밖으로 노출되지 않습니다.</Alert><div className="flex justify-end gap-2 pt-2"><Button variant="secondary" onClick={onClose}>취소</Button><Button type="submit" disabled={mutation.isPending || !repositoryName}>{mutation.isPending ? <><Spinner className="h-4 w-4 border-white/30 border-t-white" /> 생성 중</> : <><Plus size={16} /> 프로젝트 생성</>}</Button></div></form></Modal>;
}
