from dataclasses import dataclass

import numpy as np

from app.schemas import SiteConfig
from app.simulation.spectrum import Source, active_imd


SCENARIOS = {
    "baseline": ("Без ретрансляции", "Репитер выключен. Доступно базовое проникновение."),
    "normal": ("Штатная работа", "Параметры выбранной конфигурации."),
    "isolation": ("Недостаточная изоляция", "На 1-й секунде усиление ограничивается, на 3-й срабатывает отключение."),
    "filter": ("Неисправность фильтра", "На 3-й секунде отказывает выходной фильтр. Учебный побочный тон задан с начала."),
    "donor_loss": ("Потеря донорного сигнала", "На 3-й секунде исчезает полезный наружный сигнал."),
    "branch": ("Отключение ветви", "На 3-й секунде отключается последняя внутренняя ветвь."),
    "pim": ("Двухтональная IMD / PIM", "На 3-й секунде появляется PIM после фильтра и независимая помеха."),
}


@dataclass(frozen=True)
class Conditions:
    config: SiteConfig
    sources: tuple[Source, ...]


def conditions(base: SiteConfig, scenario: str, time: int, seed: int) -> Conditions:
    config = base.model_copy(deep=True)
    sources = []
    level_offset = int(np.random.default_rng(seed).integers(-2, 3)) if scenario in {"filter", "pim"} else 0
    if scenario == "baseline":
        config.repeater.enabled = False
    if scenario == "isolation" and time >= 1:
        for direction in (config.repeater.dl, config.repeater.ul):
            target = config.repeater.required_margin_db + 23 if time < 3 else config.repeater.required_margin_db - 3
            direction.isolation_db = min(direction.isolation_db, max(0, target))
    if scenario == "filter":
        source_frequency = config.gsm_criteria.channels[0].center_mhz if config.gsm_criteria.channels else 950
        sources.append(Source("Учебный побочный тон", "spur", "before_service_filter", source_frequency,
                              -32 + level_offset, 0, True, "Синтетическая мощность на выходе репитера"))
        if time >= 3:
            failed_filter = next((f for f in reversed(config.filters) if f.side == "service"), None)
            if failed_filter is not None:
                failed_filter.healthy = False
    if scenario == "donor_loss" and time >= 3:
        config.radio.donor_rsrp_dbm = None
        config.radio.donor_rssi_dbm = None
        config.radio.facade_rsrp_dbm = None
    if scenario == "branch" and time >= 3:
        config.layout.panels[-1].enabled = False
    if scenario == "pim":
        sources.extend(active_imd(1740, 2530, -12 + level_offset, 12))
        if time >= 3:
            sources.extend((
                Source("PIM3 разъёма", "pim", "after_service_filter", 950, -30 + level_offset, 0, True,
                       "Синтетический уровень на разъёме. Тоны 1740 МГц (внешний) и 2530 МГц (новый UL)."),
                Source("Независимая внешняя помеха", "external", "external", 1840, -97 + level_offset, 0, False,
                       "Синтетический уровень непосредственно на входе GSM-модема"),
            ))
    return Conditions(config, tuple(sources))
