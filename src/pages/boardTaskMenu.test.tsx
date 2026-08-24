import { DndContext } from "@dnd-kit/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ToastProvider } from "../components/ui";
import type { Task } from "../types/domain";
import { DraggableTaskCard } from "./ProjectPages";

const taskService = vi.hoisted(() => ({
  createTask: vi.fn(),
  deleteTask: vi.fn(),
  listTasks: vi.fn(),
  updateTask: vi.fn(),
}));

vi.mock("../services/tasks", () => taskService);

const task = {
  id: "10000000-0000-4000-8000-000000000001",
  project_id: "20000000-0000-4000-8000-000000000001",
  title: "보드 카드 테스트",
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
  comments: [{ count: 0 }],
  files: [{ count: 0 }],
} satisfies Task;

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={[`/projects/${task.project_id}/board`]}>
          <DndContext sensors={[]}>
            <Routes>
              <Route path="/projects/:projectId/board" element={<DraggableTaskCard task={task} />} />
              <Route path="/tasks/:taskId" element={<h1>작업 상세</h1>} />
            </Routes>
          </DndContext>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Board task card menu", () => {
  it("navigates to Task detail when the card body is clicked", async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByText(task.title));
    expect(screen.getByRole("heading", { name: "작업 상세" })).toBeInTheDocument();
  });

  it("opens the common Popover without card navigation and executes its status action", async () => {
    taskService.updateTask.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByRole("button", { name: `${task.title} 작업 메뉴` }));
    expect(screen.getByRole("menu", { name: `${task.title} 작업 메뉴` })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "작업 상세" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("menuitem", { name: /진행 중.*이동/u }));
    await waitFor(() => expect(taskService.updateTask).toHaveBeenCalledWith(task, { status: "in_progress" }));
    expect(screen.queryByRole("heading", { name: "작업 상세" })).not.toBeInTheDocument();
  });
});
