from dataclasses import dataclass
from typing import Literal

from app.schemas import SiteConfig
from app.simulation.link_budget import side_loss
from app.simulation.propagation import dbm_to_mw, mw_to_dbm


@dataclass(frozen=True)
class Source:
    label: str
    kind: Literal["imd", "pim", "spur", "external", "carrier"]
    node: Literal["before_service_filter", "after_service_filter", "external"]
    frequency_mhz: float
    power_dbm: float | None
    bandwidth_khz: float
    depends_on_repeater: bool
    origin: str


def products(f1: float, f2: float) -> list[float]:
    return [f for f in (2 * f1 - f2, 2 * f2 - f1) if f > 0]


def active_imd(f1: float, f2: float, output_per_tone_dbm: float, oip3_dbm: float) -> list[Source]:
    """Small-signal equal-tone output IP3 approximation at the active output."""
    origin = (f"Учебные тоны {f1:g} и {f2:g} МГц на общем активном выходе: "
              f"по {output_per_tone_dbm:g} dBm, OIP3 {oip3_dbm:g} dBm")
    return [Source("Активная IMD3", "imd", "before_service_filter", f,
                   3 * output_per_tone_dbm - 2 * oip3_dbm, 0, True, origin) for f in products(f1, f2)]


def occupies(center, bandwidth_khz, low, high):
    half = bandwidth_khz / 2000
    return center + half >= low and center - half <= high


def evaluate(config: SiteConfig, sources: tuple[Source, ...], active: bool):
    criteria = config.gsm_criteria
    missing = []
    for value, name in ((criteria.protected_bands, "защищаемые окна"),
                        (criteria.channels, "контрольные каналы"),
                        (criteria.interference_limit_dbm, "порог внутри канала"),
                        (criteria.blocker_limit_dbm, "внеполосный порог"),
                        (criteria.coupling_loss_db, "потери связи до GSM-входа")):
        if value is None or value == []:
            missing.append(name)

    components = []
    for source in sources:
        enabled = active or not source.depends_on_repeater
        coupling = 0 if source.node == "external" else criteria.coupling_loss_db
        attenuation = (side_loss(config, "service", source.frequency_mhz)
                       if source.node == "before_service_filter" else 0)
        received = None
        if enabled:
            if coupling is None or attenuation is None or source.power_dbm is None:
                missing.append(f"путь или мощность компонента «{source.label}»")
            else:
                received = source.power_dbm - attenuation - coupling
        protected = any(occupies(source.frequency_mhz, source.bandwidth_khz, b.low_mhz, b.high_mhz)
                        for b in criteria.protected_bands)
        components.append({
            **vars(source), "enabled": enabled, "protected_band_hit": protected,
            "filter_loss_db": attenuation, "coupling_loss_db": coupling, "receiver_dbm": received,
        })

    # Only narrow tones have a channel power model. Wide overlapping sources require a PSD.
    channels = []
    for ch in criteria.channels:
        powers = []
        unknown = False
        for c in components:
            half = ch.bandwidth_khz / 2000
            if not c["enabled"] or not occupies(c["frequency_mhz"], c["bandwidth_khz"],
                                               ch.center_mhz - half, ch.center_mhz + half):
                continue
            if c["bandwidth_khz"] or c["receiver_dbm"] is None:
                unknown = True
            else:
                powers.append(dbm_to_mw(c["receiver_dbm"]))
        if unknown:
            missing.append(f"мощность в канале {ch.center_mhz:g} МГц")
        lower_bound = mw_to_dbm(sum(powers))
        limit = criteria.interference_limit_dbm
        fail = lower_bound is not None and limit is not None and lower_bound > limit
        channels.append({"center_mhz": ch.center_mhz, "bandwidth_khz": ch.bandwidth_khz,
                         "power_dbm": None if unknown else lower_bound, "limit_dbm": limit, "exceeded": fail})

    out_of_band = [c for c in components if c["enabled"] and not c["protected_band_hit"]]
    blocker = mw_to_dbm(sum(dbm_to_mw(c["receiver_dbm"]) for c in out_of_band if c["receiver_dbm"] is not None))
    blocker_fail = (blocker is not None and criteria.blocker_limit_dbm is not None
                    and blocker > criteria.blocker_limit_dbm)
    blocker_unknown = any(c["receiver_dbm"] is None for c in out_of_band)
    failed = blocker_fail or any(c["exceeded"] for c in channels)
    status = "FAIL" if failed else "UNKNOWN" if missing else "PASS"
    return {
        "status": status, "missing": list(dict.fromkeys(missing)),
        "components": components, "channels": channels,
        "blocker_dbm": None if blocker_unknown else blocker, "blocker_limit_dbm": criteria.blocker_limit_dbm,
        "blocker_exceeded": blocker_fail, "protected_bands": [b.model_dump() for b in criteria.protected_bands],
    }


def gain_limit_for_blocker(result, current_gain):
    """Available blocker power after subtracting other known sources in mW."""
    components = [c for c in result["components"] if c["enabled"] and not c["protected_band_hit"]]
    carriers = [c for c in components if c["kind"] == "carrier"]
    if len(carriers) != 1 or any(c["receiver_dbm"] is None for c in components):
        return None
    other = sum(dbm_to_mw(c["receiver_dbm"]) for c in components if c["kind"] != "carrier")
    allowed = mw_to_dbm(dbm_to_mw(result["blocker_limit_dbm"]) - other)
    return None if allowed is None else current_gain + allowed - carriers[0]["receiver_dbm"] - 0.01
