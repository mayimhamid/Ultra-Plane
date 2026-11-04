/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import type { THubPerson } from "@plane/types";
import { cn, getFileURL } from "@plane/utils";

// Distinct, readable hues for names and avatar circles; the same person always gets the same one.
const HUES = [210, 340, 145, 25, 265, 185, 5, 290, 95, 45];

const hash = (value: string) => {
  let result = 0;
  for (let index = 0; index < value.length; index++) result = (result * 31 + value.charCodeAt(index)) | 0;
  return Math.abs(result);
};

/** The person's own color, readable on light and dark surfaces. */
export const personColor = (id: string) => `hsl(${HUES[hash(id) % HUES.length]} 65% 48%)`;

const initials = (name: string) =>
  name
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "?";

type Props = { person: THubPerson; size?: "sm" | "md"; className?: string };

/** A round profile picture, or the person's initials on their color when there is none. */
export function PersonAvatar({ person, size = "md", className }: Props) {
  const [broken, setBroken] = useState(false);
  const src = person.avatar_url && !broken ? getFileURL(person.avatar_url) : undefined;
  const box = size === "sm" ? "size-6 text-[10px]" : "size-8 text-[12px]";
  return src ? (
    <img
      src={src}
      alt=""
      aria-hidden
      onError={() => setBroken(true)}
      className={cn("shrink-0 rounded-full object-cover", box, className)}
    />
  ) : (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white",
        box,
        className
      )}
      style={{ backgroundColor: personColor(person.id) }}
    >
      {initials(person.display_name)}
    </span>
  );
}
