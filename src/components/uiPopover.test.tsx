import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { Popover } from "./ui";

afterEach(cleanup);

function Fixture() {
  const [route, setRoute] = useState("/one");
  return (
    <div>
      <Popover
        label="첫 메뉴"
        role="menu"
        dismissKey={route}
        trigger={(props) => <button {...props}>첫 버튼</button>}
      >
        <button>첫 메뉴 내부</button>
      </Popover>
      <Popover
        label="둘째 메뉴"
        role="menu"
        trigger={(props) => <button {...props}>둘째 버튼</button>}
      >
        <button>둘째 메뉴 내부</button>
      </Popover>
      <button onClick={() => setRoute("/two")}>경로 변경</button>
      <button>외부 영역</button>
    </div>
  );
}

describe("Popover", () => {
  it("toggles and keeps internal clicks open while closing on outside clicks", async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    const trigger = screen.getByRole("button", { name: "첫 버튼" });
    const triggerContainer = trigger.parentElement;
    await user.click(trigger);
    const menu = screen.getByRole("menu", { name: "첫 메뉴" });
    expect(menu).toBeInTheDocument();
    expect(triggerContainer).not.toContainElement(menu);
    expect(menu).toHaveClass("popover-floating", "layer-popover", "fixed");
    await user.click(screen.getByRole("button", { name: "첫 메뉴 내부" }));
    expect(screen.getByRole("menu", { name: "첫 메뉴" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "외부 영역" }));
    expect(screen.queryByRole("menu", { name: "첫 메뉴" })).not.toBeInTheDocument();
    await user.click(trigger);
    await user.click(trigger);
    expect(screen.queryByRole("menu", { name: "첫 메뉴" })).not.toBeInTheDocument();
  });

  it("closes the previous popover, Escape, and route changes", async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    const first = screen.getByRole("button", { name: "첫 버튼" });
    const second = screen.getByRole("button", { name: "둘째 버튼" });
    await user.click(first);
    await user.click(second);
    expect(screen.queryByRole("menu", { name: "첫 메뉴" })).not.toBeInTheDocument();
    expect(screen.getByRole("menu", { name: "둘째 메뉴" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu", { name: "둘째 메뉴" })).not.toBeInTheDocument();
    expect(second).toHaveFocus();
    await user.click(first);
    await user.click(screen.getByRole("button", { name: "경로 변경" }));
    expect(screen.queryByRole("menu", { name: "첫 메뉴" })).not.toBeInTheDocument();
  });

  it("keeps portal content inside the viewport and flips above when needed", async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    const trigger = screen.getByRole("button", { name: "첫 버튼" });
    trigger.getBoundingClientRect = () => ({
      bottom: window.innerHeight - 4,
      height: 28,
      left: window.innerWidth - 38,
      right: window.innerWidth - 4,
      top: window.innerHeight - 32,
      width: 34,
      x: window.innerWidth - 38,
      y: window.innerHeight - 32,
      toJSON: () => ({}),
    });

    await user.click(trigger);
    const menu = screen.getByRole("menu", { name: "첫 메뉴" });
    Object.defineProperty(menu, "offsetWidth", { configurable: true, value: 300 });
    Object.defineProperty(menu, "scrollHeight", { configurable: true, value: 160 });
    fireEvent(window, new Event("resize"));

    await waitFor(() => expect(menu.style.visibility).toBe("visible"));
    expect(Number.parseFloat(menu.style.left)).toBeLessThanOrEqual(window.innerWidth - 312);
    expect(Number.parseFloat(menu.style.left)).toBeGreaterThanOrEqual(12);
    expect(Number.parseFloat(menu.style.top)).toBeLessThan(window.innerHeight - 32);
  });
});
