# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from datetime import time
from types import SimpleNamespace

import pytest

from plane.team_ops.services.day_reports import counted_minutes


def _e(i, start, end, minutes):
    return SimpleNamespace(
        id=i, start_time=time(*start) if start else None, end_time=time(*end) if end else None, minutes=minutes
    )


@pytest.mark.unit
def test_overlapping_tasks_count_once():
    entries = [_e(1, (12, 0), (15, 0), 180), _e(2, (12, 0), (15, 0), 180)]
    assert sum(counted_minutes(entries).values()) == 180


@pytest.mark.unit
def test_partial_overlap_and_spread_rows():
    entries = [_e(1, (9, 0), (11, 0), 120), _e(2, (10, 0), (12, 0), 120), _e(3, None, None, 45)]
    assert sum(counted_minutes(entries).values()) == 180 + 45
