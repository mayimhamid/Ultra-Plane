# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Django imports
from django.db import models
from django.db.models import Q

# Module imports
from plane.db.models.base import BaseModel


class Flow(BaseModel):
    """A project split into phases. Each stage holds modules of the project; its progress is the modules' progress."""

    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="team_ops_flows")
    project = models.ForeignKey("db.Project", on_delete=models.CASCADE, related_name="team_ops_flows")
    name = models.CharField(max_length=200)

    class Meta:
        verbose_name = "Flow"
        verbose_name_plural = "Flows"
        db_table = "tops_flow"
        ordering = ("name",)


class FlowStage(BaseModel):
    flow = models.ForeignKey(Flow, on_delete=models.CASCADE, related_name="stages")
    position = models.PositiveIntegerField()
    name = models.CharField(max_length=200)

    class Meta:
        db_table = "tops_flow_stage"
        ordering = ("position",)


class FlowStageModule(BaseModel):
    """A module of the project that belongs to a stage. The stage's progress is that of its modules."""

    stage = models.ForeignKey(FlowStage, on_delete=models.CASCADE, related_name="modules")
    module = models.ForeignKey("db.Module", on_delete=models.CASCADE, related_name="+")

    class Meta:
        db_table = "tops_flow_stage_module"
        constraints = [
            models.UniqueConstraint(
                fields=["stage", "module"], condition=Q(deleted_at__isnull=True), name="tops_flow_stage_module_once"
            )
        ]
