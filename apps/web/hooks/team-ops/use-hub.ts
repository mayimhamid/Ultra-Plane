/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { sortBy } from "lodash-es";
import useSWR from "swr";
// plane imports
import { FlowService, HubExtraService, HubService } from "@plane/services";
import type { THubMessage, THubMessagePayload } from "@plane/types";

const hubService = new HubService();

// New messages from others appear within this time without a reload.
const POLL_MS = 8000;

/** The channels the caller belongs to, with unread counts. */
export const useHubChannels = (workspaceSlug: string) => {
  const { data, error, isLoading, mutate } = useSWR(
    `TEAM_OPS_HUB_CHANNELS_${workspaceSlug}`,
    () => hubService.listChannels(workspaceSlug),
    { refreshInterval: POLL_MS }
  );
  return { channels: data?.results, unreadMentions: data?.unread_mentions ?? 0, error, isLoading, refresh: mutate };
};

// Messages of a page, and how often the open channel asks for what changed.
const MESSAGE_POLL_MS = 5000;

/** Keeps a channel's messages in order: new ones are added, changed ones (edited, deleted) replaced. */
const merge = (current: THubMessage[], incoming: THubMessage[]) => {
  const byId = new Map(current.map((message) => [message.id, message]));
  incoming.forEach((message) => byId.set(message.id, message));
  return sortBy([...byId.values()], (message) => message.created_at);
};

/**
 * One open channel: its members (for tagging), its messages and the actions on them. Like a messenger, it loads
 * only the newest page, older pages when asked (scrolling up), and then polls for what changed since the last look.
 */
export const useHubChannel = (workspaceSlug: string, channelId: string | null, onRead: () => void) => {
  const { data: channel } = useSWR(channelId && `TEAM_OPS_HUB_CHANNEL_${channelId}`, () =>
    hubService.getChannel(workspaceSlug, channelId!)
  );
  const [messages, setMessages] = useState<THubMessage[] | undefined>(undefined);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const since = useRef<string | null>(null);
  const current = useRef<string | null>(channelId);
  const onReadRef = useRef(onRead);
  onReadRef.current = onRead;

  // The newest page when the channel opens (it marks the channel read on the server).
  useEffect(() => {
    current.current = channelId;
    setMessages(undefined);
    setHasMore(false);
    setError(null);
    since.current = null;
    if (!channelId) return;
    const load = async () => {
      try {
        const page = await hubService.listMessages(workspaceSlug, channelId);
        if (current.current !== channelId) return;
        setMessages(page.results);
        setHasMore(page.has_more);
        since.current = page.server_time;
        onReadRef.current();
      } catch (failure) {
        if (current.current === channelId) setError(failure ?? true);
      }
    };
    void load();
  }, [workspaceSlug, channelId]);

  /** What changed since the last look; cheap, so it runs often while the page is visible. */
  const poll = useCallback(async () => {
    if (!channelId || !since.current) return;
    const page = await hubService.listMessages(workspaceSlug, channelId, undefined, since.current);
    if (current.current !== channelId) return;
    since.current = page.server_time;
    if (page.results.length > 0) {
      setMessages((list) => merge(list ?? [], page.results));
      onReadRef.current();
    }
  }, [workspaceSlug, channelId]);

  useEffect(() => {
    if (!channelId) return;
    const tick = () => {
      if (document.visibilityState === "visible") void poll().catch(() => undefined);
    };
    const interval = window.setInterval(tick, MESSAGE_POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [channelId, poll]);

  /** The page before the oldest loaded message; `false` when there is nothing more. */
  const loadOlder = useCallback(async () => {
    if (!channelId || !hasMore || isLoadingOlder || !messages?.length) return false;
    setIsLoadingOlder(true);
    try {
      const page = await hubService.listMessages(workspaceSlug, channelId, messages[0].id);
      if (current.current !== channelId) return false;
      setMessages((list) => merge(list ?? [], page.results));
      setHasMore(page.has_more);
      return page.results.length > 0;
    } finally {
      setIsLoadingOlder(false);
    }
  }, [workspaceSlug, channelId, hasMore, isLoadingOlder, messages]);

  const send = useCallback(
    async (payload: THubMessagePayload) => {
      const message = await hubService.postMessage(workspaceSlug, channelId!, payload);
      setMessages((list) => merge(list ?? [], [message]));
      await poll().catch(() => undefined);
      return message;
    },
    [workspaceSlug, channelId, poll]
  );

  const edit = useCallback(
    async (messageId: string, body: string) => {
      await hubService.editMessage(workspaceSlug, messageId, body);
      await poll();
    },
    [workspaceSlug, poll]
  );

  const react = useCallback(
    async (messageId: string, emoji: string) => {
      const message = await hubService.reactToMessage(workspaceSlug, messageId, emoji);
      setMessages((list) => merge(list ?? [], [message]));
    },
    [workspaceSlug]
  );

  // The pinned messages, first pinned first. They are asked for apart from the messages, so a pin that is older
  // than the loaded page is still there; a pin or an unpin by anyone shows up within a few seconds.
  const { data: pins, mutate: refreshPins } = useSWR(
    channelId && `TEAM_OPS_HUB_PINS_${channelId}`,
    () => hubService.listPins(workspaceSlug, channelId!),
    { refreshInterval: MESSAGE_POLL_MS * 2 }
  );

  const pin = useCallback(
    async (messageId: string, pinned: boolean) => {
      const message = await hubService.pinMessage(workspaceSlug, messageId, pinned);
      setMessages((list) => merge(list ?? [], [message]));
      await refreshPins();
    },
    [workspaceSlug, refreshPins]
  );

  /** Puts messages that are older than the loaded page in the list, so they can be scrolled to. */
  const addMessages = useCallback((extra: THubMessage[]) => setMessages((list) => merge(list ?? [], extra)), []);

  const remove = useCallback(
    async (messageId: string) => {
      await hubService.deleteMessage(workspaceSlug, messageId);
      await poll();
    },
    [workspaceSlug, poll]
  );

  /** Asks for a fresh signed link and opens it; links expire after a few minutes, so none is kept. */
  const openFile = useCallback(
    async (fileId: string) => {
      const { url } = await hubService.getFileLink(workspaceSlug, fileId);
      window.open(url, "_blank", "noopener,noreferrer");
    },
    [workspaceSlug]
  );

  return {
    channel,
    messages,
    hasMore,
    isLoadingOlder,
    loadOlder,
    react,
    pins: pins ?? [],
    pin,
    addMessages,
    error,
    isLoading: messages === undefined && !error,
    send,
    edit,
    remove,
    openFile,
  };
};

/** Where the caller was tagged. */
export const useHubMentions = (workspaceSlug: string, enabled: boolean) => {
  const { data, mutate } = useSWR(
    enabled ? `TEAM_OPS_HUB_MENTIONS_${workspaceSlug}` : null,
    () => hubService.listMentions(workspaceSlug),
    { refreshInterval: POLL_MS }
  );
  const markAllRead = useCallback(async () => {
    await hubService.markMentionsRead(workspaceSlug);
    await mutate();
  }, [workspaceSlug, mutate]);
  return { mentions: data, markAllRead };
};

export { hubService };

const hubExtraService = new HubExtraService();
const flowService = new FlowService();

/** Colleagues the caller can write to privately. */
export const useHubPeople = (workspaceSlug: string) => {
  const { data } = useSWR(`TEAM_OPS_HUB_PEOPLE_${workspaceSlug}`, () => hubExtraService.listPeople(workspaceSlug));
  return { people: data };
};

export const useHubDocs = (workspaceSlug: string, params: { q?: string; tag?: string; project?: string }) => {
  const key = `TEAM_OPS_HUB_DOCS_${workspaceSlug}_${JSON.stringify(params)}`;
  const { data, mutate } = useSWR(key, () => hubExtraService.listDocs(workspaceSlug, params));
  return { docs: data?.results, tags: data?.tags ?? [], refresh: mutate };
};

export const useHubFiles = (workspaceSlug: string) => {
  const { data, mutate } = useSWR(`TEAM_OPS_HUB_LIBRARY_${workspaceSlug}`, () =>
    hubExtraService.listFiles(workspaceSlug)
  );
  return { files: data, refresh: mutate };
};

export const useHubLinks = (workspaceSlug: string) => {
  const { data, mutate } = useSWR(`TEAM_OPS_HUB_LINKS_${workspaceSlug}`, () =>
    hubExtraService.listLinks(workspaceSlug)
  );
  return { links: data, refresh: mutate };
};

export const useHubSecrets = (workspaceSlug: string) => {
  const { data, mutate } = useSWR(`TEAM_OPS_HUB_SECRETS_${workspaceSlug}`, () =>
    hubExtraService.listSecrets(workspaceSlug)
  );
  return { secrets: data, refresh: mutate };
};

/** The flows the caller may see, with everyone's progress, refreshed every 30 seconds. */
export const useFlows = (workspaceSlug: string) => {
  const { data, error, mutate } = useSWR(`TEAM_OPS_FLOWS_${workspaceSlug}`, () => flowService.list(workspaceSlug), {
    refreshInterval: 30_000,
  });
  return { flows: data?.results, canManage: data?.can_manage ?? false, error, refresh: mutate };
};

export { hubExtraService, flowService };
