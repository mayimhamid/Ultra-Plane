/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { Eye, EyeOff, KeyRound, ShieldCheck, Sparkles } from "lucide-react";
import { Badge } from "@makeplane/propel/components/badge";
import { Button } from "@makeplane/propel/components/button";
import { CheckboxField } from "@makeplane/propel/components/checkbox-field";
import { InputField } from "@makeplane/propel/components/input-field";
import { TextAreaField } from "@makeplane/propel/components/text-area-field";
import { setToast } from "@plane/blocks/toast";
import { generatePassword } from "@plane/services";
import type { THubSecret, THubSecretKind, THubSecretLog, THubSecretReveal } from "@plane/types";
import { cn } from "@plane/utils";
// hooks
import { hubExtraService, useHubPeople, useHubSecrets } from "@/hooks/team-ops/use-hub";
// local imports
import { getErrorMessage } from "../calendar/error-message";

type Props = { workspaceSlug: string };
type TPerson = { id: string; display_name: string };

/** How long an opened value stays on screen. */
const SHOW_SECONDS = 30;
const timeFormat = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});
const ACTION: Record<THubSecretLog["action"], string> = {
  CREATE: "created it",
  REVEAL: "opened it",
  UPDATE: "changed it",
  GRANT: "gave access to",
  REVOKE: "took access from",
};

const fail = (title: string) => (error: unknown) =>
  setToast({ type: "error", title, message: error instanceof Error ? error.message : getErrorMessage(error) });

// ---- Fields ----

type TDraft = { kind: THubSecretKind; secret: string; username: string; password: string };
const EMPTY: TDraft = { kind: "SECRET", secret: "", username: "", password: "" };

/** What is sent for the value: a secret, or a username and a password. */
const valueOf = (draft: TDraft) =>
  draft.kind === "LOGIN"
    ? { kind: draft.kind, username: draft.username, password: draft.password }
    : { kind: draft.kind, secret: draft.secret };
const isFilled = (draft: TDraft) => (draft.kind === "LOGIN" ? !!draft.password : !!draft.secret);

function KindSwitch({ value, onChange }: { value: THubSecretKind; onChange: (kind: THubSecretKind) => void }) {
  const options: { kind: THubSecretKind; label: string }[] = [
    { kind: "SECRET", label: "Secret" },
    { kind: "LOGIN", label: "Username and password" },
  ];
  return (
    <div role="radiogroup" aria-label="Kind" className="inline-flex self-start rounded-lg bg-layer-1 p-0.5">
      {options.map((option) => (
        <button
          key={option.kind}
          type="button"
          role="radio"
          aria-checked={value === option.kind}
          onClick={() => onChange(option.kind)}
          className={cn(
            "min-h-9 rounded-md px-3 text-body-xs-medium",
            value === option.kind ? "bg-surface-1 text-primary shadow-raised-100" : "text-secondary hover:text-primary"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

const LENGTHS = [16, 20, 32];

/** A hidden field (show / hide), with a strong random value one tap away. */
function HiddenInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [visible, setVisible] = useState(false);
  const [length, setLength] = useState(20);
  const [symbols, setSymbols] = useState(true);
  const [generated, setGenerated] = useState(false);

  const generate = (nextLength = length, nextSymbols = symbols) => {
    onChange(generatePassword(nextLength, nextSymbols));
    setVisible(true);
    setGenerated(true);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative">
        <InputField
          type={visible ? "text" : "password"}
          size="lg"
          orientation="vertical"
          label={label}
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
            setGenerated(false);
          }}
          autoComplete="off"
          spellCheck={false}
        />
        <button
          type="button"
          aria-label={visible ? `Hide ${label}` : `Show ${label}`}
          onClick={() => setVisible(!visible)}
          className="absolute right-2 bottom-1.5 inline-flex size-8 items-center justify-center rounded-md text-tertiary hover:bg-layer-1"
        >
          {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => generate()}
          className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-subtle px-2.5 text-body-xs-medium text-accent-primary hover:bg-layer-1"
        >
          <Sparkles className="size-3.5" aria-hidden />
          {generated ? "Generate another" : `Generate ${label.toLowerCase()}`}
        </button>
        {generated ? (
          <>
            <div role="radiogroup" aria-label="Length" className="inline-flex rounded-md bg-layer-1 p-0.5">
              {LENGTHS.map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={length === option}
                  onClick={() => {
                    setLength(option);
                    generate(option, symbols);
                  }}
                  className={cn(
                    "min-h-7 rounded px-2 text-caption-sm-medium",
                    length === option ? "bg-surface-1 text-primary shadow-raised-100" : "text-secondary"
                  )}
                >
                  {option}
                </button>
              ))}
            </div>
            <CheckboxField
              size="md"
              label="Symbols"
              checked={symbols}
              onCheckedChange={() => {
                setSymbols(!symbols);
                generate(length, !symbols);
              }}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}

/** The encrypted fields: a secret, or a username and a password. */
function SecretFields({ draft, onChange }: { draft: TDraft; onChange: (draft: TDraft) => void }) {
  return (
    <>
      <KindSwitch value={draft.kind} onChange={(kind) => onChange({ ...draft, kind })} />
      {draft.kind === "LOGIN" ? (
        <>
          <InputField
            type="text"
            size="lg"
            orientation="vertical"
            label="Username"
            value={draft.username}
            onChange={(event) => onChange({ ...draft, username: event.target.value })}
            autoComplete="off"
            spellCheck={false}
          />
          <HiddenInput
            label="Password"
            value={draft.password}
            onChange={(password) => onChange({ ...draft, password })}
          />
        </>
      ) : (
        <HiddenInput label="Secret" value={draft.secret} onChange={(secret) => onChange({ ...draft, secret })} />
      )}
    </>
  );
}

function PeoplePicker({
  people,
  selected,
  onChange,
}: {
  people: TPerson[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="mb-1 text-body-xs-medium text-secondary">Show for (you always can see it)</legend>
      {people.map((person) => (
        <CheckboxField
          key={person.id}
          size="lg"
          label={person.display_name}
          checked={selected.includes(person.id)}
          onCheckedChange={() =>
            onChange(
              selected.includes(person.id) ? selected.filter((id) => id !== person.id) : [...selected, person.id]
            )
          }
        />
      ))}
    </fieldset>
  );
}

function CopyRow({ label, value, hidden }: { label: string; value: string; hidden?: boolean }) {
  const [visible, setVisible] = useState(!hidden);
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="w-20 shrink-0 text-caption-sm-medium text-tertiary">{label}</span>
      <code className="font-mono min-w-0 flex-1 text-body-sm-regular break-all text-primary">
        {visible ? value : "•".repeat(Math.min(value.length, 16))}
      </code>
      {hidden ? (
        <button
          type="button"
          aria-label={visible ? `Hide ${label}` : `Show ${label}`}
          className="inline-flex size-8 items-center justify-center rounded-md text-tertiary hover:bg-layer-2"
          onClick={() => setVisible(!visible)}
        >
          {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      ) : null}
      <button
        type="button"
        className="min-h-8 rounded-md px-2 text-body-xs-medium text-accent-primary hover:bg-layer-2"
        onClick={() =>
          void navigator.clipboard
            ?.writeText(value)
            .then(() => setToast({ type: "success", title: `${label} copied` }))
            .catch(fail("Could not copy"))
        }
      >
        Copy
      </button>
    </div>
  );
}

// ---- One secret ----

type CardProps = Props & { secret: THubSecret; people: TPerson[]; onChanged: () => Promise<unknown> };

function SecretCard({ workspaceSlug, secret, people, onChanged }: CardProps) {
  const [content, setContent] = useState<THubSecretReveal | null>(null);
  const [left, setLeft] = useState(0);
  const [sharing, setSharing] = useState<string[] | null>(null);
  const [log, setLog] = useState<THubSecretLog[] | null>(null);
  const [draft, setDraft] = useState<TDraft | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  // The opened value disappears again after a short while; it is never kept anywhere else.
  useEffect(() => {
    if (content === null) return;
    setLeft(SHOW_SECONDS);
    const interval = setInterval(() => setLeft((current) => current - 1), 1000);
    const timeout = setTimeout(() => setContent(null), SHOW_SECONDS * 1000);
    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [content]);

  const busy = async (action: () => Promise<unknown>, title: string) => {
    setIsBusy(true);
    try {
      await action();
    } catch (error) {
      fail(title)(error);
    } finally {
      setIsBusy(false);
    }
  };

  /** Every opening is logged on the server. */
  const read = () => hubExtraService.revealSecret(workspaceSlug, secret.id);

  const reveal = () => busy(async () => setContent(await read()), "Could not open the secret");

  /** Copies one field without showing it on screen. */
  const copy = (label: string, pick: (opened: THubSecretReveal) => string) =>
    busy(async () => {
      const opened = content ?? (await read());
      await navigator.clipboard.writeText(pick(opened));
      setToast({ type: "success", title: `${label} copied` });
    }, "Could not copy");

  const saveSharing = (selected: string[]) =>
    busy(async () => {
      await hubExtraService.setSecretAccess(workspaceSlug, secret.id, selected);
      await onChanged();
      setSharing(null);
    }, "Could not save who sees it");

  const saveValue = (next: TDraft) =>
    busy(async () => {
      await hubExtraService.updateSecret(workspaceSlug, secret.id, valueOf(next));
      setDraft(null);
      setContent(null);
      await onChanged();
    }, "Could not save");

  const readers = (secret.shared_with ?? [])
    .map((id) => people.find((person) => person.id === id)?.display_name)
    .filter((name): name is string => Boolean(name));

  return (
    <li className="flex flex-col gap-2 rounded-xl border border-subtle bg-surface-1 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-3">
          <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-layer-1 text-secondary">
            <KeyRound className="size-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 text-body-sm-medium text-primary">
              {secret.name}
              {secret.kind === "LOGIN" ? <Badge variant="neutral" size="sm" label="Login" /> : null}
              {secret.needs_reentry ? <Badge variant="warning" size="sm" label="Enter it again" /> : null}
            </p>
            <p className="text-caption-sm-regular text-tertiary">
              {secret.is_publisher ? "Published by you" : `Shared by ${secret.publisher.display_name}`}
              {secret.project ? ` · ${secret.project.name}` : ""}
            </p>
            {secret.description ? (
              <p className="mt-0.5 text-body-xs-regular whitespace-pre-line text-secondary">{secret.description}</p>
            ) : null}
            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-caption-sm-regular text-tertiary">
              <span className="font-medium">Show for</span>
              <span className="rounded-full bg-layer-1 px-2 py-0.5 text-secondary">
                {secret.is_publisher ? "You" : secret.publisher.display_name}
              </span>
              {readers.map((name) => (
                <span key={name} className="rounded-full bg-layer-1 px-2 py-0.5 text-secondary">
                  {name}
                </span>
              ))}
              {secret.is_publisher ? (
                <button
                  type="button"
                  className="rounded-full border border-dashed border-strong px-2 py-0.5 text-accent-primary hover:bg-layer-1"
                  onClick={() => setSharing(sharing ? null : (secret.shared_with ?? []))}
                >
                  {readers.length ? "Add or remove" : "Add people"}
                </button>
              ) : null}
            </p>
          </div>
        </div>
        {secret.needs_reentry ? (
          <span className="max-w-56 text-caption-sm-regular text-tertiary">
            {secret.is_publisher
              ? "Saved with the old vault. Use Change value to enter it again."
              : `Waiting for ${secret.publisher.display_name} to enter it again.`}
          </span>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {secret.kind === "LOGIN" ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  stretch="auto"
                  label="Copy username"
                  disabled={isBusy}
                  onClick={() => void copy("Username", (opened) => (opened.kind === "LOGIN" ? opened.username : ""))}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  stretch="auto"
                  label="Copy password"
                  disabled={isBusy}
                  onClick={() => void copy("Password", (opened) => (opened.kind === "LOGIN" ? opened.password : ""))}
                />
              </>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                stretch="auto"
                label="Copy"
                disabled={isBusy}
                onClick={() => void copy("Secret", (opened) => (opened.kind === "SECRET" ? opened.secret : ""))}
              />
            )}
            <Button
              variant="secondary"
              size="sm"
              stretch="auto"
              label={content === null ? "Reveal" : "Hide"}
              disabled={isBusy}
              onClick={() => (content === null ? void reveal() : setContent(null))}
            />
          </div>
        )}
      </div>

      {content !== null ? (
        <div className="flex flex-col gap-1 rounded-lg bg-layer-1 p-2">
          {content.kind === "LOGIN" ? (
            <>
              <CopyRow label="Username" value={content.username} />
              <CopyRow label="Password" value={content.password} hidden />
            </>
          ) : (
            <CopyRow label="Secret" value={content.secret} hidden />
          )}
          <span className="self-end text-caption-sm-regular text-tertiary">hides in {Math.max(0, left)}s</span>
        </div>
      ) : null}

      {secret.is_publisher ? (
        <div className="flex flex-wrap gap-3 text-body-xs-medium">
          <button
            type="button"
            className="text-accent-primary hover:underline"
            onClick={() =>
              void busy(
                async () => setLog(log ? null : await hubExtraService.getSecretLog(workspaceSlug, secret.id)),
                "Could not load the activity"
              )
            }
          >
            Activity
          </button>
          <button
            type="button"
            className="text-accent-primary hover:underline"
            onClick={() => setDraft(draft ? null : { ...EMPTY, kind: secret.kind })}
          >
            Change value
          </button>
          <button
            type="button"
            className="text-danger-primary hover:underline"
            onClick={() =>
              void busy(async () => {
                await hubExtraService.deleteSecret(workspaceSlug, secret.id);
                await onChanged();
              }, "Could not delete")
            }
          >
            Delete
          </button>
        </div>
      ) : null}

      {sharing ? (
        <div className="flex flex-col gap-2 border-t border-subtle pt-2">
          <PeoplePicker people={people} selected={sharing} onChange={setSharing} />
          <div>
            <Button
              variant="primary"
              size="sm"
              stretch="auto"
              label="Save who sees it"
              disabled={isBusy}
              onClick={() => void saveSharing(sharing)}
            />
          </div>
        </div>
      ) : null}

      {draft ? (
        <div className="flex max-w-lg flex-col gap-3 border-t border-subtle pt-3">
          <SecretFields draft={draft} onChange={setDraft} />
          <div className="flex gap-2">
            <Button
              variant="primary"
              size="md"
              stretch="auto"
              label="Save"
              disabled={!isFilled(draft) || isBusy}
              onClick={() => void saveValue(draft)}
            />
            <Button variant="secondary" size="md" stretch="auto" label="Cancel" onClick={() => setDraft(null)} />
          </div>
        </div>
      ) : null}

      {log ? (
        <ul className="flex flex-col gap-0.5 border-t border-subtle pt-2 text-caption-sm-regular text-secondary">
          {log.map((row) => (
            <li key={`${row.at}-${row.action}-${row.user.id}-${row.target?.id ?? ""}`}>
              {timeFormat.format(new Date(row.at))} · {row.user.display_name} {ACTION[row.action]}
              {row.target ? ` ${row.target.display_name}` : ""}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

// ---- The page ----

/** Passwords and keys, stored encrypted. Only the publisher and the people they chose can open a value. */
export const SecretsView = observer(function SecretsView({ workspaceSlug }: Props) {
  const [isCreating, setIsCreating] = useState(false);
  const [name, setName] = useState("");
  const [info, setInfo] = useState("");
  const [draft, setDraft] = useState<TDraft>(EMPTY);
  const [users, setUsers] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const { secrets, refresh } = useHubSecrets(workspaceSlug);
  const { people } = useHubPeople(workspaceSlug);

  const create = async () => {
    setIsSaving(true);
    try {
      await hubExtraService.createSecret(workspaceSlug, { name, description: info, users, ...valueOf(draft) });
      setIsCreating(false);
      setName("");
      setInfo("");
      setDraft(EMPTY);
      setUsers([]);
      await refresh();
    } catch (error) {
      fail("Could not save")(error);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-subtle px-4 py-3">
        <div>
          <h2 className="text-body-md-medium text-primary">Secrets</h2>
          <p className="text-caption-sm-regular text-tertiary">
            Stored encrypted. Only you and the people you choose can see a value, and every opening is logged.
          </p>
        </div>
        <Button
          variant="primary"
          size="sm"
          stretch="auto"
          label="New secret"
          onClick={() => setIsCreating(!isCreating)}
        />
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {isCreating ? (
          <div className="mb-4 flex max-w-2xl flex-col gap-3 rounded-xl border border-accent-strong bg-surface-1 p-4">
            <InputField
              type="text"
              size="lg"
              orientation="vertical"
              label="Name"
              value={name}
              maxLength={200}
              onChange={(event) => setName(event.target.value)}
              placeholder="For example Production database"
            />
            <SecretFields draft={draft} onChange={setDraft} />
            <TextAreaField
              size="lg"
              resize="none"
              autoResize
              maxRows={5}
              label="Info"
              value={info}
              maxLength={2000}
              onChange={(event) => setInfo(event.target.value)}
              placeholder="What it is for, where to use it (optional)"
            />
            <p className="flex items-center gap-1.5 text-caption-sm-regular text-tertiary">
              <ShieldCheck className="size-3.5 text-success-primary" aria-hidden />
              {draft.kind === "LOGIN" ? "The username and password are" : "The secret is"} stored encrypted. The name
              and info are not encrypted.
            </p>
            <PeoplePicker people={people ?? []} selected={users} onChange={setUsers} />
            <div className="flex gap-2">
              <Button
                variant="primary"
                size="md"
                stretch="auto"
                label={isSaving ? "Saving..." : "Save secret"}
                disabled={!name.trim() || !isFilled(draft) || isSaving}
                onClick={() => void create()}
              />
              <Button
                variant="secondary"
                size="md"
                stretch="auto"
                label="Cancel"
                onClick={() => setIsCreating(false)}
              />
            </div>
          </div>
        ) : null}
        <ul className="flex max-w-3xl flex-col gap-3">
          {(secrets ?? []).length === 0 ? (
            <li className="text-body-sm-regular text-tertiary">
              No secrets here. Secrets you publish, and secrets others share with you, appear in this list.
            </li>
          ) : null}
          {(secrets ?? []).map((secret) => (
            <SecretCard
              key={secret.id}
              workspaceSlug={workspaceSlug}
              secret={secret}
              people={people ?? []}
              onChanged={refresh}
            />
          ))}
        </ul>
      </div>
    </div>
  );
});
