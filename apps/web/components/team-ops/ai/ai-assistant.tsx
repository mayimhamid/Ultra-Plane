/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useRef, useState } from "react";
import { FileText, MessageSquarePlus, Search, Send, Sparkles, Square, Trash2 } from "lucide-react";
import { observer } from "mobx-react";
import Link from "next/link";
import { setToast } from "@plane/blocks/toast";
import { toDateKey } from "@plane/services";
import type { TAIChatMessage, TAISearchResult, TAISource } from "@plane/types";
import { cn } from "@plane/utils";
// hooks
import { teamAIService, useAIConversations, useAIStatus } from "@/hooks/team-ops/use-ai";
// local imports
import { getErrorMessage } from "../calendar/error-message";
import { AIMarkdown } from "./ai-markdown";

type Props = { workspaceSlug: string };
type TMode = "chat" | "summary" | "search";

const SUGGESTIONS = [
  "What should I work on first today?",
  "Write a short update about my work this week",
  "Split this into tasks: ",
];

function ChatPanel({ workspaceSlug }: Props) {
  const { conversations, refresh } = useAIConversations(workspaceSlug, true);
  const [conversation, setConversation] = useState<string | null>(null);
  const [messages, setMessages] = useState<TAIChatMessage[]>([]);
  const [sources, setSources] = useState<TAISource[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);

  const open = async (id: string) => {
    try {
      const detail = await teamAIService.getConversation(workspaceSlug, id);
      setConversation(detail.id);
      setMessages(detail.messages);
      setSources([]);
    } catch (error) {
      setToast({ type: "error", title: "Could not open", message: getErrorMessage(error) });
    }
  };

  const startNew = () => {
    abort.current?.abort();
    setConversation(null);
    setMessages([]);
    setSources([]);
  };

  const remove = async (id: string) => {
    try {
      await teamAIService.deleteConversation(workspaceSlug, id);
      if (id === conversation) startNew();
      await refresh();
    } catch (error) {
      setToast({ type: "error", title: "Could not delete", message: getErrorMessage(error) });
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setBusy(true);
    setSources([]);
    setMessages((list) => [...list, { role: "user", content: text }, { role: "assistant", content: "" }]);
    const controller = new AbortController();
    abort.current = controller;
    const appendToAnswer = (piece: string) =>
      setMessages((list) => {
        const next = [...list];
        const last = next[next.length - 1];
        next[next.length - 1] = { ...last, content: last.content + piece };
        return next;
      });
    try {
      await teamAIService.chat(
        workspaceSlug,
        { message: text, conversation },
        (event) => {
          if (event.event === "meta") {
            setConversation(event.data.conversation_id);
            setSources(event.data.sources);
          } else if (event.event === "token") appendToAnswer(event.data.text);
          else if (event.event === "error")
            appendToAnswer("\n\n(The assistant stopped: the AI service is not answering. Try again later.)");
        },
        controller.signal
      );
      await refresh();
    } catch (error) {
      if (!controller.signal.aborted) {
        setMessages((list) => list.slice(0, -1));
        setToast({ type: "error", title: "No answer", message: getErrorMessage(error) });
      }
    } finally {
      setBusy(false);
      abort.current = null;
    }
  };

  return (
    <div className="grid min-h-[60vh] gap-4 lg:grid-cols-[14rem_1fr]">
      <aside className="flex flex-col gap-1">
        <button
          type="button"
          onClick={startNew}
          className="flex min-h-9 items-center gap-2 rounded-md border border-subtle px-3 text-body-xs-medium text-secondary hover:bg-layer-1"
        >
          <MessageSquarePlus className="size-4" aria-hidden />
          New conversation
        </button>
        <ul className="flex max-h-[55vh] flex-col gap-0.5 overflow-y-auto">
          {conversations.map((item) => (
            <li key={item.id} className="group flex items-center gap-1">
              <button
                type="button"
                onClick={() => void open(item.id)}
                className={cn(
                  "min-h-9 min-w-0 flex-1 truncate rounded-md px-2 text-left text-body-xs-regular",
                  item.id === conversation ? "bg-layer-1 text-primary" : "text-secondary hover:bg-layer-1"
                )}
              >
                {item.title || "Conversation"}
              </button>
              <button
                type="button"
                aria-label={`Delete ${item.title}`}
                onClick={() => void remove(item.id)}
                className="inline-flex size-8 items-center justify-center rounded-md text-tertiary opacity-0 group-hover:opacity-100 hover:bg-layer-1 focus:opacity-100"
              >
                <Trash2 className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <section aria-label="Conversation" className="flex min-h-0 flex-col rounded-lg border border-subtle bg-surface-1">
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4" aria-live="polite">
          {messages.length === 0 ? (
            <div className="flex flex-col gap-2 text-body-sm-regular text-tertiary">
              <p>
                Ask about your work. The assistant can read the work items and documents of the projects you can open.
              </p>
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => setInput(suggestion)}
                    className="rounded-full border border-subtle px-3 py-1 text-body-xs-regular text-secondary hover:bg-layer-1"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {messages.map((message, index) => (
            <div
              // eslint-disable-next-line react/no-array-index-key -- messages only grow at the end
              key={index}
              dir="auto"
              className={cn(
                "max-w-[85%] px-4 py-2 text-body-sm-regular",
                message.role === "user"
                  ? "self-end rounded-2xl rounded-ee-sm bg-accent-primary whitespace-pre-wrap text-on-color"
                  : "self-start rounded-2xl rounded-ss-sm border border-subtle bg-layer-1 text-primary"
              )}
            >
              {message.role === "user" ? (
                message.content
              ) : message.content ? (
                <AIMarkdown source={message.content} />
              ) : busy && index === messages.length - 1 ? (
                "…"
              ) : null}
            </div>
          ))}
          {sources.length ? (
            <ul className="flex flex-wrap gap-2 text-caption-sm-regular">
              {sources.map((source) => (
                <li key={`${source.type}-${source.id}-${source.n}`}>
                  <Link
                    href={source.url || "#"}
                    className="rounded-md border border-subtle px-2 py-0.5 text-secondary hover:bg-layer-1"
                  >
                    [{source.n}] {source.title}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <form
          className="flex items-end gap-2 border-t border-subtle p-3"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <textarea
            value={input}
            rows={2}
            aria-label="Message"
            placeholder="Write a message"
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            className="min-h-11 flex-1 resize-none rounded-md border border-subtle bg-layer-1 p-2 text-body-sm-regular text-primary outline-none focus:border-accent-strong"
          />
          {busy ? (
            <button
              type="button"
              aria-label="Stop"
              onClick={() => abort.current?.abort()}
              className="inline-flex size-11 items-center justify-center rounded-md border border-subtle hover:bg-layer-1"
            >
              <Square className="size-4" aria-hidden />
            </button>
          ) : (
            <button
              type="submit"
              aria-label="Send"
              disabled={!input.trim()}
              className="inline-flex size-11 items-center justify-center rounded-md bg-accent-primary text-on-color disabled:opacity-50"
            >
              <Send className="size-4" aria-hidden />
            </button>
          )}
        </form>
      </section>
    </div>
  );
}

function SummaryPanel({ workspaceSlug }: Props) {
  const [day, setDay] = useState(toDateKey(new Date()));
  const [text, setText] = useState("");
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (request: Parameters<typeof teamAIService.summarize>[1]) => {
    setBusy(true);
    setResult("");
    try {
      const data = await teamAIService.summarize(workspaceSlug, request);
      setResult(data.summary + (data.truncated ? "\n\n(The text was long; only its beginning was read.)" : ""));
    } catch (error) {
      setToast({ type: "error", title: "No summary", message: getErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="flex flex-col gap-3">
        <section className="flex flex-col gap-2 rounded-lg border border-subtle bg-surface-1 p-4">
          <h2 className="text-body-sm-medium text-primary">My Day Report</h2>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={day}
              aria-label="Day"
              onChange={(event) => setDay(event.target.value)}
              className="h-9 rounded-md border border-subtle bg-layer-1 px-2 text-body-xs-medium text-primary"
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => void run({ kind: "day_report", date: day })}
              className="min-h-9 rounded-md bg-accent-primary px-3 text-body-xs-medium text-on-color disabled:opacity-50"
            >
              Summarize my day
            </button>
          </div>
        </section>
        <section className="flex flex-col gap-2 rounded-lg border border-subtle bg-surface-1 p-4">
          <h2 className="text-body-sm-medium text-primary">Any text</h2>
          <textarea
            value={text}
            rows={8}
            aria-label="Text to summarize"
            placeholder="Paste notes, a long message, meeting minutes or a document"
            onChange={(event) => setText(event.target.value)}
            className="rounded-md border border-subtle bg-layer-1 p-3 text-body-sm-regular text-primary outline-none focus:border-accent-strong"
          />
          <button
            type="button"
            disabled={busy || !text.trim()}
            onClick={() => void run({ kind: "text", text })}
            className="min-h-9 self-start rounded-md bg-accent-primary px-3 text-body-xs-medium text-on-color disabled:opacity-50"
          >
            Summarize
          </button>
        </section>
      </div>
      <section aria-label="Summary" aria-live="polite" className="rounded-lg border border-subtle bg-surface-1 p-4">
        <h2 className="mb-2 text-body-sm-medium text-primary">Summary</h2>
        {busy ? <p className="text-body-sm-regular text-tertiary">Reading...</p> : null}
        {result ? <AIMarkdown source={result} /> : null}
        {!busy && !result ? (
          <p className="text-body-sm-regular text-tertiary">
            The summary appears here. A work item has its own Summarize button.
          </p>
        ) : null}
      </section>
    </div>
  );
}

function SearchPanel({ workspaceSlug }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TAISearchResult[] | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (!query.trim()) return;
    setBusy(true);
    try {
      setResults((await teamAIService.search(workspaceSlug, query.trim())).results);
    } catch (error) {
      setToast({ type: "error", title: "Search failed", message: getErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void run();
        }}
      >
        <input
          value={query}
          aria-label="Search"
          placeholder="Describe what you are looking for, in your own words"
          onChange={(event) => setQuery(event.target.value)}
          className="h-10 flex-1 rounded-md border border-subtle bg-layer-1 px-3 text-body-sm-regular text-primary outline-none focus:border-accent-strong"
        />
        <button
          type="submit"
          disabled={busy}
          className="inline-flex min-h-10 items-center gap-2 rounded-md bg-accent-primary px-3 text-body-xs-medium text-on-color disabled:opacity-50"
        >
          <Search className="size-4" aria-hidden />
          Search
        </button>
      </form>
      {results && results.length === 0 ? (
        <p className="text-body-sm-regular text-tertiary">
          Nothing found. An admin can update the AI search in Dashboard › AI.
        </p>
      ) : null}
      <ul className="flex flex-col divide-y divide-subtle rounded-lg border border-subtle bg-surface-1">
        {(results ?? []).map((result) => (
          <li key={`${result.type}-${result.id}-${result.score}`} className="flex flex-col gap-0.5 px-4 py-3">
            <Link href={result.url || "#"} className="text-body-sm-medium text-primary hover:underline">
              {result.title}
            </Link>
            <span className="line-clamp-2 text-caption-sm-regular text-tertiary">{result.snippet}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Dashboard › Assistant: chat, summaries and search with the workspace's own AI. */
export const AIAssistant = observer(function AIAssistant({ workspaceSlug }: Props) {
  const { status, usable } = useAIStatus(workspaceSlug);
  const [mode, setMode] = useState<TMode>("chat");

  if (!status) return null;
  if (!usable) {
    return (
      <div className="mx-auto w-full max-w-3xl p-6">
        <p className="rounded-lg border border-dashed border-subtle p-4 text-body-sm-regular text-tertiary">
          {!status.configured
            ? "AI is not set up on this server."
            : !status.reachable
              ? "The AI service is not answering right now. Everything else works as usual."
              : "An admin turned AI off for this workspace."}
        </p>
      </div>
    );
  }

  const tabs: { key: TMode; label: string; icon: typeof Sparkles }[] = [
    { key: "chat", label: "Chat", icon: Sparkles },
    { key: "summary", label: "Summarize", icon: FileText },
    { key: "search", label: "Search", icon: Search },
  ];

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 sm:p-6">
      <div role="tablist" aria-label="Assistant" className="flex gap-1">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={mode === tab.key}
            onClick={() => setMode(tab.key)}
            className={cn(
              "inline-flex min-h-9 items-center gap-2 rounded-md px-3 text-body-xs-medium",
              mode === tab.key ? "bg-layer-1 text-primary" : "text-tertiary hover:text-secondary"
            )}
          >
            <tab.icon className="size-4" aria-hidden />
            {tab.label}
          </button>
        ))}
        <span className="ml-auto self-center text-caption-sm-regular text-tertiary">
          Local AI · {status.effort} effort
        </span>
      </div>
      {mode === "chat" ? <ChatPanel workspaceSlug={workspaceSlug} /> : null}
      {mode === "summary" ? <SummaryPanel workspaceSlug={workspaceSlug} /> : null}
      {mode === "search" ? <SearchPanel workspaceSlug={workspaceSlug} /> : null}
    </div>
  );
});
