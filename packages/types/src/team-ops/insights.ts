/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

export type TRiskLevel = "HIGH" | "MEDIUM" | "LOW" | "NONE";
export type TLoadStatus = "OVERLOADED" | "BALANCED" | "LIGHT" | "UNKNOWN";

export type TRiskFactor = { code: string; points: number; detail: string };

export type TTaskRisk = {
  issue: string;
  name: string;
  key: string;
  project: string;
  priority: string;
  target_date: string | null;
  assignees: string[];
  score: number;
  level: TRiskLevel;
  factors: TRiskFactor[];
};

export type TWorkloadPerson = {
  user: string;
  open_tasks: number;
  overdue_tasks: number;
  unestimated_tasks: number;
  remaining_seconds: number;
  capacity_seconds: number;
  load: number | null;
  status: TLoadStatus;
};

export type TInsights = {
  from: string;
  to: string;
  today: string;
  risks: { summary: Record<TRiskLevel, number>; open_tasks: number; tasks: TTaskRisk[] };
  workload: { people: TWorkloadPerson[]; unassigned_tasks: number };
  factor_labels: Record<string, string>;
  notice: string;
};

export type TInsightsParams = { from: string; to: string; team?: string; project?: string; user?: string };
