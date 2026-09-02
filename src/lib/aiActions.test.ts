import { describe, expect, it, vi } from "vitest";
import { parseRocketAIResult, recoverRocketAIMessage } from "../../supabase/functions/_shared/ai/actionSchema";
import { executeApprovedAIActions, type AIActionServices } from "./aiActions";
import type { ProjectMember, Task } from "../types/domain";

const PROJECT_ID = "20000000-0000-4000-8000-000000000001";
const TASK_ID = "10000000-0000-4000-8000-000000000001";
const MEMBER_ID = "30000000-0000-4000-8000-000000000001";
const OUTSIDER_ID = "30000000-0000-4000-8000-000000000099";

function services(): AIActionServices {
  return {
    createTask: vi.fn(async (input) => ({ ...task, id: "10000000-0000-4000-8000-000000000002", title: input.title })),
    updateTask: vi.fn(async () => undefined),
    addAssignee: vi.fn(async () => undefined),
    removeAssignee: vi.fn(async () => undefined),
  };
}

const task = {
  id: TASK_ID,
  project_id: PROJECT_ID,
  title: "기존 작업",
  description_encrypted: null,
  description: "",
  status: "todo",
  priority: "medium",
  progress: 0,
  progress_mode: "manual",
  start_date: null,
  due_date: null,
  created_by: null,
  revision: 0,
  deleted_at: null,
  created_at: "2026-08-25T00:00:00.000Z",
  updated_at: "2026-08-25T00:00:00.000Z",
  task_assignees: [],
} satisfies Task;

const member = {
  project_id: PROJECT_ID,
  user_id: MEMBER_ID,
  role: "member",
  added_by: null,
  github_sync_status: "synced",
  github_error_code: null,
  created_at: "2026-08-25T00:00:00.000Z",
  profile: {
    id: MEMBER_ID,
    student_id: "20260001",
    name: "팀원",
    github_username: null,
    avatar_url: null,
    encryption_public_key: null,
  },
} satisfies ProjectMember;

describe("approved AI actions", () => {
  it("does not mutate for a proposal, then calls createTask only after explicit execution", async () => {
    const api = services();
    const proposal = parseRocketAIResult({
      message: "작업 생성을 제안합니다.",
      actions: [{ type: "create_task", title: "데이터 전처리", dueDate: "2026-08-30", assigneeIds: [MEMBER_ID] }],
    }, {
      projectId: PROJECT_ID,
      taskIds: new Set([TASK_ID]),
      memberIds: new Set([MEMBER_ID]),
      allowMutations: true,
    });
    expect(api.createTask).not.toHaveBeenCalled();

    const result = await executeApprovedAIActions({
      projectId: PROJECT_ID,
      actions: proposal.actions,
      tasks: [task],
      members: [member],
      services: api,
    });
    expect(result).toEqual([expect.objectContaining({ success: true })]);
    expect(api.createTask).toHaveBeenCalledWith(expect.objectContaining({
      projectId: PROJECT_ID,
      title: "데이터 전처리",
      assigneeIds: [MEMBER_ID],
    }));
  });

  it("rejects the whole output when an unrequested mutation is mixed with a read action", () => {
    expect(() => parseRocketAIResult({
      message: "현재 작업을 요약했습니다.",
      actions: [
        { type: "summarize_project" },
        { type: "change_task_status", taskId: TASK_ID, status: "done" },
      ],
    }, {
      projectId: PROJECT_ID,
      taskIds: new Set([TASK_ID]),
      memberIds: new Set([MEMBER_ID]),
      allowMutations: false,
    })).toThrow("AI_OUTPUT_INVALID");
  });

  it("rejects a cross-project assignee before any client service is called", async () => {
    const api = services();
    const result = await executeApprovedAIActions({
      projectId: PROJECT_ID,
      actions: [{ type: "assign_task", projectId: PROJECT_ID, taskId: TASK_ID, assigneeIds: [OUTSIDER_ID] }],
      tasks: [task],
      members: [member],
      services: api,
    });
    expect(result).toEqual([expect.objectContaining({ success: false, error: "담당자는 현재 프로젝트 멤버여야 합니다." })]);
    expect(api.addAssignee).not.toHaveBeenCalled();
    expect(api.removeAssignee).not.toHaveBeenCalled();
  });

  it("rejects impossible calendar dates and oversized action batches", () => {
    const constraints = {
      projectId: PROJECT_ID,
      taskIds: new Set([TASK_ID]),
      memberIds: new Set([MEMBER_ID]),
      allowMutations: true,
    };
    expect(() => parseRocketAIResult({
      message: "제안",
      actions: [{ type: "set_task_due_date", taskId: TASK_ID, dueDate: "2026-02-30" }],
    }, constraints)).toThrow("AI_OUTPUT_INVALID");
    expect(() => parseRocketAIResult({ message: "초과", actions: Array.from({ length: 11 }, () => ({ type: "summarize_project" })) }, constraints))
      .toThrow("AI_OUTPUT_INVALID");
  });

  it("defaults optional create-task fields instead of blocking an otherwise safe proposal", () => {
    const result = parseRocketAIResult({
      message: "새 작업을 제안합니다.",
      actions: [{ type: "create_task", title: "발표 자료 검토" }],
    }, {
      projectId: PROJECT_ID,
      taskIds: new Set([TASK_ID]),
      memberIds: new Set([MEMBER_ID]),
      allowMutations: true,
    });
    expect(result.actions).toEqual([expect.objectContaining({
      type: "create_task",
      dueDate: null,
      assigneeIds: [],
      status: "todo",
      priority: "medium",
    })]);
  });

  it("keeps a safe message but discards every action when schema recovery is needed", () => {
    expect(recoverRocketAIMessage({
      message: "현재 프로젝트에는 진행 중인 작업이 2개 있습니다.",
      actions: [{ type: "invented_tool", command: "do something" }],
    })).toEqual({
      message: expect.stringContaining("현재 프로젝트에는 진행 중인 작업이 2개 있습니다."),
      actions: [],
    });
    expect(() => recoverRocketAIMessage({ actions: [] })).toThrow("AI_OUTPUT_INVALID");
  });
});
