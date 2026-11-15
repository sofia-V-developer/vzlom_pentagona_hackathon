from pathlib import Path

import pytest

from app.schemas import Position, SiteConfig
from app.simulation.engine import SimulatorAdapter, metrics, point_budget
from app.simulation.link_budget import relay
from app.simulation.propagation import dbm_to_mw, fspl, is_working, mw_to_dbm, path_terms
from app.simulation.protection import decide
from app.simulation.scenarios import Conditions, conditions
from app.simulation.spectrum import Source, active_imd, evaluate, products

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def config():
    return SiteConfig.model_validate_json((ROOT / "configs/north.json").read_text())


@pytest.fixture
def point():
    return Position(x=6.82, y=6.4, z=1.35)


def snapshot(config, scenario="normal", time=0, seed=42, latch=None):
    return SimulatorAdapter().capture(site_id="north", base=config, revision=1, scenario=scenario, seed=seed,
                                      time=time, running=False, latch=latch, trigger=None)[0]


@pytest.mark.parametrize("value", [-110, -30, 0, 23])
def test_power_conversion(value):
    assert mw_to_dbm(dbm_to_mw(value)) == pytest.approx(value)
    assert mw_to_dbm(0) is None


def test_path_with_height_distance_and_obstacle(config):
    rack = config.layout.obstacles[0]
    y = rack.y + rack.depth / 2
    start = Position(x=rack.x - 1, y=y, z=1)
    near = Position(x=rack.x - .25, y=y, z=1)
    far = Position(x=rack.x + rack.width + .25, y=y, z=1)
    near_terms = path_terms(start, near, 2650, 2.3, [rack])
    far_terms = path_terms(start, far, 2650, 2.3, [rack])
    assert fspl(2650, 0) == fspl(2650, 1)
    assert near_terms[1] < far_terms[1]
    assert (near_terms[2], far_terms[2]) == (0, rack.loss_db)
    assert path_terms(start.model_copy(update={"z": 3}), far.model_copy(update={"z": 3}), 2650, 2.3, [rack])[2] == 0


def test_known_dl_budget(config):
    config.layout.obstacles = []
    config.radio.path_exponent = (55 - fspl(2650, 1)) / 10
    panel = config.layout.panels[0]
    config.layout.panels[1].enabled = False
    panel.z = 1.35
    point = Position(x=panel.x + 10, y=panel.y, z=panel.z)
    protection, *_ = decide(conditions(config, "normal", 0, 42), None)
    assert protection["state"] == "NORMAL"
    actual, _, rows = relay(config, point, protection["dl"]["applied_gain_db"], 48, True)[0]
    assert actual == pytest.approx(-80 - 3 + 55 - 9 + 6 - 55)
    assert rows[-1]["total_dbm"] == pytest.approx(-86)


def test_total_dl_power_changes_rsrp(config, point):
    normal, *_ = decide(conditions(config, "normal", 0, 42), None)
    config.repeater.dl.max_output_dbm = 1
    p, *_ = decide(conditions(config, "normal", 0, 42), None)
    assert p["state"] == "LIMITED"
    assert p["dl"]["input_power_dbm"] == -46
    assert p["dl"]["output_power_dbm"] == 1
    assert p["dl"]["requested_gain_db"] == 55
    assert p["dl"]["applied_gain_db"] == 47
    assert point_budget(config, normal, point)["relay_dl_dbm"] - point_budget(config, p, point)["relay_dl_dbm"] == pytest.approx(8)


def test_uplink_has_separate_budget_and_limit(config, point):
    p, *_ = decide(conditions(config, "normal", 0, 42), None)
    result = point_budget(config, p, point)
    first, last = result["after_ul_rows"][0], result["after_ul_rows"][-1]
    assert first["value"] == config.radio.phone_power_dbm
    assert result["after_ul_margin_db"] == pytest.approx(last["total_dbm"] - config.radio.base_receiver_threshold_dbm)
    config.repeater.ul.max_output_dbm = -4
    limited = point_budget(config, p, point)
    assert limited["after_dl_dbm"] == result["after_dl_dbm"]
    assert limited["after_ul_margin_db"] < result["after_ul_margin_db"]
    row = next(row for row in limited["after_ul_rows"] if "выход репитера" in row["label"])
    assert row["total_dbm"] == pytest.approx(-4)


def test_isolation_limits_and_latches(config):
    config.repeater.mode = "manual"
    limited = snapshot(config, "isolation", 1)
    assert limited["protection"]["state"] == "LIMITED"
    assert limited["protection"]["dl"]["applied_gain_db"] == 23
    assert limited["protection"]["dl"]["stability_margin_db"] == 15
    trip = snapshot(config, "isolation", 3)
    assert trip["protection"]["state"] == "TRIPPED"
    assert trip["protection"]["dl"]["applied_gain_db"] is None
    assert trip["coverage"]["after"] == trip["coverage"]["before"]
    assert snapshot(config, latch=trip["protection"]["reason"])["protection"]["state"] == "TRIPPED"


def test_off_and_lost_donor(config, point):
    off = snapshot(config, "baseline")
    assert off["protection"]["state"] == "OFF"
    budget = SimulatorAdapter().budget(off, point)
    assert budget["after_dl_dbm"] == budget["before_dl_dbm"]
    assert budget["relay_dl_dbm"] is None
    lost = snapshot(config, "donor_loss", 3)
    budget = SimulatorAdapter().budget(lost, point)
    assert budget["after_dl_dbm"] is budget["after_ul_margin_db"] is None
    assert budget["signal_note"]


def test_racks_excluded(config):
    rack = config.layout.obstacles[0]
    assert not is_working(config.layout, rack.x + .1, rack.y + .1)
    assert is_working(config.layout, 6.82, 6.4)
    cells = [{"working": True, "after_dl_dbm": -90, "after_ul_margin_db": 2},
             {"working": False, "after_dl_dbm": -150, "after_ul_margin_db": -100}]
    result = metrics(cells, "after", -105)
    assert result["coverage_pct"] == result["both_pct"] == 100
    assert result["min_rsrp_dbm"] == -90


def test_branch_disable_keeps_distribution_loss(config):
    before = snapshot(config, "branch", 0)
    after = snapshot(config, "branch", 3)
    assert before["branches"][-1]["active"]
    assert not after["branches"][-1]["active"]
    assert after["config"]["radio"]["splitter_loss_db"] == before["config"]["radio"]["splitter_loss_db"]
    assert after["coverage"]["after"]["coverage_pct"] < before["coverage"]["after"]["coverage_pct"]


def test_imd_frequencies_and_filter_topology(config):
    assert products(1740, 2530) == [950, 3320]
    imd = active_imd(1740, 2530, -12, 12)[0]
    assert imd.power_dbm == -60
    before = Source("До", "pim", "before_service_filter", 950, -30, 0, True, "Синтетика")
    after = Source("После", "pim", "after_service_filter", 950, -30, 0, True, "Синтетика")
    result = evaluate(config, (before, after), True)
    assert result["components"][0]["receiver_dbm"] == -117
    assert result["components"][1]["receiver_dbm"] == -82
    assert result["status"] == "FAIL"
    assert result["channels"][0]["power_dbm"] == pytest.approx(mw_to_dbm(dbm_to_mw(-117) + dbm_to_mw(-82)))


def test_filter_failure_needs_source(config):
    failed = conditions(config, "filter", 3, 42)
    assert not failed.config.filters[-1].healthy
    assert decide(Conditions(failed.config, ()), None)[0]["gsm"]["status"] == "PASS"
    p, _, cause = decide(failed, None)
    assert p["state"] == "TRIPPED"
    assert p["gsm"]["status"] == "PASS"
    assert cause["status"] == "FAIL"


def test_external_remains_after_trip(config):
    p = snapshot(config, "pim", 3)
    assert p["protection"]["state"] == "TRIPPED"
    gsm = p["protection"]["gsm"]
    assert gsm["status"] == "FAIL"
    assert [c["label"] for c in gsm["components"] if c["enabled"]] == ["Независимая внешняя помеха"]
    assert all(c["receiver_dbm"] is None for c in gsm["components"] if not c["enabled"])


def test_missing_parameters_and_wideband_overlap(config):
    config.gsm_criteria.coupling_loss_db = None
    p, *_ = decide(conditions(config, "normal", 0, 42), None)
    assert p["gsm"]["status"] == p["state"] == "UNKNOWN"
    config.gsm_criteria.coupling_loss_db = 52
    source = Source("Широкополосный источник", "external", "external", 950, -115, 500, False, "Синтетика")
    result = evaluate(config, (source,), True)
    assert result["channels"][0]["power_dbm"] is None
    assert result["status"] == "UNKNOWN"


def test_blocker_limit_reduces_only_gain_dependent_power(config):
    config.gsm_criteria.blocker_limit_dbm = -60
    p, *_ = decide(conditions(config, "normal", 0, 42), None)
    assert p["state"] == "LIMITED"
    assert p["dl"]["limiter"] == "Внеполосный порог GSM"
    assert p["dl"]["applied_gain_db"] < p["dl"]["requested_gain_db"]
    assert p["gsm"]["blocker_dbm"] < -60
    assert p["gsm"]["status"] == "PASS"


def test_seed_reproducibility(config):
    first = snapshot(config, "pim", 3, 42)
    same = snapshot(config, "pim", 3, 42)
    different = snapshot(config, "pim", 3, 43)
    del first["timestamp"], same["timestamp"]
    assert same == first
    assert different["trip_gsm"]["components"] != first["trip_gsm"]["components"]


def test_drawing_walls_and_door_are_used_by_the_model(config):
    layout = config.layout
    assert [room.drawing_area_m2 for room in layout.rooms] == [29.8, 10.1, 84.8]
    partitions = [item for item in layout.obstacles if item.kind == "partition"]
    assert not is_working(layout, 11.5, 3.1)
    assert is_working(layout, 12.4, 3.1)
    for x, loss in ((11.5, 16), (12.4, 0)):
        start = Position(x=x, y=2.8, z=1.35)
        end = Position(x=x, y=3.4, z=1.35)
        assert path_terms(start, end, 2650, 2.3, partitions)[2] == loss
    rooms = {room["id"]: room for room in snapshot(config)["coverage"]["rooms"]}
    assert rooms["hall"]["after"]["working_cells"] > rooms["energy"]["after"]["working_cells"]
    assert rooms["hall"]["after"]["coverage_pct"] > rooms["energy"]["after"]["coverage_pct"]
