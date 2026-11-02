/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { Button } from "@makeplane/propel/components/button";
// hooks
import { usePushNotifications } from "@/hooks/team-ops/use-push";

const DISMISSED = "TEAM_OPS_PUSH_PROMPT_DISMISSED";

const readDismissed = () => {
  try {
    return window.localStorage.getItem(DISMISSED) === "1";
  } catch {
    return false;
  }
};

/**
 * Asks the person to get Team Ops notifications on this device, also when the app is closed (a phone or a
 * browser), and then shows that they are on, with a test button. It says nothing when the server has no push
 * keys, and "Not now" hides the offer for good.
 */
export const PushPrompt = observer(function PushPrompt({ workspaceSlug }: { workspaceSlug: string }) {
  const push = usePushNotifications(workspaceSlug);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => setDismissed(readDismissed()), []);

  if (!push.config?.enabled) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISSED, "1");
    } catch {
      // the offer comes back next time; nothing to do
    }
  };

  const box = "flex flex-wrap items-center justify-between gap-3 border-b border-subtle bg-surface-1 px-4 py-2";

  if (push.isOn) {
    return (
      <section aria-label="Push notifications" className={box}>
        <span className="text-body-sm-regular text-secondary">
          Notifications are on for this device
          {push.config.devices.length > 1 ? ` (${push.config.devices.length} devices)` : ""}.
        </span>
        <span className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            stretch="auto"
            label="Send a test"
            loading={push.busy}
            onClick={push.test}
          />
          <Button
            variant="ghost"
            size="sm"
            stretch="auto"
            label="Turn off"
            disabled={push.busy}
            onClick={push.disable}
          />
        </span>
        {push.error ? (
          <p role="alert" className="w-full text-body-xs-regular text-danger-primary">
            {push.error}
          </p>
        ) : null}
      </section>
    );
  }

  if (dismissed) return null;

  if (push.needsInstall) {
    return (
      <section aria-label="Push notifications" className={box}>
        <span className="text-body-sm-regular text-secondary">
          To get notifications on an iPhone, add this app to the Home Screen (Share, then Add to Home Screen) and open
          it from there.
        </span>
        <Button variant="ghost" size="sm" stretch="auto" label="Not now" onClick={dismiss} />
      </section>
    );
  }

  if (!push.supported) return null;

  if (push.permission === "denied") {
    return (
      <section aria-label="Push notifications" className={box}>
        <span className="text-body-sm-regular text-secondary">
          Notifications are blocked for this site. Allow them in the browser&apos;s site settings to get them here.
        </span>
        <Button variant="ghost" size="sm" stretch="auto" label="Not now" onClick={dismiss} />
      </section>
    );
  }

  return (
    <section aria-label="Push notifications" className={box}>
      <span className="text-body-sm-regular text-secondary">
        Get Team Ops notifications on this device, also when the app is closed.
      </span>
      <span className="flex items-center gap-2">
        <Button variant="primary" size="sm" stretch="auto" label="Turn on" loading={push.busy} onClick={push.enable} />
        <Button variant="ghost" size="sm" stretch="auto" label="Not now" onClick={dismiss} />
      </span>
      {push.error ? (
        <p role="alert" className="w-full text-body-xs-regular text-danger-primary">
          {push.error}
        </p>
      ) : null}
    </section>
  );
});
