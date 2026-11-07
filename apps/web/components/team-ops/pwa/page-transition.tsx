/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef } from "react";
import { useLocation } from "react-router";

/**
 * Lets the page fade and rise in softly when the address changes to another page (not for a query such as a
 * channel or a date). The page is not remounted: only the animation is played again, so nothing is lost.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const box = useRef<HTMLDivElement>(null);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const element = box.current;
    if (!element) return;
    element.classList.remove("page-enter");
    // Reading a layout value makes the browser start the animation from the beginning again.
    void element.offsetWidth;
    element.classList.add("page-enter");
  }, [pathname]);

  return (
    <div ref={box} className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
      {children}
    </div>
  );
}
