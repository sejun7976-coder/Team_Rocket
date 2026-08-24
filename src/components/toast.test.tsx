import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider, useToast } from "./ui";

function ToastHarness() {
  const { showToast } = useToast();
  return (
    <div>
      <button onClick={() => showToast("저장되었습니다.", { tone: "success" })}>성공</button>
      <button onClick={() => showToast("저장하지 못했습니다.", { tone: "error" })}>실패</button>
      <button onClick={() => showToast("확인이 필요합니다.", { tone: "warning" })}>경고</button>
      <button onClick={() => showToast("새 정보입니다.", { tone: "info" })}>정보</button>
    </div>
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("global Toast system", () => {
  it("stacks success, error, warning, and info messages in the bottom-right viewport", () => {
    render(<ToastProvider><ToastHarness /></ToastProvider>);
    for (const label of ["성공", "실패", "경고", "정보"]) fireEvent.click(screen.getByRole("button", { name: label }));
    const viewport = document.querySelector("[data-toast-viewport]");
    expect(viewport).toHaveClass("fixed", "bottom-20", "sm:right-5", "flex-col");
    expect(screen.getByText("저장되었습니다.")).toBeInTheDocument();
    expect(screen.getByText("저장하지 못했습니다.")).toBeInTheDocument();
    expect(screen.getByText("확인이 필요합니다.")).toBeInTheDocument();
    expect(screen.getByText("새 정보입니다.")).toBeInTheDocument();
    expect(screen.getByText("저장되었습니다.").closest('[role="status"]')).toHaveClass("text-emerald-700");
    expect(screen.getByText("저장하지 못했습니다.").closest('[role="alert"]')).toHaveClass("text-red-700");
  });

  it("deduplicates the same visible operation message", () => {
    render(<ToastProvider><ToastHarness /></ToastProvider>);
    const success = screen.getByRole("button", { name: "성공" });
    fireEvent.click(success);
    fireEvent.click(success);
    expect(screen.getAllByText("저장되었습니다.")).toHaveLength(1);
  });

  it("automatically removes success messages", () => {
    vi.useFakeTimers();
    render(<ToastProvider><ToastHarness /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "성공" }));
    expect(screen.getByText("저장되었습니다.")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(3_500));
    expect(screen.queryByText("저장되었습니다.")).not.toBeInTheDocument();
  });
});
