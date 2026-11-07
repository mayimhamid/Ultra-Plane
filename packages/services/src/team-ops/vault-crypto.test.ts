/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import { changePassphrase, createVault, fromBase64, open, rewrap, seal, toBase64, unlockVault } from "./vault-crypto";

const PASS = "correct horse battery";

describe("vault crypto", () => {
  it("never puts the passphrase or the private key in what goes to the server", async () => {
    const { vault } = await createVault(PASS);
    const sent = JSON.stringify(vault);
    expect(sent).not.toContain(PASS);
    expect(vault.iterations).toBe(600_000);
    expect(fromBase64(vault.salt)).toHaveLength(16);
    // the stored private key is AES-GCM ciphertext, not a PKCS#8 key (which starts with 0x30)
    expect(fromBase64(vault.private_key)[0]).not.toBe(0x30);
  }, 30_000);

  it("opens with the right passphrase only", async () => {
    const { vault } = await createVault(PASS);
    await expect(unlockVault(vault, PASS)).resolves.toHaveProperty("publicKey", vault.public_key);
    await expect(unlockVault(vault, "wrong passphrase")).rejects.toThrow("Wrong vault passphrase.");
  }, 30_000);

  it("refuses a short passphrase", async () => {
    await expect(createVault("short")).rejects.toThrow("at least 10");
  });

  it("seals a login so that only the owner and the chosen readers can open it", async () => {
    const owner = await createVault(PASS);
    const reader = await createVault("reader passphrase");
    const stranger = await createVault("stranger passphrase");
    const sealed = await seal({ kind: "LOGIN", username: "admin", password: "p@ss wörd" }, owner.vault.public_key, {
      u1: reader.vault.public_key,
    });

    expect(JSON.stringify(sealed)).not.toContain("p@ss");
    expect(Object.keys(sealed.keys)).toEqual(["u1"]);
    const expected = { kind: "LOGIN", username: "admin", password: "p@ss wörd" };
    await expect(open({ ...sealed, key: sealed.owner_key }, owner.unlocked)).resolves.toEqual(expected);
    await expect(open({ ...sealed, key: sealed.keys.u1 }, reader.unlocked)).resolves.toEqual(expected);
    await expect(open({ ...sealed, key: sealed.keys.u1 }, stranger.unlocked)).rejects.toThrow("not shared");
  }, 60_000);

  it("notices a changed ciphertext instead of showing something wrong", async () => {
    const owner = await createVault(PASS);
    const sealed = await seal({ kind: "SECRET", secret: "token-123" }, owner.vault.public_key, {});
    const bytes = fromBase64(sealed.ciphertext);
    bytes[0] ^= 1;
    await expect(
      open({ ...sealed, ciphertext: toBase64(bytes), key: sealed.owner_key }, owner.unlocked)
    ).rejects.toThrow("changed or damaged");
  }, 30_000);

  it("shares an existing secret with a new reader without the server seeing the key", async () => {
    const owner = await createVault(PASS);
    const reader = await createVault("reader passphrase");
    const sealed = await seal({ kind: "SECRET", secret: "token-123" }, owner.vault.public_key, {});
    const keys = await rewrap(sealed.owner_key, owner.unlocked, { u2: reader.vault.public_key });
    await expect(open({ ...sealed, key: keys.u2 }, reader.unlocked)).resolves.toEqual({
      kind: "SECRET",
      secret: "token-123",
    });
  }, 60_000);

  it("changes the passphrase and keeps the same keys", async () => {
    const owner = await createVault(PASS);
    const sealed = await seal({ kind: "SECRET", secret: "x" }, owner.vault.public_key, {});
    const changed = await changePassphrase(owner.vault, PASS, "a brand new passphrase");
    expect(changed.public_key).toBe(owner.vault.public_key);
    await expect(unlockVault(changed, PASS)).rejects.toThrow();
    const unlocked = await unlockVault(changed, "a brand new passphrase");
    await expect(open({ ...sealed, key: sealed.owner_key }, unlocked)).resolves.toEqual({
      kind: "SECRET",
      secret: "x",
    });
    await expect(changePassphrase(owner.vault, "wrong one!!", "another passphrase")).rejects.toThrow();
  }, 60_000);
});
