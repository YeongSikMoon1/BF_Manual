"""핵심 차별점 검증: 같은 위치·같은 화재에서 상태별로 목적지가 갈리는가."""

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services import graph_loader as gl
from app.services.mobility import get_profile
from app.services.pathfinder import find_route


def route_for(mobility, events=None, start="F2-R205"):
    hazard = gl.apply_events(gl.get_scenario("demo-1"), events or [])
    return find_route(start, get_profile(mobility), hazard)


def test_independent_goes_to_exit():
    r = route_for("independent")
    assert r["status"] == "ok"
    assert r["destination_type"] == "exit"


def test_wheelchair_goes_to_refuge_on_same_floor():
    r = route_for("wheelchair")
    assert r["status"] == "ok"
    assert r["destination_type"] == "refuge"
    assert r["destination"]["floor"] == 2


def test_wheelchair_never_uses_stairs():
    r = route_for("wheelchair")
    assert all(leg["kind"] != "stair" for leg in r["legs"])


def test_walking_aid_has_a_route():
    """보행보조기구 사용자도 반드시 경로가 나와야 한다(단차 규칙에 막히면 안 됨)."""
    r = route_for("walking_aid")
    assert r["status"] == "ok"
    assert r["destination_type"] == "exit"


def test_graph_is_fully_connected():
    """위험이 없을 때는 모든 방에서 모든 상태로 경로가 나와야 한다(그래프 연결성 검증)."""
    rooms = [n["id"] for n in gl.get_building()["nodes"] if n["type"] == "room"]
    hazard = gl.apply_events(gl.get_scenario("none"), [])
    for mob in ("independent", "walking_aid", "wheelchair", "need_help"):
        for room in rooms:
            r = find_route(room, get_profile(mob), hazard)
            assert r["status"] == "ok", f"{mob} / {room} 경로 없음 (그래프 연결 문제)"


def test_never_returns_nothing():
    """경로가 없어도 반드시 폴백 안내가 있어야 한다."""
    rooms = [n["id"] for n in gl.get_building()["nodes"] if n["type"] == "room"]
    for mob in ("independent", "walking_aid", "wheelchair", "need_help"):
        for room in rooms:
            r = route_for(mob, start=room)
            assert r["status"] == "ok" or r.get("fallback_action")


def test_blocked_nodes_excluded():
    r = route_for("independent")
    ids = [n["id"] for n in r["path"]]
    assert "F2-STAIR-B" not in ids and "F2-C4" not in ids


def test_reroute_after_event():
    before = route_for("independent")
    after = route_for("independent", events=["ev-1"])
    assert after["status"] == "ok"
    assert "F2-C5" not in [n["id"] for n in after["path"]]
    assert [n["id"] for n in before["path"]] != [n["id"] for n in after["path"]]


if __name__ == "__main__":
    for name, fn in sorted(list(globals().items())):
        if name.startswith("test_"):
            fn()
            print(f"PASS {name}")
    r = route_for("independent"); print("\n[자력이동]", " → ".join(n["name"] for n in r["path"]))
    r = route_for("wheelchair");  print("[휠체어]  ", " → ".join(n["name"] for n in r["path"]))
    r = route_for("wheelchair", events=["ev-1"]); print("[휠체어+우회]", " → ".join(n["name"] for n in r["path"]))
