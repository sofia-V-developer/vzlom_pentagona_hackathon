from math import log10
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Schema(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False, str_strip_whitespace=True)


Name = Annotated[str, Field(min_length=1, max_length=100, pattern=r"^[^\r\n]+$")]
Key = Annotated[str, Field(pattern=r"^[a-z][a-z0-9_-]{0,39}$")]
Loss = Annotated[float, Field(ge=0, le=180)]
Frequency = Annotated[float, Field(gt=0, le=10000)]
Power = Annotated[float, Field(ge=-200, le=60)]
Gain = Annotated[float, Field(ge=0, le=120)]


class Band(Schema):
    low_mhz: Frequency
    high_mhz: Frequency

    @model_validator(mode="after")
    def ordered(self):
        if self.low_mhz >= self.high_mhz:
            raise ValueError("Нижняя частота должна быть меньше верхней")
        return self

    def contains(self, mhz: float) -> bool:
        return self.low_mhz <= mhz <= self.high_mhz


class OperatorProfile(Schema):
    id: Key
    label: Name
    ul_band: Band
    dl_band: Band
    ul_mhz: Frequency
    dl_mhz: Frequency
    bandwidth_mhz: Annotated[float, Field(gt=0, le=100)]

    @model_validator(mode="after")
    def inside_bands(self):
        half = self.bandwidth_mhz / 2
        for center, band in ((self.ul_mhz, self.ul_band), (self.dl_mhz, self.dl_band)):
            if not (band.contains(center - half) and band.contains(center + half)):
                raise ValueError("Канал должен целиком помещаться в полосу профиля")
        if self.ul_band.high_mhz >= self.dl_band.low_mhz:
            raise ValueError("Полосы UL и DL должны быть разделены")
        return self


class Position(Schema):
    x: Annotated[float, Field(ge=-100, le=100)]
    y: Annotated[float, Field(ge=-100, le=100)]
    z: Annotated[float, Field(ge=0, le=100)]


class Antenna(Position):
    id: Key
    label: Name
    azimuth_deg: Annotated[float, Field(ge=0, lt=360)]
    gain_dbi: Annotated[float, Field(ge=-10, le=35)]
    beamwidth_deg: Annotated[float, Field(gt=0, le=360)]
    back_loss_db: Loss
    cable_loss_db: Loss
    enabled: bool


class Obstacle(Position):
    id: Key
    label: Name
    kind: Literal["rack", "partition", "equipment"]
    width: Annotated[float, Field(gt=0, le=60)]
    depth: Annotated[float, Field(gt=0, le=20)]
    height: Annotated[float, Field(gt=0, le=12)]
    loss_db: Loss


class Room(Schema):
    id: Key
    label: Name
    x: Annotated[float, Field(ge=0, le=30)]
    y: Annotated[float, Field(ge=0, le=12)]
    width: Annotated[float, Field(gt=0, le=30)]
    depth: Annotated[float, Field(gt=0, le=12)]
    drawing_area_m2: Annotated[float, Field(gt=0, le=360)]


class Layout(Schema):
    width_m: Annotated[float, Field(ge=3, le=30)]
    depth_m: Annotated[float, Field(ge=2, le=12)]
    height_m: Annotated[float, Field(ge=2, le=8)]
    receiver_height_m: Annotated[float, Field(gt=0, le=8)]
    obstacles: Annotated[list[Obstacle], Field(max_length=100)]
    rooms: Annotated[list[Room], Field(max_length=12)] = Field(default_factory=list)
    source: Name | None = None
    panels: Annotated[list[Antenna], Field(min_length=1, max_length=6)]
    donor: Antenna
    repeater: Position
    splitter: Position
    gsm_antenna: Position


class Radio(Schema):
    donor_rsrp_dbm: Power | None
    donor_rssi_dbm: Power | None
    facade_rsrp_dbm: Power | None
    envelope_loss_db: Loss
    splitter_loss_db: Loss
    path_exponent: Annotated[float, Field(ge=1, le=6)]
    phone_power_dbm: Annotated[float, Field(ge=-40, le=33)]
    outdoor_path_loss_db: Loss
    base_receiver_threshold_dbm: Power
    coverage_threshold_dbm: Power

    @model_validator(mode="after")
    def input_power(self):
        if self.donor_rsrp_dbm is not None and (
            self.donor_rssi_dbm is None or self.donor_rssi_dbm < self.donor_rsrp_dbm
        ):
            raise ValueError("Для известного RSRP укажите RSSI не ниже RSRP")
        return self


class Direction(Schema):
    requested_gain_db: Gain
    max_gain_db: Gain
    max_output_dbm: Power
    isolation_db: Loss


class Repeater(Schema):
    enabled: bool
    mode: Literal["auto", "manual"]
    required_margin_db: Loss
    dl: Direction
    ul: Direction


class Filter(Schema):
    id: Key
    label: Name
    side: Literal["donor", "service"]
    healthy: bool
    passbands: Annotated[list[Band], Field(min_length=1, max_length=4)]
    insertion_loss_db: Loss
    stopbands: Annotated[list[Band], Field(max_length=8)]
    stop_loss_db: Loss
    failed_loss_db: Loss


class Channel(Schema):
    center_mhz: Frequency
    bandwidth_khz: Annotated[float, Field(gt=0, le=2000)]

    def contains(self, frequency: float) -> bool:
        return abs(frequency - self.center_mhz) <= self.bandwidth_khz / 2000


class GsmCriteria(Schema):
    protected_bands: Annotated[list[Band], Field(max_length=8)]
    channels: Annotated[list[Channel], Field(max_length=12)]
    interference_limit_dbm: Power | None
    blocker_limit_dbm: Power | None
    coupling_loss_db: Loss | None

    @model_validator(mode="after")
    def contained(self):
        for channel in self.channels:
            half = channel.bandwidth_khz / 2000
            if not any(b.contains(channel.center_mhz - half) and b.contains(channel.center_mhz + half)
                       for b in self.protected_bands):
                raise ValueError("Контрольный канал должен целиком помещаться в защищаемое окно")
        return self


class SiteConfig(Schema):
    label: Name
    profile: OperatorProfile
    layout: Layout
    radio: Radio
    repeater: Repeater
    filters: Annotated[list[Filter], Field(min_length=1, max_length=6)]
    gsm_criteria: GsmCriteria

    @model_validator(mode="after")
    def geometry(self):
        room = self.layout

        def inside(x, y, z):
            return 0 <= x <= room.width_m + 1e-9 and 0 <= y <= room.depth_m + 1e-9 and 0 <= z <= room.height_m + 1e-9

        if room.receiver_height_m > room.height_m:
            raise ValueError("Высота телефона превышает высоту помещения")
        for item in [*room.panels, room.repeater, room.splitter]:
            if not inside(item.x, item.y, item.z):
                raise ValueError("Координаты внутреннего оборудования выходят за пределы помещения")
        for item in room.obstacles:
            if not (inside(item.x, item.y, item.z)
                    and inside(item.x + item.width, item.y + item.depth, item.z + item.height)):
                raise ValueError(f"Препятствие «{item.label}» выходит за пределы помещения")
        for zone in room.rooms:
            if not inside(zone.x + zone.width, zone.y + zone.depth, 0):
                raise ValueError(f"Помещение «{zone.label}» выходит за пределы плана")
        for item in (room.donor, room.gsm_antenna):
            if inside(item.x, item.y, item.z):
                raise ValueError("Внешние антенны должны находиться за пределами помещения")
        for group in (room.panels, room.obstacles, room.rooms, self.filters):
            if len({item.id for item in group}) != len(group):
                raise ValueError("Идентификаторы компонентов должны быть уникальными")
        if self.radio.splitter_loss_db + 0.01 < 10 * log10(len(room.panels)):
            raise ValueError("Потери делителя меньше идеальных потерь для числа ветвей")
        return self


class ConfigUpdate(Schema):
    config_revision: Annotated[int, Field(ge=1)]
    config: SiteConfig


class ScenarioCommand(Schema):
    scenario: Literal["baseline", "normal", "isolation", "filter", "donor_loss", "branch", "pim"]
    seed: Annotated[int, Field(ge=0, le=4294967295)] = 42
