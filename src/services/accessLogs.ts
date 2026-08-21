import { invokeAuthenticatedFunction } from "../lib/authenticatedFunction";

export type AccessEventType = "login" | "logout" | "password_changed" | "session_refreshed";

export async function recordAccessEvent(eventType: AccessEventType): Promise<void> {
  await invokeAuthenticatedFunction<{ recorded: true }>("record-access-event", {
    body: { eventType },
    fallbackMessage: "접속 기록을 저장할 수 없습니다."
  });
}

export function recordAccessEventBestEffort(eventType: AccessEventType): void {
  void recordAccessEvent(eventType).catch(() => undefined);
}
