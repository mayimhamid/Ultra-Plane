/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useSyncExternalStore } from "react";
import useSWR from "swr";
import type { vaultCrypto } from "@plane/services";
// local imports
import { hubExtraService } from "./use-hub";

type TUnlocked = vaultCrypto.TUnlockedVault;

/** The vault locks itself after this long without anyone using the page. */
const IDLE_MS = 15 * 60 * 1000;

// The opened private key lives only in this tab's memory: never in storage, gone on reload or when it locks.
const sessions = new Map<string, TUnlocked>();
const listeners = new Set<() => void>();
let idleTimer: number | undefined;

const emit = () => listeners.forEach((listener) => listener());

export const lockVault = (workspaceSlug?: string) => {
  if (workspaceSlug) sessions.delete(workspaceSlug);
  else sessions.clear();
  if (sessions.size === 0) window.clearTimeout(idleTimer);
  emit();
};

const bump = () => {
  window.clearTimeout(idleTimer);
  if (sessions.size > 0) idleTimer = window.setTimeout(() => lockVault(), IDLE_MS);
};

export const setUnlockedVault = (workspaceSlug: string, unlocked: TUnlocked) => {
  sessions.set(workspaceSlug, unlocked);
  bump();
  emit();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The caller's vault as stored on the server (locked), and the opened one for this tab, if any. */
export const useVault = (workspaceSlug: string) => {
  const { data, isLoading, mutate } = useSWR(`TEAM_OPS_HUB_VAULT_${workspaceSlug}`, () =>
    hubExtraService.getVault(workspaceSlug)
  );
  const unlocked = useSyncExternalStore(
    subscribe,
    () => sessions.get(workspaceSlug) ?? null,
    () => null
  );

  // Any use of the page keeps it open; leaving it idle locks it.
  useEffect(() => {
    if (!unlocked) return;
    window.addEventListener("pointerdown", bump);
    window.addEventListener("keydown", bump);
    return () => {
      window.removeEventListener("pointerdown", bump);
      window.removeEventListener("keydown", bump);
    };
  }, [unlocked]);

  return { vault: data, isLoading, refreshVault: mutate, unlocked };
};
