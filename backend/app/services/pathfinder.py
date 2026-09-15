"""결정론적 안전 경로 탐색 엔진.

AI는 이 결과를 '설명'할 뿐, 경로를 만들지 않는다.
"""

import heapq

from . import graph_loader as gl
from .mobility import MobilityProfile

SMOKE_PENALTY = 3.0   # 연기 구역 통과 비용 배수
NO_ROUTE = "no_route"


def _edge_passable(edge: dict, profile: MobilityProfile) -> bool:
    if edge["kind"] == "stair" and not profile.can_use_stairs:
        return False
    if edge.get("step") and not profile.allow_step and edge["kind"] != "stair":
        return False
    if edge.get("width", 999) < profile.min_width:
        return False
    return True


def _edge_cost(edge: dict, profile: MobilityProfile, smoke: set) -> float:
    cost = float(edge["dist"])
    cost *= profile.edge_penalty.get(edge["kind"], 1.0)
    if edge["to"] in smoke:
        cost *= SMOKE_PENALTY
    return cost


def _destinations(profile: MobilityProfile, start_node: dict, blocked: set) -> list:
    """프로파일에 따라 목적지 후보를 고른다.

    계단 이용 불가 -> 같은 층 대피공간 우선, 없으면 전체 대피공간.
    """
    candidates = gl.nodes_of_type(*profile.destination_types)
    candidates = [n for n in candidates if n["id"] not in blocked]
    if not profile.can_use_stairs:
        same_floor = [n for n in candidates if n["floor"] == start_node["floor"]]
        if same_floor:
            return same_floor
    return candidates


def find_route(start_id: str, profile: MobilityProfile, hazard: dict) -> dict:
    nodes = gl.node_index()
    adj = gl.adjacency()

    if start_id not in nodes:
        raise ValueError(f"알 수 없는 노드: {start_id}")

    blocked = set(hazard.get("blocked_nodes", []))
    smoke = set(hazard.get("smoke_nodes", []))
    start = nodes[start_id]

    targets = {n["id"] for n in _destinations(profile, start, blocked)}
    if not targets:
        return _no_route(start, profile, "이용 가능한 목적지가 없습니다.")

    # 다익스트라
    dist = {start_id: 0.0}
    prev = {}
    visited = set()
    pq = [(0.0, start_id)]
    reached = None

    while pq:
        d, cur = heapq.heappop(pq)
        if cur in visited:
            continue
        visited.add(cur)

        if cur in targets:
            reached = cur
            break

        for edge in adj[cur]:
            nxt = edge["to"]
            if nxt in blocked or nxt in visited:
                continue
            if not _edge_passable(edge, profile):
                continue
            nd = d + _edge_cost(edge, profile, smoke)
            if nd < dist.get(nxt, float("inf")):
                dist[nxt] = nd
                prev[nxt] = (cur, edge)
                heapq.heappush(pq, (nd, nxt))

    if reached is None:
        return _no_route(start, profile, "현재 조건으로 도달 가능한 안전 경로를 찾지 못했습니다.")

    path_ids, legs = _rebuild(reached, prev)
    real_dist = sum(leg["dist"] for leg in legs)

    return {
        "status": "ok",
        "mobility": profile.key,
        "mobility_label": profile.label,
        "start": start,
        "destination": nodes[reached],
        "destination_type": nodes[reached]["type"],
        "facility": gl.facility_info(reached),
        "path": [nodes[i] for i in path_ids],
        "legs": legs,
        "distance_m": round(real_dist, 1),
        "eta_sec": int(real_dist / profile.speed_mps),
        "passes_smoke": [i for i in path_ids if i in smoke],
        "hazard": {
            "blocked_nodes": sorted(blocked),
            "smoke_nodes": sorted(smoke),
            "reasons": hazard.get("reasons", []),
        },
    }


def _rebuild(end_id: str, prev: dict):
    path = [end_id]
    legs = []
    cur = end_id
    while cur in prev:
        parent, edge = prev[cur]
        legs.append(
            {
                "from": parent,
                "to": cur,
                "dist": edge["dist"],
                "kind": edge["kind"],
                "step": edge.get("step", False),
            }
        )
        path.append(parent)
        cur = parent
    path.reverse()
    legs.reverse()
    return path, legs


def _no_route(start: dict, profile: MobilityProfile, reason: str) -> dict:
    """경로 없음 폴백 - 반드시 무언가를 안내한다."""
    return {
        "status": NO_ROUTE,
        "mobility": profile.key,
        "mobility_label": profile.label,
        "start": start,
        "destination": None,
        "reason": reason,
        "fallback_action": (
            "가까운 방화문 안쪽 공간으로 이동해 문을 닫고, "
            "젖은 천으로 문틈을 막은 뒤 119에 현재 위치를 알리고 구조를 기다리세요."
        ),
    }
