"""building.json / hazard_scenarios.json 로딩 및 인접 리스트 구성."""

import json
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

_cache = {}


def _load(filename: str):
    if filename not in _cache:
        with open(DATA_DIR / filename, encoding="utf-8") as f:
            _cache[filename] = json.load(f)
    return _cache[filename]


def reload_all():
    """개발 중 JSON을 수정했을 때 캐시를 비운다."""
    _cache.clear()


def get_building() -> dict:
    return _load("building.json")


def get_scenarios() -> dict:
    return _load("hazard_scenarios.json")


def get_scenario(key: str) -> dict:
    scenarios = get_scenarios()
    return scenarios.get(key or "none", scenarios["none"])


def node_index() -> dict:
    """{node_id: node_dict}"""
    return {n["id"]: n for n in get_building()["nodes"]}


def adjacency() -> dict:
    """{node_id: [edge_dict, ...]} - 무방향 그래프로 양방향 등록."""
    adj = {n["id"]: [] for n in get_building()["nodes"]}
    for e in get_building()["edges"]:
        adj[e["from"]].append({**e, "to": e["to"], "from": e["from"]})
        adj[e["to"]].append({**e, "to": e["from"], "from": e["to"]})
    return adj


def nodes_of_type(*types: str) -> list:
    return [n for n in get_building()["nodes"] if n["type"] in types]


def facility_info(node_id: str) -> dict:
    return get_building().get("facilities", {}).get(node_id, {})


def apply_events(scenario: dict, event_ids: list) -> dict:
    """시연용 이벤트를 적용해 확장된 위험 상태를 만든다."""
    blocked = list(scenario.get("blocked_nodes", []))
    smoke = list(scenario.get("smoke_nodes", []))
    reasons = []
    for ev in scenario.get("events", []):
        if ev["id"] in (event_ids or []):
            blocked += ev.get("add_blocked", [])
            smoke += ev.get("add_smoke", [])
            reasons.append(ev.get("reason", ev.get("label", "")))
    return {
        "blocked_nodes": sorted(set(blocked)),
        "smoke_nodes": sorted(set(smoke) - set(blocked)),
        "reasons": reasons,
        "name": scenario.get("name"),
        "origin": scenario.get("origin"),
    }
