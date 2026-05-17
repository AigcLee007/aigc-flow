import { describe, expect, test } from "vitest";

import {
  CredentialVault,
  CredentialVaultError,
  fingerprintSecret,
  maskSecret,
} from "../src/credential-vault.js";

const TEST_MASTER_KEY = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";
const WRONG_MASTER_KEY = "ZmVkY2JhOTg3NjU0MzIxMGZlZGNiYTk4NzY1NDMyMTA=";

describe("CredentialVault", () => {
  test("encrypts and decrypts a secret", () => {
    const vault = new CredentialVault({
      keyVersion: "v1",
      masterKey: TEST_MASTER_KEY,
    });

    const encrypted = vault.encryptSecret("sk-test-secret-1234");
    const decrypted = vault.decryptSecret(encrypted);

    expect(decrypted).toBe("sk-test-secret-1234");
    expect(encrypted.keyVersion).toBe("v1");
    expect(encrypted.encryptedSecret.equals(Buffer.from("sk-test-secret-1234"))).toBe(false);
  });

  test("decrypt fails with the wrong key", () => {
    const vault = new CredentialVault({ masterKey: TEST_MASTER_KEY });
    const wrongVault = new CredentialVault({ masterKey: WRONG_MASTER_KEY });
    const encrypted = vault.encryptSecret("sk-secret-value");

    expect(() => wrongVault.decryptSecret(encrypted)).toThrow(CredentialVaultError);
  });

  test("maskSecret never reveals the full secret", () => {
    const longMasked = maskSecret("sk-production-secret-abcd");
    const shortMasked = maskSecret("abcd");

    expect(longMasked).toMatch(/^.{1,3}\*{4}.+$/);
    expect(longMasked).not.toContain("production-secret");
    expect(shortMasked).toBe("****");
  });

  test("fingerprint is stable and irreversible", () => {
    const a = fingerprintSecret("sk-same-secret");
    const b = fingerprintSecret("sk-same-secret");
    const c = fingerprintSecret("sk-different-secret");

    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(a).not.toContain("sk-same-secret");
  });

  test("encryption output changes for the same plaintext because nonce changes", () => {
    const vault = new CredentialVault({ masterKey: TEST_MASTER_KEY });

    const first = vault.encryptSecret("sk-repeated-secret");
    const second = vault.encryptSecret("sk-repeated-secret");

    expect(first.secretFingerprint).toBe(second.secretFingerprint);
    expect(first.nonce.equals(second.nonce)).toBe(false);
    expect(first.encryptedSecret.equals(second.encryptedSecret)).toBe(false);
  });
});
