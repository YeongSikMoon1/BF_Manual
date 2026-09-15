"""도움 요청 내용 미리보기 생성.

MVP에서는 실제 전송(카카오/문자/전화)을 하지 않는다. 텍스트만 만들어 준다.
개인정보(이름, 연락처 등)는 입력받지도, 포함하지도 않는다.
"""

from datetime import datetime


def build(route: dict, note: str = "") -> dict:
    now = datetime.now().strftime("%H:%M")
    start = route["start"]

    lines = [
        "[BF Manual 도움 요청]",
        f"발생 시각: {now}",
        f"현재 위치: {start['floor']}층 {start['name']}",
        f"이동 상태: {route['mobility_label']}",
    ]

    if route["status"] == "ok":
        dest = route["destination"]
        kind = "외부 대피(비상구)" if route["destination_type"] == "exit" else "구조 대기(방화구획 대피공간)"
        lines += [
            f"목적지: {dest['floor']}층 {dest['name']}",
            f"대피 유형: {kind}",
            f"이동 거리: 약 {route['distance_m']}m (예상 {route['eta_sec']}초)",
        ]
        if route["passes_smoke"]:
            lines.append("경로 중 연기 구간 있음")
        for reason in route["hazard"]["reasons"]:
            lines.append(f"상황 변화: {reason}")
    else:
        lines.append("상태: 안전 경로 확보 실패 — 현재 위치에서 구조 필요")

    if note:
        lines.append(f"추가 내용: {note}")

    lines.append("※ 본 내용은 미리보기입니다. 실제 신고는 119로 해주세요.")

    return {"text": "\n".join(lines), "sent": False}
