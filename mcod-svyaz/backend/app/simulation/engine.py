from datetime import datetime, timezone

import numpy as np

from app.schemas import Position, SiteConfig
from app.simulation.link_budget import baseline, relay
from app.simulation.propagation import grid, is_working
from app.simulation.protection import decide
from app.simulation.scenarios import conditions

MODEL_VERSION = "1.1.0"


def point_budget(config: SiteConfig, protection, point: Position, explain=True):
    dl, ul, dl_rows, ul_rows = baseline(config, point, explain)
    result = {
        "point": point.model_dump(), "working": is_working(config.layout, point.x, point.y),
        "before_dl_dbm": dl, "before_ul_margin_db": ul,
        "relay_dl_dbm": None, "relay_ul_margin_db": None,
        "after_dl_dbm": dl, "after_ul_margin_db": ul, "dl_branch": None, "ul_branch": None,
        "before_dl_rows": dl_rows, "before_ul_rows": ul_rows, "after_dl_rows": dl_rows, "after_ul_rows": ul_rows,
        "base_receiver_threshold_dbm": config.radio.base_receiver_threshold_dbm,
    }
    if protection["active"]:
        relayed_dl, relayed_ul = relay(config, point, protection["dl"]["applied_gain_db"],
                                      protection["ul"]["applied_gain_db"], explain)
        for candidate, base, field, branch, rows in (
            (relayed_dl, dl, "dl_dbm", "dl_branch", "dl_rows"),
            (relayed_ul, ul, "ul_margin_db", "ul_branch", "ul_rows"),
        ):
            if candidate is not None:
                result[f"relay_{field}"] = candidate[0]
                if base is None or candidate[0] >= base:
                    result[f"after_{field}"], result[branch], result[f"after_{rows}"] = candidate
    result["signal_note"] = ("Полезный сигнал отсутствует в заданных условиях"
                             if result["after_dl_dbm"] is None else None)
    return result


def metrics(cells, key, threshold):
    down, up = f"{key}_dl_dbm", f"{key}_ul_margin_db"
    work = [c for c in cells if c["working"]]
    rsrp = [c[down] for c in work if c[down] is not None]
    margins = [c[up] for c in work if c[up] is not None]
    ok = [c for c in work if c[down] is not None and c[down] >= threshold]
    both = [c for c in ok if c[up] is not None and c[up] >= 0]
    return {
        "working_cells": len(work), "coverage_pct": 100 * len(ok) / len(work) if work else None,
        "both_pct": 100 * len(both) / len(work) if work else None,
        "min_rsrp_dbm": min(rsrp) if rsrp else None, "median_rsrp_dbm": float(np.median(rsrp)) if rsrp else None,
        "worst_ul_margin_db": min(margins) if margins else None,
    }


class SimulatorAdapter:
    def capture(self, *, site_id, base, revision, scenario, seed, time, running, latch, trigger):
        effective = conditions(base, scenario, time, seed)
        config = effective.config
        protection, latch, failed_trial = decide(effective, latch)
        trigger = failed_trial or (trigger if latch else None)
        cells = []
        cell_keys = ("working", "before_dl_dbm", "before_ul_margin_db", "after_dl_dbm", "after_ul_margin_db")
        for point, dx, dy in grid(config.layout):
            budget = point_budget(config, protection, point, explain=False)
            cells.append({"x": point.x, "y": point.y, **{key: budget[key] for key in cell_keys}})
        threshold = config.radio.coverage_threshold_dbm
        room_metrics = []
        for room in config.layout.rooms:
            samples = [c for c in cells if room.x <= c["x"] < room.x + room.width
                       and room.y <= c["y"] < room.y + room.depth]
            room_metrics.append({"id": room.id, "before": metrics(samples, "before", threshold),
                                 "after": metrics(samples, "after", threshold)})
        snapshot = {
            "site_id": site_id, "timestamp": datetime.now(timezone.utc).isoformat(), "simulation_time": time,
            "config_revision": revision, "model_version": MODEL_VERSION, "data_source": "simulated",
            "scenario": scenario, "seed": seed, "running": running,
            "config": config.model_dump(), "protection": protection, "trip_gsm": trigger,
            "coverage": {"cell_width_m": dx, "cell_depth_m": dy, "cells": cells,
                         "before": metrics(cells, "before", threshold), "after": metrics(cells, "after", threshold),
                         "rooms": room_metrics},
            "branches": [{"id": p.id, "label": p.label, "enabled": p.enabled,
                          "active": p.enabled and protection["active"]} for p in config.layout.panels],
        }
        return snapshot, latch, trigger

    def budget(self, snapshot, point: Position):
        return point_budget(SiteConfig.model_validate(snapshot["config"]), snapshot["protection"], point)
