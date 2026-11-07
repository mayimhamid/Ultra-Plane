/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { API_BASE_URL } from "@plane/constants";
import type {
  TFlow,
  TFlowOffer,
  TFlowPayload,
  THubChannel,
  THubDoc,
  THubDocPayload,
  THubPerson,
  THubSecret,
  THubSecretLog,
  THubPendingKey,
  THubSealed,
  THubSecretPayload,
  THubSecretReveal,
  THubVault,
  TProjectModule,
  TLibraryFile,
} from "@plane/types";
// services
import { APIService } from "../api.service";

const MULTIPART = { headers: { "Content-Type": "multipart/form-data" } };

const fail = (error: { response?: { data?: unknown } }) => {
  throw error?.response?.data;
};

/** The Hub beyond chat: people, private messages, documents, shared files and secrets. */
export class HubExtraService extends APIService {
  constructor(BASE_URL?: string) {
    super(BASE_URL || API_BASE_URL);
  }

  private base(workspaceSlug: string) {
    return `/api/workspaces/${workspaceSlug}/team-ops/hub`;
  }

  async listPeople(workspaceSlug: string): Promise<THubPerson[]> {
    return this.get(`${this.base(workspaceSlug)}/people/`)
      .then((response) => response?.data?.results)
      .catch(fail);
  }

  /** Opens (or creates) the private conversation with a colleague. */
  async openDirect(workspaceSlug: string, user: string): Promise<THubChannel> {
    return this.post(`${this.base(workspaceSlug)}/direct/`, { user })
      .then((response) => response?.data)
      .catch(fail);
  }

  async listDocs(
    workspaceSlug: string,
    params: { q?: string; tag?: string; project?: string }
  ): Promise<{ results: THubDoc[]; tags: string[] }> {
    return this.get(`${this.base(workspaceSlug)}/docs/`, { params })
      .then((response) => response?.data)
      .catch(fail);
  }

  async getDoc(workspaceSlug: string, id: string): Promise<THubDoc> {
    return this.get(`${this.base(workspaceSlug)}/docs/${id}/`)
      .then((response) => response?.data)
      .catch(fail);
  }

  async saveDoc(workspaceSlug: string, payload: THubDocPayload, id?: string): Promise<THubDoc> {
    const request = id
      ? this.patch(`${this.base(workspaceSlug)}/docs/${id}/`, payload)
      : this.post(`${this.base(workspaceSlug)}/docs/`, payload);
    return request.then((response) => response?.data).catch(fail);
  }

  async deleteDoc(workspaceSlug: string, id: string): Promise<void> {
    return this.delete(`${this.base(workspaceSlug)}/docs/${id}/`)
      .then(() => undefined)
      .catch(fail);
  }

  async listFiles(workspaceSlug: string): Promise<TLibraryFile[]> {
    return this.get(`${this.base(workspaceSlug)}/library/`)
      .then((response) => response?.data?.results)
      .catch(fail);
  }

  /** Puts files on a document (`docId`), or shares them with everyone in the workspace. */
  async uploadFiles(workspaceSlug: string, files: File[], docId?: string): Promise<TLibraryFile[]> {
    const form = new FormData();
    files.forEach((file) => form.append("files", file));
    if (docId) form.append("doc", docId);
    return this.post(`${this.base(workspaceSlug)}/library/`, form, MULTIPART)
      .then((response) => response?.data?.results)
      .catch(fail);
  }

  async deleteFile(workspaceSlug: string, id: string): Promise<void> {
    return this.delete(`${this.base(workspaceSlug)}/library/${id}/`)
      .then(() => undefined)
      .catch(fail);
  }

  async listSecrets(workspaceSlug: string): Promise<THubSecret[]> {
    return this.get(`${this.base(workspaceSlug)}/secrets/`)
      .then((response) => response?.data?.results)
      .catch(fail);
  }

  async createSecret(workspaceSlug: string, payload: THubSecretPayload): Promise<THubSecret> {
    return this.post(`${this.base(workspaceSlug)}/secrets/`, payload)
      .then((response) => response?.data)
      .catch(fail);
  }

  /** Name or info; with `sealed`, a new value (sealed again in the browser, with new keys for the readers). */
  async updateSecret(
    workspaceSlug: string,
    id: string,
    payload: Partial<Pick<THubSecretPayload, "name" | "description" | "kind">> & Partial<THubSealed>
  ): Promise<THubSecret> {
    return this.patch(`${this.base(workspaceSlug)}/secrets/${id}/`, payload)
      .then((response) => response?.data)
      .catch(fail);
  }

  async deleteSecret(workspaceSlug: string, id: string): Promise<void> {
    return this.delete(`${this.base(workspaceSlug)}/secrets/${id}/`)
      .then(() => undefined)
      .catch(fail);
  }

  /** The sealed value and the caller's wrapped key (an old secret: its value). Every call is logged. */
  async revealSecret(workspaceSlug: string, id: string): Promise<THubSecretReveal> {
    return this.post(`${this.base(workspaceSlug)}/secrets/${id}/reveal/`, {})
      .then((response) => response?.data)
      .catch(fail);
  }

  /** An old server-key secret, sealed again in the publisher's browser. */
  async convertSecret(
    workspaceSlug: string,
    id: string,
    payload: THubSealed & { kind: THubSecretPayload["kind"] }
  ): Promise<THubSecret> {
    return this.post(`${this.base(workspaceSlug)}/secrets/${id}/convert/`, payload)
      .then((response) => response?.data)
      .catch(fail);
  }

  /** Replaces the list of people who may read the secret (publisher only), with keys for new readers. */
  async setSecretAccess(
    workspaceSlug: string,
    id: string,
    users: string[],
    keys: Record<string, string> = {}
  ): Promise<THubSecret> {
    return this.put(`${this.base(workspaceSlug)}/secrets/${id}/access/`, { users, keys })
      .then((response) => response?.data)
      .catch(fail);
  }

  async getVault(workspaceSlug: string): Promise<THubVault | null> {
    return this.get(`${this.base(workspaceSlug)}/vault/`)
      .then((response) => response?.data?.vault ?? null)
      .catch(fail);
  }

  async createVault(workspaceSlug: string, vault: THubVault): Promise<THubVault> {
    return this.post(`${this.base(workspaceSlug)}/vault/`, vault)
      .then((response) => response?.data?.vault)
      .catch(fail);
  }

  /** The same keys, locked with a new passphrase. */
  async changeVaultPassphrase(workspaceSlug: string, vault: THubVault): Promise<THubVault> {
    return this.put(`${this.base(workspaceSlug)}/vault/`, vault)
      .then((response) => response?.data?.vault)
      .catch(fail);
  }

  /** Forgotten passphrase: the caller's own secrets are deleted, shared ones wait to be shared again. */
  async resetVault(workspaceSlug: string): Promise<{ deleted: number; waiting: number }> {
    return this.delete(`${this.base(workspaceSlug)}/vault/`)
      .then((response) => response?.data)
      .catch(fail);
  }

  /** Public keys of the given colleagues who have a vault, by user id. */
  async getPublicKeys(workspaceSlug: string, users: string[]): Promise<Record<string, string>> {
    if (users.length === 0) return {};
    return this.get(`${this.base(workspaceSlug)}/vault/keys/`, { params: { users: users.join(",") } })
      .then((response) => response?.data?.keys ?? {})
      .catch(fail);
  }

  async getPendingKeys(workspaceSlug: string): Promise<THubPendingKey[]> {
    return this.get(`${this.base(workspaceSlug)}/vault/pending/`)
      .then((response) => response?.data?.results ?? [])
      .catch(fail);
  }

  async fillPendingKeys(
    workspaceSlug: string,
    items: { secret: string; user: string; wrapped_key: string }[]
  ): Promise<number> {
    return this.post(`${this.base(workspaceSlug)}/vault/pending/`, { items })
      .then((response) => response?.data?.done ?? 0)
      .catch(fail);
  }

  async getSecretLog(workspaceSlug: string, id: string): Promise<THubSecretLog[]> {
    return this.get(`${this.base(workspaceSlug)}/secrets/${id}/access/`)
      .then((response) => response?.data?.results)
      .catch(fail);
  }
}

/** Flows: the stages of people on a project, drawn by an admin. */
export class FlowService extends APIService {
  constructor(BASE_URL?: string) {
    super(BASE_URL || API_BASE_URL);
  }

  private base(workspaceSlug: string) {
    return `/api/workspaces/${workspaceSlug}/team-ops/teamflow/flows`;
  }

  async list(workspaceSlug: string): Promise<{ results: TFlow[]; can_manage: boolean }> {
    return this.get(`${this.base(workspaceSlug)}/`)
      .then((response) => response?.data)
      .catch(fail);
  }

  async create(workspaceSlug: string, payload: TFlowPayload): Promise<TFlow> {
    return this.post(`${this.base(workspaceSlug)}/`, payload)
      .then((response) => response?.data)
      .catch(fail);
  }

  async update(workspaceSlug: string, id: string, payload: TFlowPayload): Promise<TFlow> {
    return this.put(`${this.base(workspaceSlug)}/${id}/`, payload)
      .then((response) => response?.data)
      .catch(fail);
  }

  async remove(workspaceSlug: string, id: string): Promise<void> {
    return this.delete(`${this.base(workspaceSlug)}/${id}/`)
      .then(() => undefined)
      .catch(fail);
  }

  /** What the caller can pick up (pull) or join (merge) when nothing of theirs is left. */
  async getOffer(workspaceSlug: string, flowId: string): Promise<TFlowOffer> {
    return this.get(`${this.base(workspaceSlug)}/${flowId}/pull/`)
      .then((response) => response?.data)
      .catch(fail);
  }

  async pull(workspaceSlug: string, flowId: string, issue: string): Promise<{ kind: "pull" | "merge" }> {
    return this.post(`${this.base(workspaceSlug)}/${flowId}/pull/`, { issue })
      .then((response) => response?.data)
      .catch(fail);
  }

  /** The modules of a project, with the people on them, to put into stages. */
  async listProjectModules(workspaceSlug: string, project: string): Promise<TProjectModule[]> {
    return this.get(`${this.base(workspaceSlug)}/modules/`, { params: { project } })
      .then((response) => response?.data?.results)
      .catch(fail);
  }
}
