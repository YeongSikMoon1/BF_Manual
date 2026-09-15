/**
 * 전역 상태 저장소 (store)
 *
 * 역할 분담
 *   state.js     : 상태 보관 + 변경 알림 + 파생값(selector). 네트워크 호출 없음.
 *   api.js       : 백엔드 호출만 담당.
 *   floorplan.js : SVG 렌더링.
 *   screens/*.js : 사용자 입력을 받아 action 호출 → 상태 변경 → 구독 콜백에서 다시 그림.
 *
 * 원칙
 *   - 경로 계산 결과(route)는 백엔드가 준 값을 그대로 보관한다. 여기서 가공하지 않는다.
 *   - 개인정보(이름/연락처 등)는 어떤 필드에도 담지 않는다.
 *   - 화면 모듈은 state 객체를 직접 수정하지 않고 아래 action 함수만 사용한다.
 */

/** 화면 식별자 */
export const SCREEN = {
  MOBILITY: 'screen1',   // 이동 상태 선택
  PLAN: 'screen2',       // 평면도 / 경로
  AR: 'screen3',         // AR 안내
};

const INITIAL = {
  // 화면
  screen: SCREEN.MOBILITY,

  // 서버에서 받아온 정적 데이터
  building: null,        // GET /api/building  { building_id, name, floors, nodes, edges, facilities }
  profiles: [],          // GET /api/mobility  [{ key, label, destination_type }]
  scenarios: [],         // GET /api/scenarios [{ key, name, origin, events:[{id,label}] }]

  // 사용자 선택
  mobility: null,        // 선택한 이동 상태 key (예: 'wheelchair')
  scenarioKey: 'demo-1', // 시연 시나리오 key
  triggeredEvents: [],   // 발생시킨 상황 변화 이벤트 id 목록
  startNodeId: null,     // 평면도에서 탭한 현재 위치 노드 id
  floor: 3,              // 평면도에 그릴 층

  // 계산 결과
  route: null,           // POST /api/route | /api/reroute 응답
  guide: null,           // POST /api/guide 응답
  helpText: null,        // POST /api/help-message 응답의 text

  // AR 진행 상황 (route.legs 기준 몇 번째 구간까지 지났는지)
  arLegIndex: 0,

  // UI 상태
  loading: {},           // { route: true, guide: false, ... }
  error: null,           // 사용자에게 보여줄 오류 메시지
};

const state = { ...INITIAL };

/** @type {Set<{keys: Set<string>|null, handler: Function}>} */
const subscribers = new Set();

// --------------------------------------------------------------------------
// 읽기 / 쓰기 / 구독
// --------------------------------------------------------------------------

/** 현재 상태 스냅샷. 반환값을 직접 수정하지 말 것. */
export function getState() {
  return state;
}

/**
 * 상태를 부분 갱신한다. 값이 실제로 바뀐 키만 구독자에게 알린다.
 * @param {object} patch
 * @returns {string[]} 변경된 키 목록
 */
export function setState(patch) {
  const changed = [];
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in state)) {
      console.warn('[state] 정의되지 않은 키를 무시했습니다:', key);
      continue;
    }
    if (state[key] === value) continue;
    state[key] = value;
    changed.push(key);
  }
  if (changed.length) notify(changed);
  return changed;
}

/**
 * 상태 변경 구독.
 * @param {string[]|null} keys 관심 있는 키 목록. null 이면 모든 변경을 받는다.
 * @param {(s: object, changed: string[]) => void} handler
 * @returns {() => void} 구독 해제 함수
 */
export function subscribe(keys, handler) {
  const entry = { keys: keys ? new Set(keys) : null, handler };
  subscribers.add(entry);
  return () => subscribers.delete(entry);
}

function notify(changed) {
  for (const { keys, handler } of subscribers) {
    if (keys && !changed.some((k) => keys.has(k))) continue;
    try {
      handler(state, changed);
    } catch (err) {
      console.error('[state] 구독자 처리 중 오류', err);
    }
  }
}

// --------------------------------------------------------------------------
// action — 화면 모듈이 호출하는 상태 변경 함수
// --------------------------------------------------------------------------

export function goScreen(screen) {
  setState({ screen });
}

export function setBuilding(building) {
  setState({ building });
}

export function setProfiles(profiles) {
  setState({ profiles: profiles || [] });
}

export function setScenarios(scenarios) {
  setState({ scenarios: scenarios || [] });
}

/** 이동 상태 선택. 바뀌면 이전 경로/안내는 무효가 된다. */
export function selectMobility(key) {
  if (state.mobility === key) return;
  setState({ mobility: key });
  clearRoute();
}

/** 시연 시나리오 변경. 이벤트와 경로를 초기화한다. */
export function selectScenario(key) {
  if (state.scenarioKey === key) return;
  setState({ scenarioKey: key, triggeredEvents: [] });
  clearRoute();
}

/** 평면도에서 현재 위치 선택. */
export function selectStartNode(nodeId) {
  const node = nodeById(nodeId);
  setState({
    startNodeId: nodeId,
    floor: node ? node.floor : state.floor,
  });
}

export function setFloor(floor) {
  setState({ floor });
}

/** 상황 변화 이벤트 발생(시연용). 이미 발생한 이벤트는 중복 추가하지 않는다. */
export function triggerEvent(eventId) {
  if (!eventId || state.triggeredEvents.includes(eventId)) return false;
  setState({ triggeredEvents: [...state.triggeredEvents, eventId] });
  return true;
}

export function resetEvents() {
  if (!state.triggeredEvents.length) return;
  setState({ triggeredEvents: [] });
}

/** 경로 계산 결과 반영. 새 경로가 오면 안내문과 AR 진행 상황은 초기화한다. */
export function setRoute(route) {
  setState({ route, guide: null, helpText: null, arLegIndex: 0, error: null });
}

export function setGuide(guide) {
  setState({ guide });
}

export function setHelpText(text) {
  setState({ helpText: text });
}

export function clearRoute() {
  setState({ route: null, guide: null, helpText: null, arLegIndex: 0 });
}

/** AR에서 '이 지점 도착'. 마지막 구간이면 false 를 반환한다. */
export function advanceArLeg() {
  const total = legCount();
  if (state.arLegIndex >= total) return false;
  setState({ arLegIndex: state.arLegIndex + 1 });
  return state.arLegIndex < total;
}

export function resetArProgress() {
  setState({ arLegIndex: 0 });
}

export function setLoading(key, value) {
  setState({ loading: { ...state.loading, [key]: !!value } });
}

export function setError(message) {
  setState({ error: message || null });
}

// --------------------------------------------------------------------------
// selector — 상태에서 뽑아낸 파생값
// --------------------------------------------------------------------------

export function isLoading(key) {
  return !!state.loading[key];
}

export function nodeById(nodeId) {
  if (!nodeId || !state.building) return null;
  return state.building.nodes.find((n) => n.id === nodeId) || null;
}

export function nodesOnFloor(floor = state.floor) {
  if (!state.building) return [];
  return state.building.nodes.filter((n) => n.floor === floor);
}

export function edgesOnFloor(floor = state.floor) {
  if (!state.building) return [];
  const ids = new Set(nodesOnFloor(floor).map((n) => n.id));
  return state.building.edges.filter((e) => ids.has(e.from) && ids.has(e.to));
}

export function currentProfile() {
  return state.profiles.find((p) => p.key === state.mobility) || null;
}

export function mobilityLabel() {
  const profile = currentProfile();
  return profile ? profile.label : (state.route ? state.route.mobility_label : '—');
}

export function currentScenario() {
  return state.scenarios.find((s) => s.key === state.scenarioKey) || null;
}

/** 아직 발생시키지 않은 다음 상황 변화 이벤트. 없으면 null. */
export function nextPendingEvent() {
  const scenario = currentScenario();
  if (!scenario) return null;
  return (scenario.events || []).find((e) => !state.triggeredEvents.includes(e.id)) || null;
}

export function startNode() {
  return nodeById(state.startNodeId);
}

/** 경로 계산이 성공한 상태인지. */
export function hasRoute() {
  return !!state.route && state.route.status === 'ok';
}

/** 경로 없음 폴백 상태인지. */
export function isNoRoute() {
  return !!state.route && state.route.status !== 'ok';
}

/** 경로에 포함된 노드 id 목록(평면도 하이라이트용). */
export function pathNodeIds() {
  if (!hasRoute()) return [];
  return state.route.path.map((n) => n.id);
}

export function legs() {
  return hasRoute() ? state.route.legs : [];
}

export function legCount() {
  return legs().length;
}

/** 목적지가 외부 대피(비상구)인지. false 면 구조 대기(대피공간). */
export function isExitDestination() {
  return hasRoute() && state.route.destination_type === 'exit';
}

/** 목적지 종류를 사람이 읽는 문구로. */
export function destinationKindLabel() {
  if (!hasRoute()) return '—';
  return isExitDestination() ? '외부 대피' : '구조 대기';
}

export function blockedNodeIds() {
  return state.route ? (state.route.hazard ? state.route.hazard.blocked_nodes : []) : [];
}

export function smokeNodeIds() {
  return state.route ? (state.route.hazard ? state.route.hazard.smoke_nodes : []) : [];
}

/** 예상 소요시간을 'N분 M초' 형태로. */
export function etaLabel() {
  if (!hasRoute()) return '—';
  const sec = state.route.eta_sec;
  if (sec < 60) return `${sec}초`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? `${m}분 ${s}초` : `${m}분`;
}

// AR --------------------------------------------------------------------

/** AR에서 현재 서 있다고 가정하는 노드. */
export function arCurrentNode() {
  if (!hasRoute()) return null;
  return state.route.path[Math.min(state.arLegIndex, state.route.path.length - 1)] || null;
}

/** AR에서 다음에 가야 할 노드. 도착했으면 null. */
export function arNextNode() {
  if (!hasRoute()) return null;
  return state.route.path[state.arLegIndex + 1] || null;
}

/** 남은 구간 수. */
export function arRemainingLegs() {
  return Math.max(0, legCount() - state.arLegIndex);
}

/** 남은 거리(m, 소수 1자리). */
export function arRemainingMeters() {
  const remain = legs()
    .slice(state.arLegIndex)
    .reduce((sum, leg) => sum + leg.dist, 0);
  return Math.round(remain * 10) / 10;
}

/** 목적지에 도착했는지. */
export function arArrived() {
  return hasRoute() && state.arLegIndex >= legCount();
}

// --------------------------------------------------------------------------
// 디버그
// --------------------------------------------------------------------------

/** 시연 중 콘솔에서 상태를 확인할 수 있게 노출한다. */
if (typeof window !== 'undefined') {
  window.__bfState = { getState, setState };
}
