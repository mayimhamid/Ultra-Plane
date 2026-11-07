/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef, useState } from "react";
import { observer } from "mobx-react";
import useSWR from "swr";
import { Eye, EyeOff, KeyRound, Lock, ShieldCheck } from "lucide-react";
import { Badge } from "@makeplane/propel/components/badge";
import { Button } from "@makeplane/propel/components/button";
import { CheckboxField } from "@makeplane/propel/components/checkbox-field";
import { InputField } from "@makeplane/propel/components/input-field";
import { TextAreaField } from "@makeplane/propel/components/text-area-field";
import { setToast } from "@plane/blocks/toast";
import { vaultCrypto } from "@plane/services";
import type { THubSecret, THubSecretKind, THubSecretLog, THubVault } from "@plane/types";
import { cn } from "@plane/utils";
// hooks
import { hubExtraService, useHubPeople, useHubSecrets } from "@/hooks/team-ops/use-hub";
import { lockVault, setUnlockedVault, useVault } from "@/hooks/team-ops/use-vault";
// local imports
import { getErrorMessage } from "../calendar/error-message";

type Props = { workspaceSlug: string };
type TUnlocked = vaultCrypto.TUnlockedVault;
type TContent = vaultCrypto.TSecretContent;
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

/** Public keys of the given people who have a vault (people without one wait for their key). */
const keysOf = (workspaceSlug: string, ids: string[]) => hubExtraService.getPublicKeys(workspaceSlug, ids);

// ---- Vault ----

function PassphraseInput({
  value,
  onChange,
  label,
  autoComplete,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  autoComplete: string;
}) {
  return (
    <InputField
      type="password"
      size="lg"
      orientation="vertical"
      label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      autoComplete={autoComplete}
      spellCheck={false}
    />
  );
}

function VaultSetup({ workspaceSlug, onReady }: Props & { onReady: (vault: THubVault, unlocked: TUnlocked) => void }) {
  const [passphrase, setPassphrase] = useState("");
  const [again, setAgain] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const short = passphrase.length < vaultCrypto.MIN_PASSPHRASE;

  const create = async () => {
    setIsBusy(true);
    try {
      const { vault, unlocked } = await vaultCrypto.createVault(passphrase);
      await hubExtraService.createVault(workspaceSlug, vault);
      onReady(vault, unlocked);
    } catch (error) {
      fail("Could not set up the vault")(error);
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-md flex-col gap-3 rounded-xl border border-subtle bg-surface-1 p-5">
      <ShieldCheck className="size-8 text-success-primary" aria-hidden />
      <h3 className="text-body-md-semibold text-primary">Set up your vault</h3>
      <p className="text-body-xs-regular text-secondary">
        Secrets and passwords are encrypted on this device with a vault passphrase that only you know. The server keeps
        only scrambled data: nobody can read it, not an admin and not someone who gets into the server.
      </p>
      <PassphraseInput
        label="Vault passphrase"
        value={passphrase}
        onChange={setPassphrase}
        autoComplete="new-password"
      />
      <PassphraseInput label="Passphrase again" value={again} onChange={setAgain} autoComplete="new-password" />
      <p className={cn("text-caption-sm-regular", short ? "text-tertiary" : "text-success-primary")}>
        At least {vaultCrypto.MIN_PASSPHRASE} characters. A few words you can remember works well.
      </p>
      <p className="rounded-md bg-warning-subtle p-2 text-caption-sm-regular text-warning-primary">
        It cannot be recovered. If you forget it, secrets you published are lost; secrets shared with you can be shared
        again.
      </p>
      <Button
        stretch="auto"
        variant="primary"
        size="lg"
        label={isBusy ? "Setting up..." : "Create vault"}
        disabled={short || passphrase !== again || isBusy}
        onClick={() => void create()}
      />
    </div>
  );
}

function VaultUnlock({
  workspaceSlug,
  vault,
  onUnlocked,
  onReset,
}: Props & { vault: THubVault; onUnlocked: (unlocked: TUnlocked) => void; onReset: () => Promise<unknown> }) {
  const [passphrase, setPassphrase] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmReset, setConfirmReset] = useState("");
  const [showReset, setShowReset] = useState(false);

  const unlock = async () => {
    setIsBusy(true);
    setError("");
    try {
      onUnlocked(await vaultCrypto.unlockVault(vault, passphrase));
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not open the vault.");
    } finally {
      setIsBusy(false);
      setPassphrase("");
    }
  };

  return (
    <form
      className="mx-auto flex max-w-md flex-col gap-3 rounded-xl border border-subtle bg-surface-1 p-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (passphrase) void unlock();
      }}
    >
      <Lock className="size-8 text-secondary" aria-hidden />
      <h3 className="text-body-md-semibold text-primary">Your vault is locked</h3>
      <p className="text-body-xs-regular text-secondary">
        Enter your vault passphrase. It opens the vault on this device only and is never sent to the server.
      </p>
      <PassphraseInput
        label="Vault passphrase"
        value={passphrase}
        onChange={setPassphrase}
        autoComplete="current-password"
      />
      {error ? (
        <p role="alert" className="text-body-xs-regular text-danger-primary">
          {error}
        </p>
      ) : null}
      <Button
        stretch="auto"
        type="submit"
        variant="primary"
        size="lg"
        label={isBusy ? "Opening..." : "Unlock"}
        disabled={!passphrase || isBusy}
      />
      <button
        type="button"
        className="self-start text-caption-sm-medium text-tertiary hover:text-danger-primary"
        onClick={() => setShowReset(!showReset)}
      >
        Forgot the passphrase?
      </button>
      {showReset ? (
        <div className="flex flex-col gap-2 rounded-md border border-danger-subtle p-3">
          <p className="text-caption-sm-regular text-danger-primary">
            Starting a new vault deletes every secret you published: nobody can open them without your passphrase.
            Secrets others shared with you come back when they open their vault. Type RESET to go on.
          </p>
          <InputField
            size="md"
            orientation="vertical"
            value={confirmReset}
            onChange={(event) => setConfirmReset(event.target.value)}
            aria-label="Type RESET"
          />
          <Button
            stretch="auto"
            variant="danger"
            size="md"
            label="Delete my vault and start again"
            disabled={confirmReset !== "RESET"}
            onClick={() =>
              void hubExtraService.resetVault(workspaceSlug).then(onReset).catch(fail("Could not reset the vault"))
            }
          />
        </div>
      ) : null}
    </form>
  );
}

function ChangePassphrase({ workspaceSlug, vault, onDone }: Props & { vault: THubVault; onDone: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  const save = async () => {
    setIsBusy(true);
    try {
      const changed = await vaultCrypto.changePassphrase(vault, current, next);
      await hubExtraService.changeVaultPassphrase(workspaceSlug, changed);
      setToast({ type: "success", title: "Vault passphrase changed" });
      onDone();
    } catch (error) {
      fail("Could not change the passphrase")(error);
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="mb-4 flex max-w-md flex-col gap-3 rounded-xl border border-subtle bg-surface-1 p-4">
      <PassphraseInput
        label="Current passphrase"
        value={current}
        onChange={setCurrent}
        autoComplete="current-password"
      />
      <PassphraseInput label="New passphrase" value={next} onChange={setNext} autoComplete="new-password" />
      <PassphraseInput label="New passphrase again" value={again} onChange={setAgain} autoComplete="new-password" />
      <div className="flex gap-2">
        <Button
          stretch="auto"
          variant="primary"
          size="md"
          label={isBusy ? "Saving..." : "Change passphrase"}
          disabled={!current || next.length < vaultCrypto.MIN_PASSPHRASE || next !== again || isBusy}
          onClick={() => void save()}
        />
        <Button stretch="auto" variant="secondary" size="md" label="Cancel" onClick={onDone} />
      </div>
    </div>
  );
}

// ---- One secret ----

type TDraft = { kind: THubSecretKind; secret: string; username: string; password: string };
const EMPTY: TDraft = { kind: "SECRET", secret: "", username: "", password: "" };

const toContent = (draft: TDraft): TContent =>
  draft.kind === "LOGIN"
    ? { kind: "LOGIN", username: draft.username, password: draft.password }
    : { kind: "SECRET", secret: draft.secret };
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

function HiddenInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <InputField
        type={visible ? "text" : "password"}
        size="lg"
        orientation="vertical"
        label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
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
  withVault,
  onChange,
}: {
  people: TPerson[];
  selected: string[];
  withVault: Record<string, string>;
  onChange: (ids: string[]) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="mb-1 text-body-xs-medium text-secondary">Show for (you always can see it)</legend>
      {people.map((person) => (
        <div key={person.id} className="flex items-center gap-2">
          <CheckboxField
            size="lg"
            label={person.display_name}
            checked={selected.includes(person.id)}
            onCheckedChange={() =>
              onChange(
                selected.includes(person.id) ? selected.filter((id) => id !== person.id) : [...selected, person.id]
              )
            }
          />
          {withVault[person.id] ? null : (
            <span className="text-caption-sm-regular text-tertiary">no vault yet: gets it after setting one up</span>
          )}
        </div>
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

type CardProps = Props & {
  secret: THubSecret;
  people: TPerson[];
  withVault: Record<string, string>;
  unlocked: TUnlocked;
  onChanged: () => Promise<unknown>;
};

function SecretCard({ workspaceSlug, secret, people, withVault, unlocked, onChanged }: CardProps) {
  const [content, setContent] = useState<TContent | null>(null);
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

  /** Opens the secret on this device. Every opening is logged on the server, like a reveal. */
  const read = async (): Promise<TContent> => {
    const sealed = await hubExtraService.revealSecret(workspaceSlug, secret.id);
    return sealed.e2e ? await vaultCrypto.open(sealed, unlocked) : { kind: "SECRET", secret: sealed.value };
  };

  const reveal = () => busy(async () => setContent(await read()), "Could not open the secret");

  /** Copies one field without showing it on screen. */
  const copy = (label: string, pick: (opened: TContent) => string) =>
    busy(async () => {
      const opened = content ?? (await read());
      await navigator.clipboard.writeText(pick(opened));
      setToast({ type: "success", title: `${label} copied` });
    }, "Could not copy");

  const saveSharing = (selected: string[]) =>
    busy(async () => {
      const added = selected.filter((id) => !(secret.shared_with ?? []).includes(id));
      const publicKeys = await keysOf(workspaceSlug, added);
      // The secret's key, opened with the publisher's own copy and wrapped for each new reader with a vault.
      const keys =
        secret.e2e && secret.owner_key ? await vaultCrypto.rewrap(secret.owner_key, unlocked, publicKeys) : {};
      await hubExtraService.setSecretAccess(workspaceSlug, secret.id, selected, keys);
      await onChanged();
      setSharing(null);
    }, "Could not save access");

  const saveValue = (next: TDraft) =>
    busy(async () => {
      // A new value gets a new key, wrapped again for everyone who may read it.
      const readers = await keysOf(workspaceSlug, secret.shared_with ?? []);
      const sealed = await vaultCrypto.seal(toContent(next), unlocked.publicKey, readers);
      await hubExtraService.updateSecret(workspaceSlug, secret.id, sealed);
      setDraft(null);
      setContent(null);
      await onChanged();
    }, "Could not save");

  const waiting = secret.waiting ?? [];
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
              <Badge
                variant={secret.e2e ? "success" : "warning"}
                size="sm"
                label={secret.e2e ? "End-to-end" : "Old encryption"}
              />
              {secret.kind === "LOGIN" ? <Badge variant="neutral" size="sm" label="Login" /> : null}
            </p>
            <p className="text-caption-sm-regular text-tertiary">
              {secret.is_publisher ? "Published by you" : `Shared by ${secret.publisher.display_name}`}
              {secret.project ? ` · ${secret.project.name}` : ""}
              {waiting.length ? ` · ${waiting.length} waiting for a vault` : ""}
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
        {secret.is_waiting ? (
          <span className="text-caption-sm-regular text-tertiary">
            Opens once {secret.publisher.display_name} opens their vault
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
          <PeoplePicker people={people} selected={sharing} withVault={withVault} onChange={setSharing} />
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

// ---- After unlocking: finish what was waiting ----

/**
 * Old server-key secrets the caller published are sealed again end to end, and readers who were waiting for
 * their key (they had no vault yet) get it. Both happen in this browser: the server never sees a key.
 */
async function catchUp(workspaceSlug: string, unlocked: TUnlocked, secrets: THubSecret[]) {
  const old = secrets.filter((item) => item.is_publisher && !item.e2e);
  const converted = await Promise.all(
    old.map(async (secret) => {
      const opened = await hubExtraService.revealSecret(workspaceSlug, secret.id);
      if (opened.e2e) return 0;
      const readers = await keysOf(workspaceSlug, secret.shared_with ?? []);
      const sealed = await vaultCrypto.seal({ kind: "SECRET", secret: opened.value }, unlocked.publicKey, readers);
      await hubExtraService.convertSecret(workspaceSlug, secret.id, sealed);
      return 1;
    })
  );
  const pending = await hubExtraService.getPendingKeys(workspaceSlug);
  const wrapped = await Promise.allSettled(
    pending.map(async (item) => {
      const keys = await vaultCrypto.rewrap(item.owner_key, unlocked, { [item.user]: item.public_key });
      return { secret: item.secret, user: item.user, wrapped_key: keys[item.user] };
    })
  );
  // A secret this vault cannot open (published before a vault reset) is skipped.
  const items = wrapped.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
  const shared = items.length ? await hubExtraService.fillPendingKeys(workspaceSlug, items) : 0;
  return { converted: converted.filter(Boolean).length, shared };
}

// ---- The page ----

/** Passwords and keys, encrypted end to end. Only the publisher and the people they chose can open a value. */
export const SecretsView = observer(function SecretsView({ workspaceSlug }: Props) {
  const [isCreating, setIsCreating] = useState(false);
  const [isChanging, setIsChanging] = useState(false);
  const [name, setName] = useState("");
  const [info, setInfo] = useState("");
  const [draft, setDraft] = useState<TDraft>(EMPTY);
  const [users, setUsers] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const { secrets, refresh } = useHubSecrets(workspaceSlug);
  const { people } = useHubPeople(workspaceSlug);
  const { vault, isLoading, refreshVault, unlocked } = useVault(workspaceSlug);
  const caughtUp = useRef(false);
  const { data: withVault = {} } = useSWR(
    unlocked && people ? `TEAM_OPS_HUB_VAULT_KEYS_${workspaceSlug}_${people.length}` : null,
    () =>
      keysOf(
        workspaceSlug,
        (people ?? []).map((person) => person.id)
      )
  );

  // Once per opening: convert old secrets and hand keys to readers who were waiting.
  useEffect(() => {
    if (!unlocked) {
      caughtUp.current = false;
      return;
    }
    if (caughtUp.current || !secrets) return;
    caughtUp.current = true;
    void catchUp(workspaceSlug, unlocked, secrets)
      .then(({ converted, shared }) => {
        if (converted || shared)
          setToast({
            type: "success",
            title: "Vault up to date",
            message: [
              converted ? `${converted} old secret(s) are now encrypted end to end.` : "",
              shared ? `${shared} colleague(s) received keys they were waiting for.` : "",
            ]
              .filter(Boolean)
              .join(" "),
          });
        return converted || shared ? refresh() : undefined;
      })
      .catch(fail("Could not update the vault"));
  }, [unlocked, secrets, workspaceSlug, refresh]);

  const create = async () => {
    if (!unlocked) return;
    setIsSaving(true);
    try {
      const readers = await keysOf(workspaceSlug, users);
      const sealed = await vaultCrypto.seal(toContent(draft), unlocked.publicKey, readers);
      await hubExtraService.createSecret(workspaceSlug, { name, description: info, users, ...sealed });
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

  let body;
  if (isLoading || vault === undefined) {
    body = <p className="text-body-sm-regular text-tertiary">Loading...</p>;
  } else if (vault === null) {
    body = (
      <VaultSetup
        workspaceSlug={workspaceSlug}
        onReady={(created, opened) => {
          void refreshVault(created, { revalidate: false });
          setUnlockedVault(workspaceSlug, opened);
        }}
      />
    );
  } else if (!unlocked) {
    body = (
      <VaultUnlock
        workspaceSlug={workspaceSlug}
        vault={vault}
        onUnlocked={(opened) => setUnlockedVault(workspaceSlug, opened)}
        onReset={async () => {
          await refreshVault(null, { revalidate: false });
          await refresh();
        }}
      />
    );
  } else {
    body = (
      <>
        {isChanging ? (
          <ChangePassphrase
            workspaceSlug={workspaceSlug}
            vault={vault}
            onDone={() => {
              setIsChanging(false);
              void refreshVault();
            }}
          />
        ) : null}
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
              {draft.kind === "LOGIN" ? "The username and password are" : "The secret is"} encrypted on this device
              before it is sent. The name and info are not encrypted.
            </p>
            <PeoplePicker people={people ?? []} selected={users} withVault={withVault} onChange={setUsers} />
            <div className="flex gap-2">
              <Button
                variant="primary"
                size="md"
                stretch="auto"
                label={isSaving ? "Encrypting..." : "Save secret"}
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
              withVault={withVault}
              unlocked={unlocked}
              onChanged={refresh}
            />
          ))}
        </ul>
      </>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-subtle px-4 py-3">
        <div>
          <h2 className="text-body-md-medium text-primary">Secrets</h2>
          <p className="text-caption-sm-regular text-tertiary">
            Encrypted end to end: values are locked on your device, and the server only keeps data nobody can read.
            Every opening is logged.
          </p>
        </div>
        {unlocked && vault ? (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              size="sm"
              stretch="auto"
              label="New secret"
              onClick={() => setIsCreating(!isCreating)}
            />
            <Button
              variant="secondary"
              size="sm"
              stretch="auto"
              label="Passphrase"
              onClick={() => setIsChanging(!isChanging)}
            />
            <Button
              variant="secondary"
              size="sm"
              stretch="auto"
              label="Lock"
              onClick={() => lockVault(workspaceSlug)}
            />
          </div>
        ) : null}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">{body}</div>
    </div>
  );
});
