/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

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
