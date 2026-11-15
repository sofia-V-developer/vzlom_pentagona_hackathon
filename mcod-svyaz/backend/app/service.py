import hashlib
import json
from collections import deque
from dataclasses import dataclass, field, replace
from pathlib import Path
from threading import RLock
from typing import Protocol
from uuid import uuid4

from app.schemas import ConfigUpdate, Position, ScenarioCommand, SiteConfig
from app.simulation.engine import SimulatorAdapter
from app.simulation.scenarios import SCENARIOS
from app.storage import Storage


# Canonical geometry of the previous bundled North profile. Match the entire
# layout before upgrading so local geometry edits survive the new preset.
LEGACY_NORTH_LAYOUT = "76cc09573da463800319c9da224286cc7ce706e8e753a947ffe2f1c7a5b19a6e"


def uses_legacy_north_layout(layout):
    if layout.rooms or layout.source:
        return False
    geometry = json.dumps(layout.model_dump(exclude={"rooms", "source"}), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(geometry.encode("utf-8")).hexdigest() == LEGACY_NORTH_LAYOUT


GSM_LINE = {
    "role": "Аварийные SMS оборудования",
    "components": ["Существующая GSM-антенна", "Существующий GSM-модем"],
    "antenna_range_mhz": [790, 2700],
    "case_gsm_bands_mhz": [900, 1800],
    "actual_channels_known": False,
    "editable": False,
}


class Adapter(Protocol):
    def capture(self, *, site_id, base, revision, scenario, seed, time, running, latch, trigger): ...
    def budget(self, snapshot, point: Position): ...


class ServiceError(Exception):
    def __init__(self, status: int, message: str):
        self.status = status
        self.message = message


@dataclass
class Site:
    id: str
    config: SiteConfig
    revision: int = 1
    scenario: str = "normal"
    seed: int = 42
    time: int = 0
    running: bool = False
    latch: str | None = None
    trigger: dict | None = None
    snapshots: deque = field(default_factory=lambda: deque(maxlen=24))
    history: deque = field(default_factory=lambda: deque(maxlen=300))


class SimulationService:
    def __init__(self, storage: Storage, configs: Path, adapter: Adapter | None = None):
        self.storage = storage
        self.adapter = adapter or SimulatorAdapter()
        self.lock = RLock()
        self.defaults = {p.stem: SiteConfig.model_validate_json(p.read_text(encoding="utf-8"))
                         for p in sorted(configs.glob("*.json"), key=lambda p: (p.stem != "north", p.stem))}
        self.sites = {}
        for id, config in self.defaults.items():
            stored = self.storage.read_site(id)
            if stored:
                revision, saved, runtime = stored
                site = Site(id, SiteConfig.model_validate(saved), revision, **runtime)
                action = "Состояние восстановлено"
                if id == "north" and config.layout.rooms and uses_legacy_north_layout(site.config.layout):
                    site.config.layout = config.layout.model_copy(deep=True)
                    site.revision += 1
                    action = "Демонстрационная планировка обновлена по чертежу"
            else:
                site = Site(id, config)
                action = "Загружен демонстрационный профиль"
            self.publish(site, action)

    def get(self, id):
        if id not in self.sites:
            raise ServiceError(404, "МЦОД не найден")
        return self.sites[id]

    def publish(self, site: Site, action: str | None = None):
        previous = site.snapshots[-1] if site.snapshots else None
        snapshot, latch, trigger = self.adapter.capture(
            site_id=site.id, base=site.config, revision=site.revision, scenario=site.scenario, seed=site.seed,
            time=site.time, running=site.running, latch=site.latch, trigger=site.trigger,
        )
        snapshot["snapshot_id"] = uuid4().hex
        snapshot["gsm_line"] = GSM_LINE
        current = snapshot["protection"]
        event_base = {"timestamp": snapshot["timestamp"], "simulation_time": site.time,
                      "config_revision": site.revision, "scenario": site.scenario}
        events = []
        if action:
            events.append({**event_base, "kind": "action", "label": action})
        signature = lambda status: (status["state"], status["reason"], status["gsm"]["status"])
        if previous is None or signature(current) != signature(previous["protection"]):
            events.append({**event_base, "kind": "transition", "state": current["state"],
                           "gsm_status": current["gsm"]["status"], "label": f"{current['label']} · {current['reason']}"})
        if previous:
            before = {b["id"]: b["enabled"] for b in previous["branches"]}
            for branch in snapshot["branches"]:
                if branch["id"] in before and before[branch["id"]] != branch["enabled"]:
                    status = "включена" if branch["enabled"] else "выключена"
                    events.append({**event_base, "kind": "transition", "label": f"{branch['label']} · ветвь {status}"})
        runtime = {"scenario": site.scenario, "seed": site.seed, "time": site.time,
                   "latch": latch, "trigger": trigger}
        self.storage.commit(site.id, site.revision, site.config.model_dump(), runtime, events)
        site.latch, site.trigger = latch, trigger
        site.snapshots.append(snapshot)
        site.history.append({
            **event_base, "snapshot_id": snapshot["snapshot_id"], "state": current["state"],
            "coverage_pct": snapshot["coverage"]["after"]["coverage_pct"],
            "rsrp_dbm": snapshot["coverage"]["after"]["median_rsrp_dbm"],
            "ul_margin_db": snapshot["coverage"]["after"]["worst_ul_margin_db"],
            "gain_dl_db": current["dl"]["applied_gain_db"],
            "donor_rsrp_dbm": snapshot["config"]["radio"]["donor_rsrp_dbm"],
            "donor_rssi_dbm": snapshot["config"]["radio"]["donor_rssi_dbm"],
        })
        self.sites[site.id] = site
        return snapshot

    def tick(self):
        with self.lock:
            for site in list(self.sites.values()):
                if site.running:
                    self.publish(replace(site, time=site.time + 1))

    def list_sites(self):
        with self.lock:
            return [{"id": s.id, "label": s.config.label, "state": s.snapshots[-1]["protection"]["state"]}
                    for s in self.sites.values()]

    def get_config(self, id):
        with self.lock:
            site = self.get(id)
            return {"config_revision": site.revision, "config": site.config.model_dump(), "gsm_line": GSM_LINE}

    def set_config(self, id, update: ConfigUpdate):
        with self.lock:
            site = self.get(id)
            if update.config_revision != site.revision:
                raise ServiceError(409, "Конфигурация изменилась. Откройте настройки заново")
            if update.config.layout.gsm_antenna != site.config.layout.gsm_antenna:
                raise ServiceError(422, "Положение существующей GSM-антенны доступно только для чтения")
            return self.publish(replace(site, config=update.config, revision=site.revision + 1),
                                "Конфигурация сохранена")

    def restore(self, id):
        with self.lock:
            site = self.get(id)
            return self.publish(replace(site, config=self.defaults[id], revision=site.revision + 1,
                                        time=0, seed=42, running=False, scenario="normal"),
                                "Восстановлена демонстрационная конфигурация")

    def snapshot(self, id, snapshot_id=None):
        with self.lock:
            site = self.get(id)
            if snapshot_id is None:
                return site.snapshots[-1]
            for snapshot in reversed(site.snapshots):
                if snapshot["snapshot_id"] == snapshot_id:
                    return snapshot
            raise ServiceError(409, "Снимок устарел. Обновите экран")

    def history(self, id):
        with self.lock:
            return list(self.get(id).history)

    def events(self, id, limit):
        with self.lock:
            self.get(id)
            return self.storage.events(id, limit)

    def scenario(self, id, command: ScenarioCommand):
        with self.lock:
            site = self.get(id)
            return self.publish(replace(site, scenario=command.scenario, time=0, running=False, seed=command.seed),
                                f"Выбран сценарий «{SCENARIOS[command.scenario][0]}»")

    def control(self, id, action):
        with self.lock:
            site = self.get(id)
            match action:
                case "start":
                    return self.publish(replace(site, running=True), "Модельное время запущено")
                case "pause":
                    return self.publish(replace(site, running=False), "Модельное время приостановлено")
                case "step":
                    if site.running:
                        raise ServiceError(409, "Для ручного шага приостановите симуляцию")
                    return self.publish(replace(site, time=site.time + 1), "Выполнен ручной шаг")
                case "reset":
                    return self.publish(replace(site, running=False, time=0, latch=None, trigger=None),
                                        "Сценарий и фиксация защиты сброшены")
                case "clear-trip":
                    return self.publish(replace(site, latch=None, trigger=None),
                                        "Запрошен сброс защитного отключения")
            raise ServiceError(422, "Неизвестная команда симуляции")

    def budget(self, id, snapshot_id, x, y):
        snapshot = self.snapshot(id, snapshot_id)
        layout = snapshot["config"]["layout"]
        if not (0 <= x <= layout["width_m"] and 0 <= y <= layout["depth_m"]):
            raise ServiceError(422, "Контрольная точка должна находиться внутри помещения")
        point = Position(x=x, y=y, z=layout["receiver_height_m"])
        return {"snapshot_id": snapshot["snapshot_id"], **self.adapter.budget(snapshot, point)}
