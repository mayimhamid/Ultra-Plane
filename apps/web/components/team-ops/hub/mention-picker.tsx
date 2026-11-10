/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { AtSign, Check } from "lucide-react";
import { cn } from "@plane/utils";
import { useHubPeople } from "@/hooks/team-ops/use-hub";

type Props = {
  workspaceSlug: string;
  value: string[];
  onChange: (value: string[]) => void;
  /** What is being mentioned in, for the label: "this document", "this link". */
  what: string;
};

/**
 * Choose colleagues to mention. They are told when it is saved. Writing @name in the text does the same, and a
 * person already told by the text is not told again.
 */
export function MentionPicker({ workspaceSlug, value, onChange, what }: Props) {
  const { people } = useHubPeople(workspaceSlug);
  const [isOpen, setIsOpen] = useState(value.length > 0);

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setIsOpen(!isOpen)}
        className="inline-flex min-h-9 items-center gap-1.5 self-start rounded-md px-1 text-body-xs-medium text-accent-primary hover:underline"
      >
        <AtSign className="size-4" aria-hidden />
        {value.length > 0 ? `Mentioning ${value.length} ${value.length === 1 ? "person" : "people"}` : "Mention people"}
      </button>
      {isOpen ? (
        <div className="flex flex-col gap-1.5 rounded-lg border border-subtle p-2">
          <p className="text-caption-sm-regular text-tertiary">
            They get a notification when you save {what}. You can also write @name in the text.
          </p>
          <ul className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
            {(people ?? []).map((person) => {
              const chosen = value.includes(person.id);
              return (
                <li key={person.id}>
                  <button
                    type="button"
                    aria-pressed={chosen}
                    onClick={() => onChange(chosen ? value.filter((id) => id !== person.id) : [...value, person.id])}
                    className={cn(
                      "inline-flex min-h-8 items-center gap-1 rounded-full border px-2.5 text-caption-sm-medium",
                      chosen
                        ? "border-accent-strong bg-accent-subtle text-accent-primary"
                        : "border-subtle text-secondary hover:bg-layer-1"
                    )}
                  >
                    {chosen ? <Check className="size-3.5" aria-hidden /> : null}
                    {person.display_name}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
