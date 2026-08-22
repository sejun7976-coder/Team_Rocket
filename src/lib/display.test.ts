import { describe, expect, it } from "vitest";
import {
  formatRelativeTime,
  notificationTypeLabels,
  projectRoleLabels,
  taskPriorityLabels,
  taskStatusLabels,
} from "./display";
import { formatBytes } from "./utils";

describe("Korean display helpers", () => {
  it("formats file sizes with readable units", () => {
    expect(formatBytes(843 * 1024)).toBe("843 KB");
    expect(formatBytes(4.2 * 1024 ** 2)).toBe("4.2 MB");
    expect(formatBytes(50 * 1024 ** 2)).toBe("50 MB");
  });

  it("uses consistent Korean labels", () => {
    expect(taskStatusLabels.todo).toBe("할 일");
    expect(taskPriorityLabels.urgent).toBe("긴급");
    expect(projectRoleLabels.owner).toBe("소유자");
    expect(notificationTypeLabels.file_uploaded).toBe("파일");
  });

  it("formats recent times in Korean", () => {
    const now = new Date("2026-08-23T12:00:00+09:00");
    expect(formatRelativeTime("2026-08-23T11:59:30+09:00", now)).toBe("방금 전");
    expect(formatRelativeTime("2026-08-23T11:58:00+09:00", now)).toBe("2분 전");
    expect(formatRelativeTime("2026-08-22T12:00:00+09:00", now)).toBe("어제");
  });
});
