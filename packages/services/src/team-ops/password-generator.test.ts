/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import { generatePassword } from "./password-generator";

describe("password generator", () => {
  it("generates strong random passwords", () => {
    const passwords = Array.from({ length: 200 }, () => generatePassword(20));
    expect(new Set(passwords).size).toBe(200);
    for (const password of passwords) {
      expect(password).toHaveLength(20);
      expect(password).toMatch(/[a-z]/);
      expect(password).toMatch(/[A-Z]/);
      expect(password).toMatch(/[2-9]/);
      expect(password).toMatch(/[!@#$%^&*\-_=+?]/);
      expect(password).not.toMatch(/[0O1lI]/);
    }
    expect(generatePassword(16, false)).toMatch(/^[A-Za-z2-9]{16}$/);
    expect(generatePassword(3)).toHaveLength(8);
  });
});
