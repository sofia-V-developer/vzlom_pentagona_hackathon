from math import log10

from app.schemas import Filter, Position, SiteConfig
from app.simulation.propagation import panel_gain, path_terms


def filter_loss(component: Filter, frequency: float) -> float | None:
    if not component.healthy:
        return component.failed_loss_db
    if any(b.contains(frequency) for b in component.passbands):
        return component.insertion_loss_db
    if any(b.contains(frequency) for b in component.stopbands):
        return component.stop_loss_db
    return None


def side_loss(config: SiteConfig, side: str, frequency: float) -> float | None:
    losses = [filter_loss(f, frequency) for f in config.filters if f.side == side]
    return None if None in losses else sum(losses)


def channel_supported(config: SiteConfig) -> bool:
    for center in (config.profile.dl_mhz, config.profile.ul_mhz):
        half = config.profile.bandwidth_mhz / 2
        for component in config.filters:
            if component.healthy and not any(b.contains(center - half) and b.contains(center + half)
                                             for b in component.passbands):
                return False
    return True


def step(label, value, unit, total=None):
    return {"label": label, "value": value, "unit": unit, "total_dbm": total}


def level_rows(start_label: str, start: float, changes: list[tuple]):
    rows = [step(start_label, start, "dBm", start)]
    total = start
    for label, change, unit in changes:
        total += change
        rows.append(step(label, change, unit, total))
    return rows


def baseline(config: SiteConfig, point: Position, explain=False):
    radio, layout = config.radio, config.layout
    # The facade reference is on the donor side of the room, independent of donor antenna gain.
    ingress = Position(x=min(layout.width_m, max(0, layout.donor.x)), y=0, z=layout.receiver_height_m)
    terms = []
    for direction, frequency in (("dl", config.profile.dl_mhz), ("ul", config.profile.ul_mhz)):
        distance, full_path_loss, obstacles = path_terms(ingress, point, frequency, radio.path_exponent, layout.obstacles)
        distance_loss = 10 * radio.path_exponent * log10(max(distance, 1)) if direction == "dl" else full_path_loss
        terms.append([("Проникновение через оболочку", -radio.envelope_loss_db, "dB"),
                      ("Потери внутри помещения", -distance_loss, "dB"), ("Препятствия", -obstacles, "dB")])
    if radio.facade_rsrp_dbm is None:
        return None, None, [], []
    dl_start, ul_start = radio.facade_rsrp_dbm, radio.phone_power_dbm
    ul_terms = [*terms[1], ("Наружный участок до БС", -radio.outdoor_path_loss_db, "dB")]
    dl = dl_start + sum(c[1] for c in terms[0])
    ul = ul_start + sum(c[1] for c in ul_terms) - radio.base_receiver_threshold_dbm
    dl_rows = level_rows("RSRP у наружной грани", dl_start, terms[0]) if explain else []
    ul_rows = level_rows("Выход телефона", ul_start, ul_terms) if explain else []
    return dl, ul, dl_rows, ul_rows


def relay(config: SiteConfig, point: Position, dl_gain: float, ul_gain: float, explain=False):
    radio, layout, profile = config.radio, config.layout, config.profile
    input_loss = layout.donor.cable_loss_db + side_loss(config, "donor", profile.dl_mhz)
    dl_filter = side_loss(config, "service", profile.dl_mhz)
    ul_filter = side_loss(config, "service", profile.ul_mhz)
    ul_donor_filter = side_loss(config, "donor", profile.ul_mhz)
    dl_best = ul_best = None
    for panel in layout.panels:
        if not panel.enabled:
            continue
        gain = panel_gain(panel, point)
        _, dl_path, dl_objects = path_terms(panel, point, profile.dl_mhz, radio.path_exponent, layout.obstacles)
        _, ul_path, ul_objects = path_terms(panel, point, profile.ul_mhz, radio.path_exponent, layout.obstacles)
        dl_terms = [("Донорный кабель и фильтр → вход репитера", -input_loss, "dB"),
                    ("Репитер DL → выход репитера", dl_gain, "dB"),
                    ("Выходной фильтр", -dl_filter, "dB"), ("Делитель", -radio.splitter_loss_db, "dB"),
                    ("Кабель → вход панели", -panel.cable_loss_db, "dB"), ("Усиление панели", gain, "dBi"),
                    ("Потери внутри помещения", -dl_path, "dB"), ("Препятствия → приёмник телефона", -dl_objects, "dB")]
        ul_input_terms = [("Потери внутри помещения", -ul_path, "dB"), ("Препятствия", -ul_objects, "dB"),
                          ("Усиление панели", gain, "dBi"), ("Кабель панели", -panel.cable_loss_db, "dB"),
                          ("Делитель", -radio.splitter_loss_db, "dB"), ("Фильтр → вход репитера", -ul_filter, "dB")]
        ul_input = radio.phone_power_dbm + sum(t[1] for t in ul_input_terms)
        effective_ul_gain = min(ul_gain, config.repeater.ul.max_output_dbm - ul_input)
        ul_terms = [*ul_input_terms, ("Фактическое усиление UL в точке → выход репитера", effective_ul_gain, "dB"),
                    ("Донорный фильтр", -ul_donor_filter, "dB"), ("Донорный кабель", -layout.donor.cable_loss_db, "dB"),
                    ("Усиление донорной антенны", layout.donor.gain_dbi, "dBi"),
                    ("Наружный участок → приёмник БС", -radio.outdoor_path_loss_db, "dB")]
        dl = radio.donor_rsrp_dbm + sum(t[1] for t in dl_terms)
        ul = radio.phone_power_dbm + sum(t[1] for t in ul_terms) - radio.base_receiver_threshold_dbm
        if dl_best is None or dl > dl_best[0]:
            dl_best = (dl, panel.id, level_rows("RSRP на выходе донорной антенны", radio.donor_rsrp_dbm, dl_terms) if explain else [])
        if ul_best is None or ul > ul_best[0]:
            ul_best = (ul, panel.id, level_rows("Выход телефона", radio.phone_power_dbm, ul_terms) if explain else [])
    return dl_best, ul_best
