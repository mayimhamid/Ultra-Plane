/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useSearchParams } from "react-router";
import { AtSign, BookOpen, KeyRound, Link2, Megaphone, MessagesSquare } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@makeplane/propel/components/badge";
import { Button } from "@makeplane/propel/components/button";
import { SelectField } from "@makeplane/propel/components/select-field";
import { setToast } from "@plane/blocks/toast";
import type { THubChannel } from "@plane/types";
import { cn } from "@plane/utils";
// hooks
import { hubExtraService, useHubChannels, useHubMentions, useHubPeople } from "@/hooks/team-ops/use-hub";
// local imports
import { getErrorMessage } from "../calendar/error-message";
import { ChannelView } from "./channel-view";
import { DocHubView } from "./doc-hub-view";
import { LinksView } from "./links-view";
import { SecretsView } from "./secrets-view";

type Props = { workspaceSlug: string };

const dateFormat = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

const SECTIONS = ["mentions", "docs", "files", "links", "secrets"] as const; // "files" is kept for old links
type TSection = (typeof SECTIONS)[number];
const SECTION_LABEL: Record<TSection, string> = {
  mentions: "Mentions",
  docs: "Doc Hub",
  files: "Doc Hub",
  links: "Links",
  secrets: "Secrets",
};

// A small colored tile for teams, projects and people: the first letter on a color of its own.
const HUES = [210, 340, 145, 25, 265, 185, 5, 290, 95, 45];
const tileColor = (key: string) => {
  let hash = 0;
  for (let index = 0; index < key.length; index++) hash = (hash * 31 + key.charCodeAt(index)) | 0;
  return `hsl(${HUES[Math.abs(hash) % HUES.length]} 60% 46%)`;
};

const Tile = ({ name, seed, round = false }: { name: string; seed: string; round?: boolean }) => (
  <span
    aria-hidden
    className={cn(
      "inline-flex size-7 shrink-0 items-center justify-center text-[12px] font-semibold text-white",
      round ? "rounded-full" : "rounded-md"
    )}
    style={{ backgroundColor: tileColor(seed) }}
  >
    {name.trim().charAt(0).toUpperCase() || "?"}
  </span>
);

const IconTile = ({ icon: Icon, color }: { icon: LucideIcon; color: string }) => (
  <span
    aria-hidden
    className="inline-flex size-7 shrink-0 items-center justify-center rounded-md"
    style={{ color, backgroundColor: `color-mix(in oklab, ${color} 15%, transparent)` }}
  >
    <Icon className="size-4" />
  </span>
);

const SideButton = ({
  active,
  onClick,
  children,
  badge,
  lead,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  badge?: number;
  lead?: React.ReactNode;
}) => (
  <button
    type="button"
    aria-current={active ? "page" : undefined}
    onClick={onClick}
    className={cn(
      "relative flex min-h-11 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-body-sm-regular transition-colors",
      active ? "bg-accent-subtle text-primary" : "text-secondary hover:bg-layer-1",
      badge ? "font-semibold text-primary" : ""
    )}
  >
    {active ? (
      <span aria-hidden className="absolute top-2 bottom-2 left-0 w-0.5 rounded-full bg-accent-primary" />
    ) : null}
    {lead}
    <span className="min-w-0 flex-1 truncate">{children}</span>
    {badge ? (
      <span className="min-w-5 rounded-full bg-accent-primary px-1.5 text-center text-caption-sm-medium text-on-color">
        {badge > 99 ? "99+" : badge}
      </span>
    ) : null}
  </button>
);

function Group({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-0.5">
      <h3 className="flex items-center justify-between px-2 pb-1 text-caption-sm-medium text-tertiary">
        <span>{title}</span>
        {count ? <span className="text-accent-primary tabular-nums">{count} new</span> : null}
      </h3>
      {children}
    </section>
  );
}

/** Where tags and attention requests land: everything the caller was tagged in, newest first. */
const MentionsView = observer(function MentionsView({
  workspaceSlug,
  onOpenChannel,
}: Props & { onOpenChannel: (id: string) => void }) {
  const { mentions, markAllRead } = useHubMentions(workspaceSlug, true);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center justify-between gap-2 border-b border-subtle px-4 py-3">
        <h2 className="text-body-md-medium text-primary">Mentions and attention requests</h2>
        <Button variant="secondary" size="sm" stretch="auto" label="Mark all read" onClick={() => markAllRead()} />
      </header>
      <ul className="min-h-0 flex-1 divide-y divide-subtle overflow-y-auto">
        {(mentions ?? []).length === 0 ? (
          <li className="px-4 py-6 text-center text-body-sm-regular text-tertiary">Nobody has tagged you yet.</li>
        ) : null}
        {(mentions ?? []).map((mention) => (
          <li key={mention.id}>
            <button
              type="button"
              onClick={() => onOpenChannel(mention.channel)}
              className={cn(
                "flex w-full flex-col gap-0.5 px-4 py-3 text-left hover:bg-layer-1",
                !mention.read && "bg-accent-subtle"
              )}
            >
              <span className="flex flex-wrap items-center gap-2 text-body-sm-medium text-primary">
                {mention.author.display_name}
                {mention.kind === "ATTENTION" ? <Badge variant="warning" size="sm" label="Needs attention" /> : null}
                {mention.via_team ? (
                  <span className="text-caption-sm-regular text-tertiary">via team {mention.via_team}</span>
                ) : null}
                <span className="ml-auto text-caption-sm-regular text-tertiary">
                  {dateFormat.format(new Date(mention.created_at))}
                </span>
              </span>
              <span className="line-clamp-2 text-body-sm-regular whitespace-pre-line text-secondary">
                {mention.body}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
});

/** Chat, news, private messages, documents, files and secrets for the people of a workspace. */
export const HubRoot = observer(function HubRoot({ workspaceSlug }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { channels, unreadMentions, isLoading, refresh } = useHubChannels(workspaceSlug);
  const { people } = useHubPeople(workspaceSlug);
  const list = channels ?? [];
  const requestedChannel = searchParams.get("channel");
  const requestedSection = searchParams.get("section");
  const section =
    SECTIONS.find((item) => item === requestedSection) ?? (requestedChannel === "mentions" ? "mentions" : null);
  const fallback = list.find((channel) => channel.kind === "GENERAL") ?? list[0] ?? null;
  const active: THubChannel | null = section
    ? null
    : (list.find((channel) => channel.id === requestedChannel) ?? fallback);

  // On a phone the list of channels and the chat are two screens: the list until something is chosen
  const hasChoice = Boolean(requestedChannel || requestedSection);
  const openChannel = (id: string) => setSearchParams({ channel: id });
  const openSection = (next: TSection) => setSearchParams({ section: next });

  const startDirect = async (user: string | null) => {
    if (!user) return;
    try {
      const channel = await hubExtraService.openDirect(workspaceSlug, user);
      await refresh();
      openChannel(channel.id);
    } catch (error) {
      setToast({ type: "error", title: "Could not open", message: getErrorMessage(error) });
    }
  };

  const ofKind = (...kinds: THubChannel["kind"][]) => list.filter((channel) => kinds.includes(channel.kind));
  const leadOf = (channel: THubChannel) => {
    if (channel.kind === "GENERAL") return <IconTile icon={MessagesSquare} color="#2563eb" />;
    if (channel.kind === "NEWS") return <IconTile icon={Megaphone} color="#c026d3" />;
    if (channel.kind === "DM") return <Tile name={channel.name} seed={channel.id} round />;
    return <Tile name={channel.name} seed={channel.project ?? channel.team ?? channel.id} />;
  };
  const channelButton = (channel: THubChannel) => (
    <SideButton
      key={channel.id}
      active={active?.id === channel.id}
      onClick={() => openChannel(channel.id)}
      badge={channel.unread}
      lead={leadOf(channel)}
    >
      {channel.name}
    </SideButton>
  );
  const unreadOf = (...kinds: THubChannel["kind"][]) =>
    ofKind(...kinds).reduce((sum, channel) => sum + (channel.unread || 0), 0);

  return (
    <div className="flex h-full min-h-0 w-full overflow-hidden">
      <aside
        aria-label="Hub"
        className={cn(
          "w-full shrink-0 flex-col gap-5 overflow-y-auto overscroll-contain border-subtle bg-surface-1 p-3 md:flex md:w-72 md:border-r",
          hasChoice ? "hidden" : "flex"
        )}
      >
        <Group title="Inbox">
          <SideButton
            active={section === "mentions"}
            onClick={() => openSection("mentions")}
            badge={unreadMentions}
            lead={<IconTile icon={AtSign} color="#ea580c" />}
          >
            {SECTION_LABEL.mentions}
          </SideButton>
        </Group>
        <Group title="Everyone" count={unreadOf("NEWS", "GENERAL")}>
          {ofKind("GENERAL", "NEWS").map(channelButton)}
        </Group>
        {ofKind("TEAM").length > 0 ? (
          <Group title="Teams" count={unreadOf("TEAM")}>
            {ofKind("TEAM").map(channelButton)}
          </Group>
        ) : null}
        {ofKind("PROJECT").length > 0 ? (
          <Group title="Projects" count={unreadOf("PROJECT")}>
            {ofKind("PROJECT").map(channelButton)}
          </Group>
        ) : null}
        <Group title="Private messages" count={unreadOf("DM")}>
          {ofKind("DM").map(channelButton)}
          <div className="px-1 pt-1 [&_button]:min-w-0">
            <SelectField
              size="lg"
              label="New message"
              hint="Choose a person to start a private chat"
              options={(people ?? []).map((person) => ({ value: person.id, label: person.display_name }))}
              value={undefined}
              onValueChange={(value) => void startDirect(value)}
            />
          </div>
        </Group>
        <Group title="Library">
          {(["docs", "links", "secrets"] as const).map((item) => (
            <SideButton
              key={item}
              active={section === item || (item === "docs" && section === "files")}
              onClick={() => openSection(item)}
              lead={
                item === "docs" ? (
                  <IconTile icon={BookOpen} color="#0d9488" />
                ) : item === "links" ? (
                  <IconTile icon={Link2} color="#2563eb" />
                ) : (
                  <IconTile icon={KeyRound} color="#475569" />
                )
              }
            >
              {SECTION_LABEL[item]}
            </SideButton>
          ))}
        </Group>
        {!isLoading && list.length === 0 ? (
          <p className="px-3 text-body-xs-regular text-tertiary">Channels appear when you join a team or a project.</p>
        ) : null}
      </aside>
      <section className={cn("min-h-0 min-w-0 flex-1 flex-col md:flex", hasChoice ? "flex" : "hidden")}>
        {/* The chat has its own header with a back button; the other sections get this bar on phones. */}
        {section || !active ? (
          <button
            type="button"
            onClick={() => setSearchParams({})}
            className="flex items-center gap-1.5 border-b border-subtle px-3 py-2.5 text-left text-body-sm-medium text-accent-primary md:hidden"
          >
            <span aria-hidden>&larr;</span> Hub
          </button>
        ) : null}
        <div className="min-h-0 flex-1">
          {section === "mentions" ? <MentionsView workspaceSlug={workspaceSlug} onOpenChannel={openChannel} /> : null}
          {section === "docs" || section === "files" ? <DocHubView workspaceSlug={workspaceSlug} /> : null}
          {section === "links" ? <LinksView workspaceSlug={workspaceSlug} /> : null}
          {section === "secrets" ? <SecretsView workspaceSlug={workspaceSlug} /> : null}
          {!section && active ? (
            // On a phone an open chat covers the whole screen, with no frame or page bar; its back button
            // returns to the channel list.
            <div className="h-full max-md:fixed max-md:inset-x-0 max-md:top-0 max-md:z-40 max-md:h-dvh max-md:bg-surface-1">
              <ChannelView
                key={active.id}
                workspaceSlug={workspaceSlug}
                channel={active}
                onRead={() => void refresh()}
                onBack={() => setSearchParams({})}
              />
            </div>
          ) : null}
          {!section && !active ? <p className="p-6 text-body-sm-regular text-tertiary">Choose a channel.</p> : null}
        </div>
      </section>
    </div>
  );
});
