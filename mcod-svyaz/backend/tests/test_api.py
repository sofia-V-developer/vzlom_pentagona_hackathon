import json
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import ROOT, create_app
from app.storage import Storage

API = "/api/v1"
NORTH = API + "/sites/north"
EAST = API + "/sites/east"


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(tmp_path / "test.sqlite3", clock=False)) as test:
        yield test


def post(client, path, json=None):
    response = client.post(NORTH + path, json=json)
    assert response.status_code == 200, response.text
    return response.json()


def test_api_validation_and_gsm_read_only(client):
    initial = client.get(NORTH + "/config").json()
    cfg = initial["config"]
    cfg["radio"]["donor_rssi_dbm"] = -190
    assert client.put(NORTH + "/config", json={"config": cfg, "config_revision": 1}).status_code == 422
    cfg["radio"]["donor_rssi_dbm"] = -43
    cfg["gsm_line"] = {"editable": True}
    invalid = client.put(NORTH + "/config", json={"config": cfg, "config_revision": 1})
    assert invalid.status_code == 422
    assert "gsm_line" in invalid.json()["errors"][0]["field"]
    del cfg["gsm_line"]
    original_x = cfg["layout"]["gsm_antenna"]["x"]
    cfg["layout"]["gsm_antenna"]["x"] += 0.1
    assert client.put(NORTH + "/config", json={"config": cfg, "config_revision": 1}).status_code == 422
    cfg["layout"]["gsm_antenna"]["x"] = original_x
    cfg["repeater"]["dl"]["requested_gain_db"] = 41
    assert client.put(NORTH + "/config", json={"config": cfg, "config_revision": 1}).status_code == 200
    assert client.put(NORTH + "/config", json={"config": cfg, "config_revision": 1}).status_code == 409
    actual = client.get(NORTH + "/config").json()
    assert actual["gsm_line"] == initial["gsm_line"]
    assert actual["config_revision"] == 2
    assert client.get(NORTH + "/budget?x=20&y=1").status_code == 422
    assert client.get(NORTH + "/budget?x=nan&y=1").status_code == 422
    assert client.get(API + "/sites/nope/snapshot").status_code == 404


def test_get_never_changes_state_and_sites_are_independent(client):
    east = client.get(EAST + "/snapshot").json()
    east_log = client.get(EAST + "/events").json()
    normal = client.get(NORTH + "/snapshot").json()
    north_log = client.get(NORTH + "/events").json()
    for _ in range(3):
        assert client.get(NORTH + "/snapshot").json() == normal
        assert client.get(NORTH + "/budget?x=6&y=1.5").status_code == 200
        assert client.get(NORTH + "/export/report.md").status_code == 200
    assert client.get(NORTH + "/events").json() == north_log
    post(client, "/scenario", {"scenario": "isolation", "seed": 42})
    post(client, "/simulation/step")
    assert client.get(EAST + "/snapshot").json() == east
    assert client.get(EAST + "/events").json() == east_log


def test_smoke_scenario_protection_and_exports(client):
    assert client.get(API + "/health").json()["data_source"] == "simulated"
    assert client.get(API + "/openapi.json").status_code == 200
    assert client.get(NORTH + "/imd-products?f1=1740&f2=2530").json()["products"] == [
        {"frequency_mhz": 950, "protected_band_hit": True},
        {"frequency_mhz": 3320, "protected_band_hit": False},
    ]
    normal = post(client, "/scenario", {"scenario": "normal", "seed": 42})
    assert normal["protection"]["state"] == "NORMAL"
    assert normal["coverage"]["after"]["coverage_pct"] > normal["coverage"]["before"]["coverage_pct"]
    post(client, "/scenario", {"scenario": "isolation", "seed": 42})
    assert post(client, "/simulation/step")["protection"]["state"] == "LIMITED"
    post(client, "/simulation/step")
    trip = post(client, "/simulation/step")
    assert trip["protection"]["state"] == "TRIPPED"
    assert trip["coverage"]["after"] == trip["coverage"]["before"]
    assert post(client, "/simulation/clear-trip")["protection"]["latched"]
    query = {"x": 6, "y": 1.5, "snapshot_id": trip["snapshot_id"]}
    for format in ("json", "md", "html"):
        response = client.get(NORTH + "/export/report." + format, params=query)
        assert response.status_code == 200
        assert b"NaN" not in response.content and b"Infinity" not in response.content
        if format == "json":
            body = response.json()
            assert body["snapshot"] == trip
            assert body["budget"]["snapshot_id"] == trip["snapshot_id"]
        else:
            assert "Симуляция" in response.text
    assert client.get(NORTH + "/export/config.json").json()["gsm_line"]["editable"] is False
    post(client, "/scenario", {"scenario": "normal"})
    assert post(client, "/simulation/clear-trip")["protection"]["state"] == "NORMAL"


def test_clock_and_reloading_database(tmp_path):
    path = tmp_path / "runtime.sqlite"
    with TestClient(create_app(path)) as client:
        post(client, "/scenario", {"scenario": "isolation"})
        post(client, "/simulation/start")
        assert client.post(NORTH + "/simulation/step").status_code == 409
        deadline = time.monotonic() + 4
        while time.monotonic() < deadline:
            if client.get(NORTH + "/snapshot").json()["simulation_time"] >= 1:
                break
            time.sleep(.05)
        paused = post(client, "/simulation/pause")
        assert paused["simulation_time"] >= 1
        while paused["simulation_time"] < 3:
            paused = post(client, "/simulation/step")
        assert paused["protection"]["latched"]
        config = client.get(NORTH + "/config").json()
        config["config"]["label"] = "МЦОД Проверка"
        response = client.put(NORTH + "/config", json={"config_revision": 1, "config": config["config"]})
        assert response.status_code == 200
        old_ids = {e["seq"] for e in client.get(NORTH + "/events").json()}
    with TestClient(create_app(path, clock=False)) as client:
        assert client.get(NORTH + "/config").json()["config"]["label"] == "МЦОД Проверка"
        assert client.get(NORTH + "/snapshot").json()["protection"]["latched"]
        assert old_ids <= {e["seq"] for e in client.get(NORTH + "/events").json()}


@pytest.mark.parametrize("edited", [False, True])
def test_startup_upgrades_only_the_legacy_bundled_layout(tmp_path, edited):
    config = json.loads((ROOT / "configs/north.json").read_text())
    config["layout"] = json.loads((Path(__file__).parent / "fixtures/north-layout-v1.json").read_text())
    config["repeater"]["dl"]["requested_gain_db"] = 43
    if edited:
        config["layout"]["panels"][0]["x"] = .75
    db_path = tmp_path / "legacy.sqlite3"
    storage = Storage(db_path)
    storage.commit("north", 4, config, {"time": 0, "scenario": "normal", "seed": 42}, [])
    storage.close()
    with TestClient(create_app(db_path, clock=False)) as client:
        response = client.get(NORTH + "/config").json()
        layout = response["config"]["layout"]
        assert response["config"]["repeater"]["dl"]["requested_gain_db"] == 43
        assert response["config_revision"] == (4 if edited else 5)
        if edited:
            assert layout["panels"][0]["x"] == .75
            assert layout["rooms"] == []
        else:
            assert layout["width_m"] == 13.64
            assert len(layout["rooms"]) == 3
            assert any("обновлена по чертежу" in e["label"] for e in client.get(NORTH + "/events").json())
