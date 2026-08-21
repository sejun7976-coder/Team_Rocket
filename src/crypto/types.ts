export interface EncryptionEnvelope {
  version: 1;
  algorithm: "AES-256-GCM";
  iv: string;
  ciphertext: string;
}

export interface UserKeyringRecord {
  encryptionPublicKey: JsonWebKey;
  encryptedPrivateKey: EncryptionEnvelope;
  keySalt: string;
  keyKdfIterations: number;
}

export interface UnlockedUserKeyring {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  publicJwk: JsonWebKey;
}

export interface WrappedProjectKey {
  wrappedKey: EncryptionEnvelope;
  ephemeralPublicKey: JsonWebKey;
}

export interface ProjectKeyRecord {
  wrapped_key: EncryptionEnvelope;
  ephemeral_public_key: JsonWebKey;
}

export interface EncryptionContext {
  projectId: string;
  entityType: "project-note" | "task-description" | "checklist" | "comment" | "filename" | "checksum" | "activity";
  entityId: string;
}

export interface EncryptedFileResult {
  encryptedBlob: Blob;
  checksum: string;
  chunkCount: number;
}
