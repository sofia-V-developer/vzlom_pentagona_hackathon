from dataclasses import replace

from app.schemas import SiteConfig
from app.simulation.link_budget import channel_supported, side_loss
from app.simulation.scenarios import Conditions
from app.simulation.spectrum import Source, evaluate, gain_limit_for_blocker

STATE_LABELS = {
    "OFF": "Выключен", "NORMAL": "Штатная работа", "LIMITED": "Усиление ограничено",
    "TRIPPED": "Защитное отключение", "UNKNOWN": "Недостаточно данных",
}


def direction_limits(config: SiteConfig, direction: str, input_power: float | None):
    spec = getattr(config.repeater, direction)
    bounds = {"Запрос": spec.requested_gain_db, "Предел оборудования": spec.max_gain_db,
              "Изоляция": spec.isolation_db - config.repeater.required_margin_db}
    if input_power is not None:
        bounds["Полная выходная мощность"] = spec.max_output_dbm - input_power
    cause = min(bounds, key=bounds.get)
    return {
        "requested_gain_db": spec.requested_gain_db, "candidate_gain_db": bounds[cause],
        "applied_gain_db": None, "isolation_db": spec.isolation_db,
        "stability_margin_db": None, "max_output_dbm": spec.max_output_dbm,
        "input_power_dbm": input_power, "output_power_dbm": None, "limiter": cause,
    }


def decide(conditions: Conditions, latch: str | None):
    config, sources = conditions.config, conditions.sources
    total = config.radio.donor_rssi_dbm
    loss = side_loss(config, "donor", config.profile.dl_mhz)
    input_power = None if total is None or loss is None else total - config.layout.donor.cable_loss_db - loss
    dl = direction_limits(config, "dl", input_power)
    ul = direction_limits(config, "ul", None)
    # The UL input varies with phone position. Its limiter is evaluated per path.
    reason = "Пределы соблюдены"
    state, active = "NORMAL", False
    trial = None
    if latch:
        state, reason = "TRIPPED", latch
    elif not config.repeater.enabled:
        state, reason = "OFF", "Репитер выключен пользователем или сценарием"
    elif not config.layout.donor.enabled:
        state, reason = "OFF", "Донорная антенна отключена"
    elif config.radio.donor_rsrp_dbm is None:
        state, reason = "UNKNOWN", "Нет полезного сигнала на выходе донорной антенны"
    elif not channel_supported(config) or input_power is None:
        state, reason = "UNKNOWN", "Полоса канала или полная входная мощность не подтверждены"
    elif min(dl["candidate_gain_db"], ul["candidate_gain_db"]) < 0:
        limiter = dl["limiter"] if dl["candidate_gain_db"] < 0 else ul["limiter"]
        reason = f"{limiter}: безопасного усиления нет"
        latch, state = reason, "TRIPPED"
    else:
        dl_output = input_power + dl["candidate_gain_db"]
        dl_loss = side_loss(config, "service", config.profile.dl_mhz)
        dl_blocker = Source("Рабочий сигнал DL", "carrier", "after_service_filter", config.profile.dl_mhz,
                            dl_output - dl_loss, config.profile.bandwidth_mhz * 1000, True,
                            "Полная мощность канала после выходного фильтра; связь с GSM-входом задана отдельно")
        sources = (*sources, dl_blocker)
        trial = evaluate(config, sources, True)
        # A known DL blocker is the only source with a gain-dependent power in this model.
        # Combine all other out-of-band sources before deriving its allowable power.
        if trial["blocker_exceeded"] and not any(ch["exceeded"] for ch in trial["channels"]):
            limit = gain_limit_for_blocker(trial, dl["candidate_gain_db"])
            if limit is not None and limit >= 0 and limit < dl["candidate_gain_db"]:
                dl["candidate_gain_db"], dl["limiter"] = limit, "Внеполосный порог GSM"
                adjusted = replace(dl_blocker, power_dbm=input_power + limit - dl_loss)
                sources = (*sources[:-1], adjusted)
                trial = evaluate(config, sources, True)
        if trial["status"] == "FAIL":
            reason = "Превышен модельный порог GSM при включённом репитере"
            latch, state = reason, "TRIPPED"
        else:
            active = True
            limited = [f"{name} — {item['limiter']}" for name, item in (("DL", dl), ("UL", ul))
                       if item["candidate_gain_db"] < item["requested_gain_db"]]
            if trial["status"] == "UNKNOWN":
                state, reason = "UNKNOWN", "Недостаточно данных для оценки GSM"
                if limited:
                    reason += ". " + ", ".join(limited)
            elif limited:
                state, reason = "LIMITED", ", ".join(limited)
    if active:
        for item in (dl, ul):
            item["applied_gain_db"] = item["candidate_gain_db"]
            item["stability_margin_db"] = item["isolation_db"] - item["applied_gain_db"]
        dl["output_power_dbm"] = input_power + dl["applied_gain_db"]
    gsm = trial if active else evaluate(config, sources, False)
    return {
        "state": state, "label": STATE_LABELS[state], "reason": reason, "active": active, "latched": latch is not None,
        "mode": config.repeater.mode, "required_margin_db": config.repeater.required_margin_db,
        "dl": dl, "ul": ul, "gsm": gsm,
    }, latch, trial if trial is not None and trial["status"] == "FAIL" else None
