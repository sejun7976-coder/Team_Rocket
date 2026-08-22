import { decryptJson, encryptJson } from "./aes";
import { importUserKeyring } from "./keyring";
import type { EncryptionEnvelope, UnlockedUserKeyring } from "./types";

export const KEYRING_INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000;
export const LAST_ACTIVITY_STORAGE_KEY = "rocket-last-activity-at:v1";
const TAB_ID_STORAGE_KEY = "rocket-tab-id:v1";
const TAB_NAME_PREFIX = "rocket-campus-session-v1:";
const DATABASE_NAME = "rocket-campus-session-v1";
const STORE_NAME = "session-keyrings";
const DATABASE_VERSION = 1;

export interface PersistedSessionKeyring {
  id: string;
  version: 1;
  tabId: string;
  userId: string;
  wrappingKey: CryptoKey;
  encryptedPrivateJwk: EncryptionEnvelope;
  publicJwk: JsonWebKey;
  expiresAt: number;
}

function sessionStorageOrNull(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

function tabId(): string | null {
  const storage = sessionStorageOrNull();
  if (!storage) return null;
  const validId = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f-]{36}$/iu.test(value);
  const storageId = storage.getItem(TAB_ID_STORAGE_KEY);
  try {
    if (typeof window === "undefined") return validId(storageId) ? storageId : null;
    const windowId = window.name.startsWith(TAB_NAME_PREFIX)
      ? window.name.slice(TAB_NAME_PREFIX.length)
      : null;
    if (validId(windowId)) {
      storage.setItem(TAB_ID_STORAGE_KEY, windowId);
      return windowId;
    }
  } catch {
    return validId(storageId) ? storageId : null;
  }
  const created = crypto.randomUUID();
  storage.setItem(TAB_ID_STORAGE_KEY, created);
  try {
    if (typeof window !== "undefined") window.name = `${TAB_NAME_PREFIX}${created}`;
  } catch {
    // sessionStorage still keeps reload behavior when window.name is unavailable.
  }
  return created;
}

function recordId(tab: string, userId: string): string {
  return `${tab}:${userId}`;
}

function wrappingAad(tab: string, userId: string): string {
  return `rocket:session-keyring:v1:${tab}:${userId}`;
}

export function readLastActivityAt(): number | null {
  const raw = sessionStorageOrNull()?.getItem(LAST_ACTIVITY_STORAGE_KEY);
  if (!raw || !/^\d{10,16}$/u.test(raw)) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function writeLastActivityAt(value = Date.now()): void {
  sessionStorageOrNull()?.setItem(LAST_ACTIVITY_STORAGE_KEY, String(value));
}

export function clearLastActivityAt(): void {
  sessionStorageOrNull()?.removeItem(LAST_ACTIVITY_STORAGE_KEY);
}

export function inactivityExpired(lastActivityAt: number | null, now = Date.now()): boolean {
  return lastActivityAt === null || now - lastActivityAt >= KEYRING_INACTIVITY_TIMEOUT_MS;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("SECURE_SESSION_STORAGE_UNAVAILABLE"));
      return;
    }
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("SECURE_SESSION_STORAGE_UNAVAILABLE"));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("SECURE_SESSION_STORAGE_FAILED"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(new Error("SECURE_SESSION_STORAGE_FAILED"));
    transaction.onabort = () => reject(new Error("SECURE_SESSION_STORAGE_FAILED"));
  });
}

async function getRecord(id: string): Promise<PersistedSessionKeyring | undefined> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readonly");
    return await requestResult(transaction.objectStore(STORE_NAME).get(id)) as PersistedSessionKeyring | undefined;
  } finally {
    database.close();
  }
}

async function putRecord(record: PersistedSessionKeyring): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(record);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

async function deleteRecord(id: string): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(id);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function createPersistedSessionKeyring(
  tab: string,
  userId: string,
  keyring: UnlockedUserKeyring,
  expiresAt: number
): Promise<PersistedSessionKeyring> {
  const wrappingKey = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
  const privateJwk = await crypto.subtle.exportKey("jwk", keyring.privateKey);
  try {
    return {
      id: recordId(tab, userId),
      version: 1,
      tabId: tab,
      userId,
      wrappingKey,
      encryptedPrivateJwk: await encryptJson(privateJwk, wrappingKey, wrappingAad(tab, userId)),
      publicJwk: keyring.publicJwk,
      expiresAt
    };
  } finally {
    delete privateJwk.d;
  }
}

export async function restorePersistedSessionKeyring(record: PersistedSessionKeyring): Promise<UnlockedUserKeyring> {
  if (
    record.version !== 1
    || record.wrappingKey.extractable
    || record.wrappingKey.algorithm.name !== "AES-GCM"
    || record.wrappingKey.type !== "secret"
  ) throw new Error("SECURE_SESSION_RECORD_INVALID");
  const privateJwk = await decryptJson<JsonWebKey>(
    record.encryptedPrivateJwk,
    record.wrappingKey,
    wrappingAad(record.tabId, record.userId)
  );
  try {
    if (privateJwk.kty !== "EC" || privateJwk.crv !== "P-256" || typeof privateJwk.d !== "string") {
      throw new Error("SECURE_SESSION_RECORD_INVALID");
    }
    return await importUserKeyring(record.publicJwk, privateJwk);
  } finally {
    delete privateJwk.d;
  }
}

export async function persistSessionKeyring(userId: string, keyring: UnlockedUserKeyring, now = Date.now()): Promise<void> {
  const tab = tabId();
  if (!tab) throw new Error("SECURE_SESSION_STORAGE_UNAVAILABLE");
  writeLastActivityAt(now);
  const record = await createPersistedSessionKeyring(tab, userId, keyring, now + KEYRING_INACTIVITY_TIMEOUT_MS);
  await putRecord(record);
}

export async function restoreSessionKeyring(userId: string, now = Date.now()): Promise<UnlockedUserKeyring | null> {
  const tab = tabId();
  const lastActivityAt = readLastActivityAt();
  if (!tab || inactivityExpired(lastActivityAt, now)) {
    if (tab) await deleteRecord(recordId(tab, userId)).catch(() => undefined);
    clearLastActivityAt();
    return null;
  }
  const record = await getRecord(recordId(tab, userId)).catch(() => undefined);
  if (
    !record
    || record.userId !== userId
    || record.tabId !== tab
    || !Number.isFinite(record.expiresAt)
    || record.expiresAt <= now
  ) {
    if (record) await deleteRecord(record.id).catch(() => undefined);
    clearLastActivityAt();
    return null;
  }
  try {
    return await restorePersistedSessionKeyring(record);
  } catch {
    await deleteRecord(record.id).catch(() => undefined);
    clearLastActivityAt();
    return null;
  }
}

export async function touchSessionKeyring(userId: string, now = Date.now()): Promise<void> {
  const tab = tabId();
  if (!tab) return;
  writeLastActivityAt(now);
  const record = await getRecord(recordId(tab, userId)).catch(() => undefined);
  if (!record) return;
  record.expiresAt = now + KEYRING_INACTIVITY_TIMEOUT_MS;
  await putRecord(record).catch(() => undefined);
}

export async function clearSessionKeyring(userId: string | null): Promise<void> {
  const tab = tabId();
  clearLastActivityAt();
  if (!tab || !userId) return;
  await deleteRecord(recordId(tab, userId)).catch(() => undefined);
}

export async function clearExpiredSessionKeyrings(now = Date.now()): Promise<void> {
  const database = await openDatabase().catch(() => null);
  if (!database) return;
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    await new Promise<void>((resolve, reject) => {
      const cursorRequest = store.openCursor();
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) { resolve(); return; }
        const record = cursor.value as PersistedSessionKeyring;
        if (!Number.isFinite(record.expiresAt) || record.expiresAt <= now) cursor.delete();
        cursor.continue();
      };
      cursorRequest.onerror = () => reject(new Error("SECURE_SESSION_STORAGE_FAILED"));
    });
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}
