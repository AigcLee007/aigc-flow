import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const AES_ALGORITHM = "aes-256-gcm";
const NONCE_LENGTH = 12;

export type CredentialEncryptionResult = {
  authTag: Buffer;
  encryptedSecret: Buffer;
  keyVersion: string;
  nonce: Buffer;
  secretFingerprint: string;
};

export type CredentialRecordForDecryption = {
  authTag: Buffer;
  encryptedSecret: Buffer;
  nonce: Buffer;
};

export type CredentialResponseView = {
  createdAt: string;
  id: string;
  lastUsedAt: string | null;
  maskedSecret: string;
  name: string;
  providerId: string;
  rotatedAt: string | null;
  status: string;
};

export type CredentialVaultOptions = {
  keyVersion?: string;
  masterKey: string;
};

export class CredentialVaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialVaultError";
  }
}

export function parseCredentialMasterKey(encodedKey: string): Buffer {
  const normalized = encodedKey.trim();
  if (!normalized) {
    throw new CredentialVaultError("CREDENTIAL_MASTER_KEY is required");
  }

  let key: Buffer;
  try {
    key = Buffer.from(normalized, "base64");
  } catch {
    throw new CredentialVaultError("CREDENTIAL_MASTER_KEY must be valid base64");
  }

  if (key.length !== 32) {
    throw new CredentialVaultError(
      "CREDENTIAL_MASTER_KEY must decode from base64 into exactly 32 bytes",
    );
  }

  return key;
}

export function fingerprintSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function maskSecret(secret: string): string {
  if (!secret) {
    return "****";
  }

  if (secret.length <= 4) {
    return "****";
  }

  const prefixLength = Math.min(3, Math.max(1, secret.length - 4));
  const suffixLength = Math.min(4, Math.max(1, secret.length - prefixLength - 1));
  const prefix = secret.slice(0, prefixLength);
  const suffix = secret.slice(-suffixLength);
  return `${prefix}****${suffix}`;
}

export class CredentialVault {
  private readonly keyVersion: string;
  private readonly masterKey: Buffer;

  constructor(options: CredentialVaultOptions) {
    this.masterKey = parseCredentialMasterKey(options.masterKey);
    this.keyVersion = options.keyVersion?.trim() || "v1";
  }

  encryptSecret(secret: string): CredentialEncryptionResult {
    if (!secret.trim()) {
      throw new CredentialVaultError("Credential secret must not be empty");
    }

    const nonce = randomBytes(NONCE_LENGTH);
    const cipher = createCipheriv(AES_ALGORITHM, this.masterKey, nonce);
    const encryptedSecret = Buffer.concat([
      cipher.update(secret, "utf8"),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return {
      authTag,
      encryptedSecret,
      keyVersion: this.keyVersion,
      nonce,
      secretFingerprint: fingerprintSecret(secret),
    };
  }

  decryptSecret(record: CredentialRecordForDecryption): string {
    try {
      const decipher = createDecipheriv(AES_ALGORITHM, this.masterKey, record.nonce);
      decipher.setAuthTag(record.authTag);
      const decrypted = Buffer.concat([
        decipher.update(record.encryptedSecret),
        decipher.final(),
      ]);
      return decrypted.toString("utf8");
    } catch {
      throw new CredentialVaultError("Unable to decrypt credential secret");
    }
  }

  fingerprintSecret(secret: string): string {
    return fingerprintSecret(secret);
  }

  maskSecret(secret: string): string {
    return maskSecret(secret);
  }

  createCredential(secret: string): CredentialEncryptionResult {
    return this.encryptSecret(secret);
  }

  rotateCredential(secret: string): CredentialEncryptionResult {
    return this.encryptSecret(secret);
  }

  getSecretForProviderCall(record: CredentialRecordForDecryption): string {
    return this.decryptSecret(record);
  }

  maskCredentialForResponse(input: {
    createdAt: string;
    id: string;
    lastUsedAt: string | null;
    name: string;
    providerId: string;
    rotatedAt: string | null;
    secret: string;
    status: string;
  }): CredentialResponseView {
    return {
      createdAt: input.createdAt,
      id: input.id,
      lastUsedAt: input.lastUsedAt,
      maskedSecret: this.maskSecret(input.secret),
      name: input.name,
      providerId: input.providerId,
      rotatedAt: input.rotatedAt,
      status: input.status,
    };
  }
}
