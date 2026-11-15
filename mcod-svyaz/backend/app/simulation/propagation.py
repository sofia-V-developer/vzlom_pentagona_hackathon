from math import atan2, degrees, dist, log10

import numpy as np

from app.schemas import Antenna, Layout, Obstacle, Position


def dbm_to_mw(dbm: float) -> float:
    return 10 ** (dbm / 10)


def mw_to_dbm(mw: float) -> float | None:
    return 10 * log10(mw) if mw > 0 else None


def fspl(frequency_mhz: float, distance_m: float) -> float:
    return 32.44 + 20 * log10(frequency_mhz) + 20 * log10(max(distance_m, 1) / 1000)


def crosses(start: Position, end: Position, box: Obstacle) -> bool:
    """Clip a 3D segment against the closed obstacle box."""
    low, high = 0.0, 1.0
    for origin, target, left, size in (
        (start.x, end.x, box.x, box.width),
        (start.y, end.y, box.y, box.depth),
        (start.z, end.z, box.z, box.height),
    ):
        delta = target - origin
        if delta == 0:
            if not left <= origin <= left + size:
                return False
            continue
        enter, leave = sorted(((left - origin) / delta, (left + size - origin) / delta))
        low, high = max(low, enter), min(high, leave)
        if low >= high:
            return False
    return True


def path_terms(start: Position, end: Position, frequency: float, exponent: float,
               obstacles: list[Obstacle]) -> tuple[float, float, float]:
    distance = dist((start.x, start.y, start.z), (end.x, end.y, end.z))
    obstacle_loss = sum(box.loss_db for box in obstacles if crosses(start, end, box))
    return distance, fspl(frequency, 1) + 10 * exponent * log10(max(distance, 1)), obstacle_loss


def panel_gain(antenna: Antenna, point: Position) -> float:
    bearing = degrees(atan2(point.y - antenna.y, point.x - antenna.x))
    offset = (bearing - antenna.azimuth_deg + 180) % 360 - 180
    if antenna.beamwidth_deg == 360:
        return antenna.gain_dbi
    return antenna.gain_dbi - min(12 * (offset / antenna.beamwidth_deg) ** 2, antenna.back_loss_db)


def is_working(layout: Layout, x: float, y: float) -> bool:
    return not any(
        o.x <= x <= o.x + o.width and o.y <= y <= o.y + o.depth for o in layout.obstacles
    )


def grid(layout: Layout):
    # Equal-area samples at the centers of cells, with at most 1,440 cells.
    columns = min(60, int(np.ceil(layout.width_m * 2.5)))
    rows = min(24, int(np.ceil(layout.depth_m * 2.5)))
    dx, dy = layout.width_m / columns, layout.depth_m / rows
    for y in (np.arange(rows) + 0.5) * dy:
        for x in (np.arange(columns) + 0.5) * dx:
            yield Position(x=float(x), y=float(y), z=layout.receiver_height_m), dx, dy
