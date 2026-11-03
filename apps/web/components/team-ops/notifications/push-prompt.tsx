/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import { Button } from "@makeplane/propel/components/button";
// hooks
import { usePushNotifications } from "@/hooks/team-ops/use-push";

type Props = {
  workspaceSlug: string;
  /**
   * `alert`: the request, shown on every page until notifications are on; "Not now" hides it only until the
   * page is opened again. `settings`: once they are on, the row with the test and the off button.
   */
  mode: "alert" | "settings";
};

const ERROR = <T extends string | null>(message: T) =>
  message ? (
    <p role="alert" className="w-full text-body-xs-regular text-danger-primary">
      {message}
    </p>
  ) : null;

/**
 * Asks the person to get Team Ops notifications on this device, also when the app is closed (a phone, a tablet or
 * any browser on a computer). It says nothing when the server has no push keys.
 */
export const PushPrompt = observer(function PushPrompt({ workspaceSlug, mode }: Props) {
  const push = usePushNotifications(workspaceSlug);
  // "Not now" lasts until the page is opened again, never longer: the request comes back every time
  const [later, setLater] = useState(false);

  if (!push.config?.enabled) return null;

  if (mode === "settings") {
    if (!push.isOn) return null;
    return (
      <section
        aria-label="Push notifications"
        className="flex flex-wrap items-center justify-between gap-3 border-b border-subtle bg-surface-1 px-4 py-2"
      >
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
        {ERROR(push.error)}
      </section>
    );
  }

  if (push.isOn || later) return null;

  const box =
    "flex flex-wrap items-center justify-between gap-3 border-b border-warning-strong bg-warning-subtle px-4 py-2.5";
  const notNow = <Button variant="ghost" size="sm" stretch="auto" label="Not now" onClick={() => setLater(true)} />;

  // iPhone and iPad: web notifications only reach an app that was added to the Home Screen
  if (push.needsInstall) {
    return (
      <section role="alert" aria-label="Turn on notifications" className={box}>
        <span className="text-body-sm-medium text-primary">
          To get notifications on your iPhone, install the app: tap Share, then Add to Home Screen, and open it from the
          Home Screen.
        </span>
        {notNow}
      </section>
    );
  }

  if (!push.supported) return null;

  // The browser will not ask again once it was refused; only the person can allow it in the site settings
  if (push.permission === "denied") {
    return (
      <section role="alert" aria-label="Turn on notifications" className={box}>
        <span className="text-body-sm-medium text-primary">
          Notifications are blocked for this site, so you will miss alerts. Allow them: tap the lock icon next to the
          address (on a phone: Site settings, then Notifications, then Allow) and reload.
        </span>
        {notNow}
      </section>
    );
  }

  return (
    <section role="alert" aria-label="Turn on notifications" className={box}>
      <span className="text-body-sm-medium text-primary">
        Turn on notifications to get alerts on this device, also when the app is closed.
      </span>
      <span className="flex items-center gap-2">
        <Button variant="primary" size="sm" stretch="auto" label="Turn on" loading={push.busy} onClick={push.enable} />
        {push.canInstall ? (
          <Button variant="secondary" size="sm" stretch="auto" label="Install the app" onClick={push.install} />
        ) : null}
        {notNow}
      </span>
      {ERROR(push.error)}
    </section>
  );
});
