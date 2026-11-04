/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect } from "react";
import type { RefObject } from "react";

/**
 * Closes a menu or dropdown the way people expect: a click or tap anywhere outside `ref`, the Escape key,
 * or the keyboard focus moving out of it. Listens only while `isOpen`.
 */
export const useDismiss = (ref: RefObject<HTMLElement | null>, isOpen: boolean, onClose: () => void) => {
  useEffect(() => {
    if (!isOpen) return;
    const outside = (target: EventTarget | null) => !!ref.current && !ref.current.contains(target as Node);
    const onPointer = (event: PointerEvent) => {
      if (outside(event.target)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const onFocus = (event: FocusEvent) => {
      if (outside(event.target)) onClose();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    document.addEventListener("focusin", onFocus);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("focusin", onFocus);
    };
  }, [ref, isOpen, onClose]);
};
