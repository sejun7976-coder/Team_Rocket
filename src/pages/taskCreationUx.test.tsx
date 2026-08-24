import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../components/ui";
import type { Task } from "../types/domain";
import { TaskFormDialog } from "./ProjectPages";

const mocks = vi.hoisted(() => ({
  createTask: vi.fn(),
  uploadProjectFile: vi.fn(),
}));

vi.mock("../services/tasks", () => ({
  createTask: mocks.createTask,
  listTasks: vi.fn(),
  updateTask: vi.fn(),
}));

vi.mock("../services/files", () => ({ uploadProjectFile: mocks.uploadProjectFile }));

const createdTask = {
  id: "40000000-0000-4000-8000-000000000001",
  project_id: "20000000-0000-4000-8000-000000000001",
  title: "테스트 작업",
  description_encrypted: null,
  description: "입력 유지 확인",
  status: "todo",
  priority: "medium",
  progress: 0,
  progress_mode: "manual",
  start_date: null,
  due_date: null,
  created_by: "10000000-0000-4000-8000-000000000001",
  revision: 1,
  deleted_at: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
} satisfies Task;

function renderDialog(onClose = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <TaskFormDialog
          open
          onClose={onClose}
          projectId={createdTask.project_id}
          members={[]}
        />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { onClose, queryClient };
}

beforeEach(() => {
  mocks.createTask.mockReset();
  mocks.uploadProjectFile.mockReset();
});

afterEach(cleanup);

describe("board task creation UX", () => {
  it("closes, resets, updates, and shows a success Toast only after creation succeeds", async () => {
    mocks.createTask.mockResolvedValue(createdTask);
    const { onClose, queryClient } = renderDialog();
    const title = screen.getByLabelText("제목");
    fireEvent.change(title, { target: { value: "테스트 작업" } });
    fireEvent.click(screen.getByRole("button", { name: "작업 생성" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(title).toHaveValue("");
    expect(queryClient.getQueryData<Task[]>(["tasks", createdTask.project_id])).toContainEqual(createdTask);
    expect(screen.getByText("작업이 생성되었습니다.")).toBeInTheDocument();
  });

  it("keeps the modal input and shows an error Toast when creation fails", async () => {
    mocks.createTask.mockRejectedValue(new Error("서버 실패"));
    const { onClose } = renderDialog();
    const title = screen.getByLabelText("제목");
    fireEvent.change(title, { target: { value: "수정할 작업" } });
    fireEvent.change(screen.getByLabelText("설명"), { target: { value: "입력 유지" } });
    fireEvent.click(screen.getByRole("button", { name: "작업 생성" }));
    expect(await screen.findByText("작업을 생성하지 못했습니다.")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(title).toHaveValue("수정할 작업");
    expect(screen.getByLabelText("설명")).toHaveValue("입력 유지");
  });
});
