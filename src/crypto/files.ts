import { sha256 } from "@noble/hashes/sha256.js";
import { base64UrlEncode, toArrayBuffer, utf8 } from "./encoding";
import { CryptoIntegrityError } from "./aes";
import type { EncryptedFileResult } from "./types";

const MAGIC = new Uint8Array([0x52, 0x56, 0x46, 0x31]); // RVF1
export const FILE_CHUNK_BYTES = 4 * 1024 * 1024;
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

function chunkAad(projectId: string, fileId: string, index: number): Uint8Array {
  return utf8(`rocket:v1:${projectId}:file:${fileId}:${index}`);
}

function uint32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, false);
  return bytes;
}

async function encryptChunk(bytes: Uint8Array, key: CryptoKey, aad: Uint8Array): Promise<{ iv: Uint8Array; ciphertext: Uint8Array }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv), additionalData: toArrayBuffer(aad), tagLength: 128 },
    key,
    toArrayBuffer(bytes)
  );
  return { iv, ciphertext: new Uint8Array(encrypted) };
}

export async function encryptFile(
  file: File,
  projectKey: CryptoKey,
  projectId: string,
  fileId: string,
  onProgress?: (percent: number) => void
): Promise<EncryptedFileResult> {
  if (file.size > MAX_FILE_BYTES) throw new Error("파일은 50 MiB 이하여야 합니다.");
  const chunkCount = Math.max(1, Math.ceil(file.size / FILE_CHUNK_BYTES));
  const header = new Uint8Array(8);
  header.set(MAGIC, 0);
  new DataView(header.buffer).setUint32(4, chunkCount, false);
  const output: BlobPart[] = [toArrayBuffer(header)];
  const hasher = sha256.create();
  for (let index = 0; index < chunkCount; index += 1) {
    const start = index * FILE_CHUNK_BYTES;
    const plaintext = new Uint8Array(await file.slice(start, Math.min(start + FILE_CHUNK_BYTES, file.size)).arrayBuffer());
    hasher.update(plaintext);
    const encrypted = await encryptChunk(plaintext, projectKey, chunkAad(projectId, fileId, index));
    output.push(
      toArrayBuffer(uint32(encrypted.ciphertext.byteLength)),
      toArrayBuffer(encrypted.iv),
      toArrayBuffer(encrypted.ciphertext)
    );
    onProgress?.(Math.round(((index + 1) / chunkCount) * 100));
  }
  return {
    encryptedBlob: new Blob(output, { type: "application/octet-stream" }),
    checksum: base64UrlEncode(hasher.digest()),
    chunkCount
  };
}

export async function decryptFile(
  encrypted: Blob,
  projectKey: CryptoKey,
  projectId: string,
  fileId: string,
  expectedChecksum: string,
  mimeType: string,
  onProgress?: (percent: number) => void
): Promise<Blob> {
  if (encrypted.size < 8) throw new CryptoIntegrityError();
  const header = new Uint8Array(await encrypted.slice(0, 8).arrayBuffer());
  if (!MAGIC.every((byte, index) => header[index] === byte)) throw new CryptoIntegrityError();
  const chunkCount = new DataView(header.buffer).getUint32(4, false);
  if (chunkCount < 1 || chunkCount > 32) throw new CryptoIntegrityError();
  const plaintextParts: BlobPart[] = [];
  const hasher = sha256.create();
  let offset = 8;
  for (let index = 0; index < chunkCount; index += 1) {
    if (offset + 16 > encrypted.size) throw new CryptoIntegrityError();
    const recordHeader = new Uint8Array(await encrypted.slice(offset, offset + 16).arrayBuffer());
    const length = new DataView(recordHeader.buffer).getUint32(0, false);
    const iv = recordHeader.subarray(4, 16);
    offset += 16;
    if (length < 16 || length > FILE_CHUNK_BYTES + 16 || offset + length > encrypted.size) throw new CryptoIntegrityError();
    const ciphertext = await encrypted.slice(offset, offset + length).arrayBuffer();
    offset += length;
    try {
      const decrypted = new Uint8Array(
        await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: toArrayBuffer(iv), additionalData: toArrayBuffer(chunkAad(projectId, fileId, index)), tagLength: 128 },
          projectKey,
          ciphertext
        )
      );
      hasher.update(decrypted);
      plaintextParts.push(toArrayBuffer(decrypted));
    } catch {
      throw new CryptoIntegrityError();
    }
    onProgress?.(Math.round(((index + 1) / chunkCount) * 100));
  }
  if (offset !== encrypted.size || base64UrlEncode(hasher.digest()) !== expectedChecksum) throw new CryptoIntegrityError();
  return new Blob(plaintextParts, { type: mimeType });
}
