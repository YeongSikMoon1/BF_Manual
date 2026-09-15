"""대피 행동요령 생성 Agent.

설계 원칙 (기획서 8-3 준수):
  AI는 경로나 화재 위치를 판단하지 않는다.
  이미 계산된 경로 + 시설 정보를 '사람이 읽을 문장'으로 바꾸기만 한다.

흐름: summarize -> generate(OpenAI) -> validate -> fallback
OPENAI_API_KEY가 없거나 호출이 실패하면 즉시 템플릿 폴백으로 내려간다.
"""

import json
import logging
import os

log = logging.getLogger(__name__)

MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

SYSTEM_PROMPT = """당신은 화재 대피 안내 문구를 작성하는 보조자입니다.

반드시 지켜야 할 규칙:
1. 주어진 경로를 바꾸거나 새로운 방향·목적지를 제시하지 마십시오.
2. 주어진 정보에 없는 시설, 층, 출구를 언급하지 마십시오.
3. 전문용어 없이 짧고 명확한 문장으로 작성하십시오.
4. 반드시 아래 JSON 스키마로만 답하십시오. 다른 텍스트를 덧붙이지 마십시오.

{
  "headline": "한 문장 요약",
  "steps": ["행동 1", "행동 2", "행동 3", "행동 4"],
  "cautions": ["주의사항 1"]
}"""

REQUIRED_KEYS = ("headline", "steps", "cautions")
FORBIDDEN = ("엘리베이터", "승강기")  # 화재 시 절대 안내하면 안 되는 표현

DISCLAIMER = "AI가 생성한 안내입니다. 현장 상황과 다를 수 있으니 반드시 눈으로 확인하세요."


# --------------------------------------------------------------------------
# 1) summarize
# --------------------------------------------------------------------------
def summarize(route: dict) -> str:
    if route["status"] != "ok":
        return "경로 계산 실패"

    steps = []
    for leg in route["legs"]:
        steps.append(f"{leg['from']} → {leg['to']} ({leg['dist']}m, {leg['kind']})")

    facility = route.get("facility") or {}
    return json.dumps(
        {
            "대피자_상태": route["mobility_label"],
            "현재_위치": route["start"]["name"],
            "목적지": route["destination"]["name"],
            "목적지_종류": "비상구(외부 대피)" if route["destination_type"] == "exit" else "방화구획 대피공간(구조 대기)",
            "총_거리_m": route["distance_m"],
            "예상_소요_초": route["eta_sec"],
            "경로": steps,
            "연기_통과_구간": route["passes_smoke"],
            "차단_구역": route["hazard"]["blocked_nodes"],
            "위험_변화": route["hazard"]["reasons"],
            "시설_정보": facility,
        },
        ensure_ascii=False,
        indent=2,
    )


# --------------------------------------------------------------------------
# 2) generate
# --------------------------------------------------------------------------
def _call_openai(summary: str) -> dict:
    from langchain_openai import ChatOpenAI
    from langchain_core.messages import SystemMessage, HumanMessage

    llm = ChatOpenAI(model=MODEL, temperature=0.2, timeout=8, max_retries=1)
    resp = llm.invoke(
        [
            SystemMessage(content=SYSTEM_PROMPT),
            HumanMessage(content=f"다음 상황에 대한 대피 행동요령을 작성하세요.\n\n{summary}"),
        ]
    )
    text = resp.content.strip()
    if text.startswith("```"):
        text = text.split("```")[1].lstrip("json").strip()
    return json.loads(text)


# --------------------------------------------------------------------------
# 3) validate
# --------------------------------------------------------------------------
def validate(guide: dict) -> bool:
    if not all(k in guide for k in REQUIRED_KEYS):
        return False
    if not isinstance(guide["steps"], list) or not guide["steps"]:
        return False
    blob = json.dumps(guide, ensure_ascii=False)
    if any(word in blob for word in FORBIDDEN):
        log.warning("금지 표현이 포함되어 폴백 처리: %s", blob[:200])
        return False
    return True


# --------------------------------------------------------------------------
# 4) fallback
# --------------------------------------------------------------------------
def fallback(route: dict) -> dict:
    if route["status"] != "ok":
        return {
            "headline": "안전한 경로를 찾지 못했습니다",
            "steps": [
                "가까운 방 안으로 들어가 문을 닫으세요.",
                "젖은 천으로 문틈을 막아 연기 유입을 차단하세요.",
                "119에 현재 층과 호실을 알리고 구조를 기다리세요.",
            ],
            "cautions": [route.get("reason", "")],
            "source": "fallback",
            "disclaimer": DISCLAIMER,
        }

    dest = route["destination"]
    is_exit = route["destination_type"] == "exit"
    steps = [
        "문을 열기 전 손잡이가 뜨거운지 확인하세요.",
        "자세를 낮추고 벽을 짚으며 이동하세요.",
        f"{dest['name']}까지 약 {route['distance_m']}m 이동하세요.",
    ]
    steps.append(
        "건물 밖으로 나온 뒤 집결지로 이동하세요."
        if is_exit
        else "대피공간에 들어가면 방화문을 닫고 119에 위치를 알린 뒤 구조를 기다리세요."
    )
    cautions = ["화재 시 엘리베이터를 사용하지 마세요."]
    if route["passes_smoke"]:
        cautions.append("경로 일부에 연기가 있습니다. 낮은 자세를 유지하세요.")
    cautions += [r for r in route["hazard"]["reasons"] if r]

    return {
        "headline": f"{dest['name']}(으)로 이동하세요",
        "steps": steps,
        "cautions": cautions,
        "source": "fallback",
        "disclaimer": DISCLAIMER,
    }


# --------------------------------------------------------------------------
# 공개 함수
# --------------------------------------------------------------------------
def generate_guide(route: dict) -> dict:
    if not os.getenv("OPENAI_API_KEY"):
        return fallback(route)
    if route["status"] != "ok":
        return fallback(route)

    try:
        guide = _call_openai(summarize(route))
        if validate(guide):
            guide["source"] = "ai"
            guide["disclaimer"] = DISCLAIMER
            guide.setdefault("cautions", []).append("화재 시 엘리베이터를 사용하지 마세요.")
            return guide
        log.warning("AI 응답 검증 실패 → 폴백")
    except Exception as exc:  # noqa: BLE001
        log.warning("AI 호출 실패(%s) → 폴백", exc)

    return fallback(route)
