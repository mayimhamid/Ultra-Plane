/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * End-to-end encryption for Hub Secrets, in the browser (Web Crypto). The server only ever sees ciphertext.
 *
 * - Each person has an RSA-OAEP (3072-bit, SHA-256) key pair. The private key is encrypted with AES-GCM under a
 *   key derived from their vault passphrase with PBKDF2-SHA-256 (600 000 rounds, random salt). The passphrase
 *   never leaves the browser.
 * - Each secret gets its own random AES-GCM 256-bit key. The value is encrypted with it, and the key is wrapped
 *   (RSA-OAEP) with the public key of the publisher and of every reader.
 * - A wrong passphrase, or a ciphertext that was changed, fails AES-GCM's check: nothing wrong is ever shown.
 */

import type { THubSealed, THubSecretKind, THubVault } from "@plane/types";

export const VAULT_ITERATIONS = 600_000;
export const MIN_PASSPHRASE = 10;

const RSA: RsaHashedKeyGenParams = {
  name: "RSA-OAEP",
  modulusLength: 3072,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: "SHA-256",
};
const RSA_IMPORT: RsaHashedImportParams = { name: "RSA-OAEP", hash: "SHA-256" };

/** What a secret holds once opened. */
export type TSecretContent = { kind: "SECRET"; secret: string } | { kind: "LOGIN"; username: string; password: string };

export type TUnlockedVault = { publicKey: string; privateKey: CryptoKey };

const subtle = () => {
  const api = globalThis.crypto?.subtle;
  if (!api) throw new Error("This browser cannot encrypt. Open the app over HTTPS in an up-to-date browser.");
  return api;
};

export const toBase64 = (bytes: ArrayBuffer | Uint8Array) => {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let text = "";
  for (const byte of view) text += String.fromCharCode(byte);
  return btoa(text);
};

export const fromBase64 = (value: string) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

const random = (length: number) => globalThis.crypto.getRandomValues(new Uint8Array(length));

async function passphraseKey(passphrase: string, salt: Uint8Array, iterations: number) {
  const material = await subtle().importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, [
    "deriveKey",
  ]);
  return subtle().deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function lockPrivateKey(pkcs8: ArrayBuffer, passphrase: string, iterations = VAULT_ITERATIONS) {
  const salt = random(16);
  const iv = random(12);
  const key = await passphraseKey(passphrase, salt, iterations);
  const locked = await subtle().encrypt({ name: "AES-GCM", iv }, key, pkcs8);
  return { private_key: toBase64(locked), salt: toBase64(salt), iv: toBase64(iv), iterations };
}

async function openPrivateKey(vault: THubVault, passphrase: string) {
  const key = await passphraseKey(passphrase, fromBase64(vault.salt), vault.iterations);
  try {
    return await subtle().decrypt({ name: "AES-GCM", iv: fromBase64(vault.iv) }, key, fromBase64(vault.private_key));
  } catch {
    throw new Error("Wrong vault passphrase.");
  }
}

/** A new key pair, its private half locked with the passphrase. */
export async function createVault(passphrase: string): Promise<{ vault: THubVault; unlocked: TUnlockedVault }> {
  if (passphrase.length < MIN_PASSPHRASE) throw new Error(`Use at least ${MIN_PASSPHRASE} characters.`);
  const pair = await subtle().generateKey(RSA, true, ["encrypt", "decrypt"]);
  const publicKey = toBase64(await subtle().exportKey("spki", pair.publicKey));
  const pkcs8 = await subtle().exportKey("pkcs8", pair.privateKey);
  const vault = { public_key: publicKey, ...(await lockPrivateKey(pkcs8, passphrase)) };
  return { vault, unlocked: await unlockVault(vault, passphrase) };
}

/** The private key, usable in this tab only (it cannot be exported again). */
export async function unlockVault(vault: THubVault, passphrase: string): Promise<TUnlockedVault> {
  const pkcs8 = await openPrivateKey(vault, passphrase);
  const privateKey = await subtle().importKey("pkcs8", pkcs8, RSA_IMPORT, false, ["decrypt"]);
  return { publicKey: vault.public_key, privateKey };
}

/** The same key pair, locked with a new passphrase. */
export async function changePassphrase(vault: THubVault, current: string, next: string): Promise<THubVault> {
  if (next.length < MIN_PASSPHRASE) throw new Error(`Use at least ${MIN_PASSPHRASE} characters.`);
  const pkcs8 = await openPrivateKey(vault, current);
  return { public_key: vault.public_key, ...(await lockPrivateKey(pkcs8, next)) };
}

/** A secret's key, wrapped so only the owner of this public key can open it. */
export async function wrapFor(rawKey: Uint8Array, publicKey: string): Promise<string> {
  const key = await subtle().importKey("spki", fromBase64(publicKey), RSA_IMPORT, false, ["encrypt"]);
  return toBase64(await subtle().encrypt({ name: "RSA-OAEP" }, key, rawKey));
}

/** A secret's key wrapped for several people at once, by user id. */
async function wrapForAll(rawKey: Uint8Array, readers: Record<string, string>) {
  const entries = await Promise.all(
    Object.entries(readers).map(async ([userId, publicKey]) => [userId, await wrapFor(rawKey, publicKey)] as const)
  );
  return Object.fromEntries(entries);
}

/** A secret's key, opened with the caller's private key. */
export async function unwrap(wrapped: string, unlocked: TUnlockedVault): Promise<Uint8Array> {
  try {
    return new Uint8Array(await subtle().decrypt({ name: "RSA-OAEP" }, unlocked.privateKey, fromBase64(wrapped)));
  } catch {
    throw new Error("This secret was not shared with your current vault.");
  }
}

const toPayload = (content: TSecretContent) =>
  content.kind === "LOGIN"
    ? { username: content.username, password: content.password }
    : { secret: (content as { secret: string }).secret };

/**
 * Seals a value: a new random key encrypts it, and that key is wrapped for the publisher and for each reader
 * whose public key is given. Readers without a public key are left out (they wait for their key).
 */
export async function seal(
  content: TSecretContent,
  ownPublicKey: string,
  readers: Record<string, string>
): Promise<THubSealed & { kind: THubSecretKind }> {
  const rawKey = random(32);
  const iv = random(12);
  const key = await subtle().importKey("raw", rawKey, "AES-GCM", false, ["encrypt"]);
  const plain = new TextEncoder().encode(JSON.stringify(toPayload(content)));
  const ciphertext = await subtle().encrypt({ name: "AES-GCM", iv }, key, plain);
  const ownerKey = await wrapFor(rawKey, ownPublicKey);
  const keys = await wrapForAll(rawKey, readers);
  // The key only exists wrapped from here on.
  rawKey.fill(0);
  return { kind: content.kind, ciphertext: toBase64(ciphertext), iv: toBase64(iv), owner_key: ownerKey, keys };
}

/** Opens a sealed value with the caller's wrapped key. */
export async function open(
  sealed: { kind: THubSecretKind; ciphertext: string; iv: string; key: string },
  unlocked: TUnlockedVault
): Promise<TSecretContent> {
  const rawKey = await unwrap(sealed.key, unlocked);
  const key = await subtle().importKey("raw", rawKey, "AES-GCM", false, ["decrypt"]);
  rawKey.fill(0);
  let plain: ArrayBuffer;
  try {
    plain = await subtle().decrypt({ name: "AES-GCM", iv: fromBase64(sealed.iv) }, key, fromBase64(sealed.ciphertext));
  } catch {
    throw new Error("The secret could not be opened: it was changed or damaged.");
  }
  const data = JSON.parse(new TextDecoder().decode(plain)) as Record<string, string>;
  return sealed.kind === "LOGIN"
    ? { kind: "LOGIN", username: data.username ?? "", password: data.password ?? "" }
    : { kind: "SECRET", secret: data.secret ?? "" };
}

/** Wraps an existing secret's key (opened with the publisher's own copy) for more readers. */
export async function rewrap(
  ownerKey: string,
  unlocked: TUnlockedVault,
  readers: Record<string, string>
): Promise<Record<string, string>> {
  const rawKey = await unwrap(ownerKey, unlocked);
  const keys = await wrapForAll(rawKey, readers);
  rawKey.fill(0);
  return keys;
}

const LOWER = "abcdefghijkmnopqrstuvwxyz";
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGITS = "23456789";
const SYMBOLS = "!@#$%^&*-_=+?";

/** A uniformly random index below `max`, without the bias of a plain modulo. */
const randomIndex = (max: number) => {
  const limit = Math.floor(256 / max) * max;
  for (;;) {
    const [byte] = globalThis.crypto.getRandomValues(new Uint8Array(1));
    if (byte < limit) return byte % max;
  }
};

/**
 * A strong random password from the browser's secure random source. Look-alike characters (0/O, 1/l/I) are left
 * out, and it always has at least one lowercase, uppercase, digit (and symbol, when asked for).
 */
export function generatePassword(length = 20, symbols = true): string {
  const size = Math.min(Math.max(Math.round(length), 8), 128);
  const groups = [LOWER, UPPER, DIGITS, ...(symbols ? [SYMBOLS] : [])];
  const all = groups.join("");
  const chars = groups.map((group) => group[randomIndex(group.length)]);
  while (chars.length < size) chars.push(all[randomIndex(all.length)]);
  // Shuffle so the required characters are not always at the start.
  for (let index = chars.length - 1; index > 0; index -= 1) {
    const other = randomIndex(index + 1);
    [chars[index], chars[other]] = [chars[other], chars[index]];
  }
  return chars.join("");
}
