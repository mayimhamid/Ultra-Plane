/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo, useState } from "react";
import { sortBy } from "lodash-es";
import { observer } from "mobx-react";
import { Copy, ExternalLink, Globe, Pencil, Search, Trash2 } from "lucide-react";
import { Button } from "@makeplane/propel/components/button";
import { InputField } from "@makeplane/propel/components/input-field";
import { setToast } from "@plane/blocks/toast";
import type { THubLink } from "@plane/types";
import { useUser } from "@/hooks/store/user";
import { hubExtraService, useHubLinks } from "@/hooks/team-ops/use-hub";
// local imports
import { getErrorMessage } from "../calendar/error-message";

type Props = { workspaceSlug: string };

type TDraft = { id: string | null; url: string; title: string; note: string; group: string };
const EMPTY: TDraft = { id: null, url: "", title: "", note: "", group: "" };

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/** Links the team keeps in one place (dashboards, repositories, tools), grouped, with a note and a copy button. */
export const LinksView = observer(function LinksView({ workspaceSlug }: Props) {
  const { data: currentUser } = useUser();
  const { links, refresh } = useHubLinks(workspaceSlug);
  const [draft, setDraft] = useState<TDraft | null>(null);
  const [filter, setFilter] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const groups = useMemo(() => {
    const wanted = filter.trim().toLowerCase();
    const matching = (links ?? []).filter(
      (link) =>
        !wanted || [link.title, link.url, link.note, link.group].some((text) => text.toLowerCase().includes(wanted))
    );
    const byGroup = new Map<string, THubLink[]>();
    matching.forEach((link) => byGroup.set(link.group, [...(byGroup.get(link.group) ?? []), link]));
    // Named groups first, in order; the links without a group come last.
    // (an empty name sorts after every real one)
    return sortBy([...byGroup.entries()], ([name]) => (name === "" ? "￿" : name.toLowerCase()));
  }, [links, filter]);
  const knownGroups = useMemo(() => [...new Set((links ?? []).map((link) => link.group).filter(Boolean))], [links]);

  const save = async () => {
    if (!draft || !draft.url.trim()) return;
    setIsSaving(true);
    try {
      const payload = { url: draft.url, title: draft.title, note: draft.note, group: draft.group };
      if (draft.id) await hubExtraService.updateLink(workspaceSlug, draft.id, payload);
      else await hubExtraService.createLink(workspaceSlug, payload);
      setDraft(null);
      await refresh();
    } catch (error) {
      setToast({ type: "error", title: "Could not save the link", message: getErrorMessage(error) });
    } finally {
      setIsSaving(false);
    }
  };

  const remove = async (link: THubLink) => {
    try {
      await hubExtraService.deleteLink(workspaceSlug, link.id);
      await refresh();
    } catch (error) {
      setToast({ type: "error", title: "Could not remove the link", message: getErrorMessage(error) });
    }
  };

  const copy = (link: THubLink) =>
    void navigator.clipboard
      ?.writeText(link.url)
      .then(() => setToast({ type: "success", title: "Link copied" }))
      .catch(() => setToast({ type: "error", title: "Could not copy" }));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-subtle px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-body-md-medium text-primary">Links</h2>
          <p className="text-caption-sm-regular text-tertiary">
            Dashboards, repositories and tools the team uses, in one place.
          </p>
        </div>
        <Button
          variant="primary"
          size="sm"
          stretch="auto"
          label="New link"
          onClick={() => setDraft(draft ? null : { ...EMPTY })}
        />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {draft ? (
          <div className="mb-4 flex max-w-2xl flex-col gap-3 rounded-xl border border-accent-strong bg-surface-1 p-4">
            <InputField
              type="text"
              size="lg"
              orientation="vertical"
              label="Link"
              value={draft.url}
              maxLength={2000}
              onChange={(event) => setDraft({ ...draft, url: event.target.value })}
              placeholder="https://grafana.example.com/d/..."
              autoComplete="off"
              spellCheck={false}
            />
            <InputField
              type="text"
              size="lg"
              orientation="vertical"
              label="Name (optional)"
              value={draft.title}
              maxLength={200}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              placeholder="For example Production dashboard"
            />
            <InputField
              type="text"
              size="lg"
              orientation="vertical"
              label="Group (optional)"
              value={draft.group}
              maxLength={60}
              list="hub-link-groups"
              onChange={(event) => setDraft({ ...draft, group: event.target.value })}
              placeholder="For example Monitoring"
            />
            <datalist id="hub-link-groups">
              {knownGroups.map((group) => (
                <option key={group} value={group} />
              ))}
            </datalist>
            <InputField
              type="text"
              size="lg"
              orientation="vertical"
              label="Note (optional)"
              value={draft.note}
              maxLength={1000}
              onChange={(event) => setDraft({ ...draft, note: event.target.value })}
              placeholder="What it is for"
            />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="md" stretch="auto" label="Cancel" onClick={() => setDraft(null)} />
              <Button
                variant="primary"
                size="md"
                stretch="auto"
                label={draft.id ? "Save" : "Add link"}
                loading={isSaving}
                disabled={!draft.url.trim()}
                onClick={save}
              />
            </div>
          </div>
        ) : null}

        {(links ?? []).length > 0 ? (
          <label className="mb-4 flex max-w-2xl items-center gap-2 rounded-lg border border-subtle px-3">
            <Search className="size-4 shrink-0 text-tertiary" aria-hidden />
            <input
              type="search"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Search links"
              aria-label="Search links"
              className="min-h-10 w-full bg-transparent text-body-sm-regular text-primary outline-none"
            />
          </label>
        ) : null}

        {links && links.length === 0 && !draft ? (
          <p className="py-6 text-center text-body-sm-regular text-tertiary">
            No links yet. Add the first one with New link.
          </p>
        ) : null}

        <div className="flex max-w-2xl flex-col gap-5">
          {groups.map(([group, items]) => (
            <section key={group || "none"} aria-label={group || "Other links"}>
              <h3 className="mb-1.5 px-1 text-caption-sm-medium tracking-wide text-tertiary uppercase">
                {group || (groups.length > 1 ? "Other" : "All links")}
              </h3>
              <ul className="flex flex-col divide-y divide-subtle overflow-hidden rounded-xl border border-subtle bg-surface-1">
                {items.map((link) => {
                  const mine = link.author.id === currentUser?.id;
                  return (
                    <li key={link.id} className="flex items-center gap-3 px-3 py-2.5">
                      <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-layer-1 text-secondary">
                        <Globe className="size-4" aria-hidden />
                      </span>
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex min-w-0 flex-1 flex-col"
                      >
                        <span className="truncate text-body-sm-medium text-primary">{link.title}</span>
                        <span className="truncate text-caption-sm-regular text-accent-primary">{hostOf(link.url)}</span>
                        {link.note ? (
                          <span className="line-clamp-2 text-caption-sm-regular text-secondary">{link.note}</span>
                        ) : null}
                      </a>
                      <div className="flex shrink-0 items-center">
                        <a
                          href={link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`Open ${link.title}`}
                          className="inline-flex size-9 items-center justify-center rounded-md text-secondary hover:bg-layer-1"
                        >
                          <ExternalLink className="size-4" aria-hidden />
                        </a>
                        <button
                          type="button"
                          aria-label={`Copy ${link.title}`}
                          onClick={() => copy(link)}
                          className="inline-flex size-9 items-center justify-center rounded-md text-secondary hover:bg-layer-1"
                        >
                          <Copy className="size-4" aria-hidden />
                        </button>
                        {mine ? (
                          <>
                            <button
                              type="button"
                              aria-label={`Edit ${link.title}`}
                              onClick={() =>
                                setDraft({
                                  id: link.id,
                                  url: link.url,
                                  title: link.title,
                                  note: link.note,
                                  group: link.group,
                                })
                              }
                              className="inline-flex size-9 items-center justify-center rounded-md text-secondary hover:bg-layer-1"
                            >
                              <Pencil className="size-4" aria-hidden />
                            </button>
                            <button
                              type="button"
                              aria-label={`Remove ${link.title}`}
                              onClick={() => void remove(link)}
                              className="inline-flex size-9 items-center justify-center rounded-md text-danger-primary hover:bg-layer-1"
                            >
                              <Trash2 className="size-4" aria-hidden />
                            </button>
                          </>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
});
