/**
 * screen3.js — 화면 3: AR 안내 (frontend/ar/app.js 통합본)
 *
 * 소유 DOM: #screen3 내부 전부
 *
 * 원본(frontend/ar/app.js)과 달라진 점:
 *   - 페이지 로드 시 바로 카메라를 켜지 않고, 화면3에 들어올 때 켜고 나갈 때 끈다.
 *   - 층·이동 상태·현재 위치를 URL 파라미터 대신 state.js 에서 가져온다.
 *   - 이미지 경로를 index.html 기준(ar/assets/...)으로 바꿨다.
 *   - '← 평면도' 버튼으로 화면2 복귀.
 *
 * 원칙:
 *   - 방향·목적지를 새로 계산하지 않는다. 지도 위 경로 좌표는 층별 시연용 데이터다.
 *   - 카메라·센서·장애물 모델이 실패해도 안내 화면은 유지한다.
 *   - #screen3 의 .active 토글은 이 파일만 한다.
 *
 * 카메라 권한은 메인 화면에서 받는다. 이 화면은 권한을 묻지 않는다.
 * 카메라는 HTTPS 또는 localhost 에서만 동작한다.
 * (안드로이드: USB 연결 → PC 크롬 chrome://inspect → Port forwarding 5000)
 */

import { advanceDistance, largeObstacle } from '../ar-core.js';
import {
  SCREEN,
  getState,
  subscribe,
  goScreen,
  hasRoute,
  currentScenario,
} from '../state.js';

const $ = (s) => document.querySelector(s);
const screenEl = document.getElementById('screen3');

/* ───────── 시연용 데이터 (원본 app.js 그대로) ───────── */

const FLOOR_META = {
  b1: ['지하 1층', 'ar/assets/floor-b1.webp'],
  '1f': ['1층', 'ar/assets/floor-1.webp'],
  '2f': ['2층', 'ar/assets/floor-2.webp'],
  '3f': ['3층', 'ar/assets/floor-3.webp'],
};
const DEFAULT_ROUTES = {
  b1: [
    [45, 65],
    [53, 63],
  ],
  '1f': [
    [45, 58],
    [73, 59],
    [89, 49],
    [92, 41],
  ],
  '2f': [
    [43, 61],
    [43, 66],
    [52, 66],
  ],
  '3f': [
    [38, 66],
    [38, 78],
    [24, 78],
    [20, 50],
    [20.5, 26],
  ],
};
const EXIT_NAMES = {
  b1: '중앙 비상구',
  '1f': '동북쪽 비상구',
  '2f': '중앙 비상구 2',
  '3f': '서북쪽 비상구',
};

// 원본의 걸음 인식 프로파일. 키를 state.js 의 mobility 키와 맞춘다.
const PROFILES = {
  independent: {
    distance: 0.7,
    minDelta: 1.8,
    maxDelta: 7,
    cooldown: 380,
    label: '보행 이동',
  },
  walking_aid: {
    distance: 0.4,
    minDelta: 1.15,
    maxDelta: 6,
    cooldown: 600,
    label: '보행 보조 이동',
  },
  wheelchair: {
    distance: 0.3,
    minDelta: 0.65,
    maxDelta: 4.5,
    cooldown: 520,
    label: '휠체어 이동',
  },
  need_help: {
    distance: 0.25,
    minDelta: 0.9,
    maxDelta: 5,
    cooldown: 750,
    label: '도움 필요 이동',
  },
};

/* ───────── 화면 진입마다 새로 잡는 값 ───────── */

let floor = '3f';
let route = DEFAULT_ROUTES['3f'];
let profile = PROFILES.independent;
let stepDistance = 0.7;
let total = 1;
let remaining = 1;
let targetBearing = 0;
let locationLabel = '—';

/* ───────── 실행 상태 ───────── */

let cameraStream = null;
let torch = false;
let voice = true;
let signal = false;
let signalBeep = null;
let signalVoice = null;
let heading = null;
let lastMagnitude = 0;
let lastStep = 0;
let model = null;
let visionTimer = null;
let busy = false;
let blocked = false;
let rejected = [];
let sensorsBound = false;

/** 화면에 들어올 때 state 기준으로 안내 값을 초기화 */
function loadFromState() {
  const s = getState();
  const start = hasRoute() ? s.route.start : null;

  floor = start ? `${start.floor}f` : '3f';
  if (!FLOOR_META[floor]) floor = '3f';
  route = DEFAULT_ROUTES[floor];

  const key = s.mobility || (s.route && s.route.mobility) || 'independent';
  profile = PROFILES[key] || PROFILES.independent;
  // 계단 사용 가능 경로는 보폭 0.7m, 계단을 사용할 수 없는 경로는 0.3m
  stepDistance = key === 'wheelchair' || key === 'need_help' ? 0.3 : 0.7;

  const v = [route[1][0] - route[0][0], route[1][1] - route[0][1]];
  targetBearing = ((Math.atan2(v[0], -v[1]) * 180) / Math.PI + 360) % 360;
  total = Math.max(
    1,
    Math.round(
      route
        .slice(1)
        .reduce(
          (sum, p, i) =>
            sum + Math.hypot(p[0] - route[i][0], p[1] - route[i][1]),
          0,
        ),
    ),
  );
  remaining = total;
  rejected = [];
  locationLabel = start ? start.name : `${FLOOR_META[floor][0]}`;
}

/* ───────── 렌더링 ───────── */

function pointAt(percent) {
  const lengths = route
    .slice(1)
    .map((p, i) => Math.hypot(p[0] - route[i][0], p[1] - route[i][1]));
  const goal = (lengths.reduce((a, b) => a + b, 0) * percent) / 100;
  let walked = 0;
  for (let i = 0; i < lengths.length; i++) {
    if (walked + lengths[i] >= goal) {
      const t = (goal - walked) / (lengths[i] || 1);
      return [
        route[i][0] + (route[i + 1][0] - route[i][0]) * t,
        route[i][1] + (route[i + 1][1] - route[i][1]) * t,
      ];
    }
    walked += lengths[i];
  }
  return route.at(-1);
}

function render() {
  const pct = Math.max(0, Math.min(100, (1 - remaining / total) * 100));
  const point = pointAt(pct);
  const points = route.map((p) => p.join(',')).join(' ');
  const meta = FLOOR_META[floor];
  const exitName = EXIT_NAMES[floor];

  $('#exitName').textContent = exitName;
  $('#location').textContent = locationLabel;
  $('#distance').textContent = Math.ceil(remaining);
  $('#steps').textContent = Math.ceil(remaining / stepDistance);
  $('#mapImage').src = meta[1];
  $('#mapImage').alt = `${meta[0]} 대피 경로`;
  $('#mapTitle').textContent = `${meta[0]} ${locationLabel} → ${exitName}`;
  $('#routeLine').setAttribute('points', points);
  $('#routeShadow').setAttribute('points', points);
  $('#exitDot').setAttribute('cx', route.at(-1)[0]);
  $('#exitDot').setAttribute('cy', route.at(-1)[1]);
  $('#walker').style.left = `${point[0]}%`;
  $('#walker').style.top = `${point[1]}%`;
  $('#progress').textContent =
    pct >= 100 ? '비상구 도착' : pct > 0 ? '대피 이동 중' : '출발 지점';
  $('#remaining').textContent = `약 ${Math.ceil(remaining)}m 남음`;
  $('#history').textContent = rejected.length
    ? `제외된 경로 ${rejected.length}개`
    : '제외된 경로 없음';
  $('#resetButton').disabled = !rejected.length;
}

function syncFireLocation() {
  const el = $('#fireLocation');
  const scenario = currentScenario();
  el.textContent = `화재 위치 · ${scenario ? scenario.name : '확인 중'}`;
  el.classList.toggle('marquee', el.scrollWidth > el.clientWidth);
}

function speak(text, force = false) {
  if (!voice || !window.speechSynthesis) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ko-KR';
  u.rate = 0.92;
  if (force) speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

/* ───────── 카메라 ───────── */

/**
 * 카메라 권한은 메인 화면에서 미리 받는다.
 * 이 화면에서는 권한을 묻지 않고, 이미 허용된 경우에만 후면 카메라를 바로 켠다.
 *   - 허용됨        → 즉시 후면 카메라 연결
 *   - 아직 안 물어봄 → 권한 창을 띄우지 않고 시뮬레이션 배경으로 안내 계속
 *   - 거부됨        → 동일하게 시뮬레이션 배경으로 안내 계속
 */
async function cameraPermission() {
  try {
    const status = await navigator.permissions.query({ name: 'camera' });
    return status.state; // 'granted' | 'prompt' | 'denied'
  } catch {
    return 'unknown'; // Permissions API 미지원 브라우저
  }
}

/** 후면 카메라 1회 요청. 후면을 강제하고, 없으면 기본 카메라(PC 테스트용). */
async function openRearCamera() {
  const size = { width: { ideal: 1280 }, height: { ideal: 720 } };
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { ...size, facingMode: { exact: 'environment' } },
      audio: false,
    });
  } catch (err) {
    if (err.name === 'NotAllowedError' || err.name === 'SecurityError')
      throw err;
    return navigator.mediaDevices.getUserMedia({
      video: { ...size, facingMode: { ideal: 'environment' } },
      audio: false,
    });
  }
}

async function startCamera() {
  if (cameraStream) return;
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    $('#message').textContent =
      '보안 연결(HTTPS/localhost)이 아니라 시뮬레이션 화면으로 안내합니다.';
    return;
  }

  const permission = await cameraPermission();
  if (permission === 'denied') {
    // 사용자가 거부한 경우에는 다시 묻지 않는다
    $('#message').textContent = '카메라 권한이 거부되어 카메라 없이 안내합니다.';
    return;
  }
  // 'prompt'(아직 허용 전)이면 브라우저가 권한 창을 한 번만 띄운다.
  // 메인 화면에서 미리 허용받으면 여기서는 창이 뜨지 않는다.

  try {
    const stream = await openRearCamera();
    // 카메라를 기다리는 사이 화면을 벗어났으면 바로 끈다
    if (!isActive()) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    cameraStream = stream;
    const video = $('#arCamera');
    video.srcObject = stream;
    video.muted = true;
    video.setAttribute('playsinline', '');
    await video.play().catch(() => {});

    const track = stream.getVideoTracks()[0];
    const hasTorch = !!track.getCapabilities?.().torch;
    $('#torchButton').disabled = !hasTorch;
    $('#message').textContent = hasTorch
      ? '후면 카메라 연결됨 · 손전등 사용 가능'
      : '후면 카메라 연결됨';
    startVision();
  } catch {
    $('#message').textContent =
      '카메라 없이 안내합니다. 화살표 방향으로 이동하세요.';
  }
}

/* ───────── 방향·걸음 센서 ───────── */

/** 안드로이드 크롬은 센서 권한 창이 없으므로 바로 구독한다. (권한 요청 없음) */
function startSensors() {
  if (sensorsBound) return;
  // 안드로이드: deviceorientationabsolute 가 실제 나침(북쪽 기준) 값을 준다.
  // 일반 deviceorientation 은 켤 때 방향이 0 이라 목표 방위와 비교할 수 없다.
  if ('ondeviceorientationabsolute' in window) {
    window.addEventListener('deviceorientationabsolute', onOrientation, true);
  } else {
    window.addEventListener('deviceorientation', onOrientation, true);
  }
  window.addEventListener('devicemotion', onMotion, true);
  sensorsBound = true;
}

function isActive() {
  return getState().screen === SCREEN.AR;
}

/** 화면 방향(세로/가로)에 따른 보정 각도 */
function screenAngle() {
  return (screen.orientation && screen.orientation.angle) || window.orientation || 0;
}

let smoothTurn = null; // 흔들림을 줄인 화살표 회전값(도)

function onOrientation(e) {
  if (!isActive()) return;
  const raw = e.webkitCompassHeading ?? (e.alpha == null ? null : 360 - e.alpha);
  if (raw == null) return;
  heading = (raw + screenAngle() + 360) % 360;

  // 목표 방위와 현재 바라보는 방향의 차이 (-180 ~ 180, 오른쪽이 +)
  const rotation = ((targetBearing - heading + 540) % 360) - 180;

  // 급격한 튐 방지: 이전 값에 조금씩 따라가게 한다 (360↔0 경계 처리 포함)
  if (smoothTurn == null) smoothTurn = rotation;
  const diff = ((rotation - smoothTurn + 540) % 360) - 180;
  smoothTurn = ((smoothTurn + diff * 0.25 + 540) % 360) - 180;

  const mode =
    Math.abs(smoothTurn) < 30
      ? 'forward'
      : smoothTurn >= 30 && smoothTurn < 135
        ? 'right'
        : smoothTurn <= -30 && smoothTurn > -135
          ? 'left'
          : 'back';

  // 화살표: 뒤돌기가 아니면 목표 방향으로 실제 각도만큼 회전
  const arrow = $('#arrow');
  arrow.className = mode === 'back' ? 'arrow back' : 'arrow forward';
  screenEl.style.setProperty('--ar-turn', mode === 'back' ? '0deg' : `${smoothTurn.toFixed(1)}deg`);

  const labels = { right: '오른쪽', left: '왼쪽' };
  const icons = { forward: '⬆', right: '↱', left: '↰', back: '↶' };
  const icon = document.querySelector('#screen3 .direction-icon');
  if (icon) icon.textContent = icons[mode];
  $('#direction').textContent =
    mode === 'forward'
      ? '앞으로 직진하세요'
      : mode === 'back'
        ? '반대편으로 돌아서세요'
        : `${labels[mode]}으로 방향을 맞추세요`;
}

function onMotion(e) {
  if (!isActive()) return;
  const a = e.accelerationIncludingGravity;
  if (!a || remaining <= 0) return;
  const magnitude = Math.hypot(a.x || 0, a.y || 0, a.z || 0);
  const delta = Math.abs(magnitude - lastMagnitude);
  const now = Date.now();
  lastMagnitude = magnitude;
  if (
    delta <= profile.minDelta ||
    delta >= profile.maxDelta ||
    now - lastStep <= profile.cooldown
  )
    return;
  lastStep = now;

  const result = advanceDistance(remaining, {
    currentHeading: heading,
    target: targetBearing,
    step: profile.distance,
  });
  if (result.reason !== 'advanced') {
    $('#message').textContent =
      result.reason === 'wrong-direction'
        ? '화살표 방향으로 돌아서세요.'
        : '방향 센서를 확인하고 있습니다.';
    return;
  }
  remaining = result.distance;
  $('#message').textContent = blocked
    ? '장애물이 감지되었습니다. 통과 여부를 확인하세요.'
    : `${profile.label} · 올바른 방향으로 이동 중`;
  render();
  if (!remaining) {
    $('#direction').textContent = '안전한 비상구에 도착했습니다.';
    speak('안전한 비상구에 도착했습니다. 안내 기능을 계속 유지합니다.', true);
  }
}

/* ───────── 장애물 인식 (coco-ssd, 실패해도 안내 유지) ───────── */

async function startVision() {
  if (visionTimer) return;
  if (!window.cocoSsd) {
    $('#obstacleStatus').textContent = '장애물 모델을 불러오지 못했습니다.';
    return;
  }
  try {
    model = model || (await window.cocoSsd.load({ base: 'lite_mobilenet_v2' }));
    if (!isActive()) return;
    $('#obstacleStatus').textContent = '대형 장애물 자동 인식 중';
    visionTimer = setInterval(detect, 1100);
  } catch {
    $('#obstacleStatus').textContent = '장애물 인식을 시작할 수 없습니다.';
  }
}

async function detect() {
  const video = $('#arCamera');
  if (busy || !model || video.readyState < 2) return;
  busy = true;
  try {
    const items = await model.detect(video, 8, 0.55);
    const hits = items.filter((x) =>
      largeObstacle(x, video.videoWidth, video.videoHeight),
    );
    blocked = hits.length > 0;
    $('#arScreen').classList.toggle('blocked', blocked);
    $('#obstacleStatus').classList.toggle('detected', blocked);
    $('#obstacleStatus').textContent = blocked
      ? `대형 장애물 감지 · ${Math.round(Math.max(...hits.map((x) => x.score)) * 100)}%`
      : '대형 장애물 자동 인식 중';
    drawBoxes(hits);
  } finally {
    busy = false;
  }
}

function drawBoxes(items) {
  const c = $('#obstacleCanvas');
  const v = $('#arCamera');
  const ctx = c.getContext('2d');
  c.width = v.videoWidth || 640;
  c.height = v.videoHeight || 480;
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.strokeStyle = '#ff4d57';
  ctx.lineWidth = 5;
  items.forEach((x) => ctx.strokeRect(...x.bbox));
}

/* ───────── 호출 신호 ───────── */

function rescueBeep() {
  navigator.vibrate?.([250, 120, 250]);
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  const ac = new AC();
  const o = ac.createOscillator();
  const g = ac.createGain();
  const t = ac.currentTime;
  o.frequency.value = 950;
  g.gain.setValueAtTime(0.25, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
  o.connect(g).connect(ac.destination);
  o.start();
  o.stop(t + 0.45);
}

function setSignal(on) {
  signal = on;
  $('#signalButton').classList.toggle('active', signal);
  $('#signalButton').setAttribute('aria-pressed', String(signal));
  $('#arScreen').classList.toggle('signal-active', signal);
  clearInterval(signalBeep);
  clearInterval(signalVoice);
  if (signal) {
    rescueBeep();
    speak('도움이 필요합니다. 사람이 있습니다.', true);
    signalBeep = setInterval(rescueBeep, 1400);
    signalVoice = setInterval(
      () => speak('도움이 필요합니다. 사람이 있습니다.', true),
      6000,
    );
  } else {
    navigator.vibrate?.(0);
  }
}

/* ───────── 화면 진입 / 이탈 ───────── */

function enter() {
  loadFromState();
  $('#arrow').className = 'arrow forward';
  $('#direction').textContent = '앞으로 직진하세요';
  $('#message').textContent = '카메라를 연결하고 있습니다.';
  render();
  syncFireLocation();
  startCamera();
  startSensors();
}

function leave() {
  cameraStream?.getTracks().forEach((t) => t.stop());
  cameraStream = null;
  $('#arCamera').srcObject = null;
  clearInterval(visionTimer);
  visionTimer = null;
  if (signal) setSignal(false);
  window.speechSynthesis?.cancel();
  $('#mapModal').hidden = true;
  $('#mapButton').classList.remove('active');
}

let wasActive = false;
function syncScreen(s) {
  const active = s.screen === SCREEN.AR;
  screenEl.classList.toggle('active', active);
  if (active && !wasActive) enter();
  if (!active && wasActive) leave();
  wasActive = active;
}

/* ───────── 이벤트 ───────── */

$('#arBackButton').addEventListener('click', () => goScreen(SCREEN.PLAN));

$('#mapButton').addEventListener('click', () => {
  $('#mapModal').hidden = false;
  $('#mapButton').classList.add('active');
  render();
});
$('#mapClose').addEventListener('click', () => {
  $('#mapModal').hidden = true;
  $('#mapButton').classList.remove('active');
});
$('#mapModal').addEventListener('click', (e) => {
  if (e.target === $('#mapModal')) $('#mapClose').click();
});

$('#torchButton').addEventListener('click', async () => {
  const track = cameraStream?.getVideoTracks()[0];
  if (!track) return;
  try {
    torch = !torch;
    await track.applyConstraints({ advanced: [{ torch }] });
    $('#torchButton').classList.toggle('active', torch);
  } catch {
    $('#message').textContent = '이 카메라에서는 손전등을 제어할 수 없습니다.';
  }
});

$('#voiceButton').addEventListener('click', () => {
  voice = !voice;
  $('#voiceButton').classList.toggle('active', voice);
  $('#voiceButton').setAttribute('aria-pressed', String(voice));
  if (voice) speak($('#direction').textContent, true);
  else window.speechSynthesis?.cancel();
});

$('#signalButton').addEventListener('click', () => setSignal(!signal));

$('#detourButton').addEventListener('click', () => {
  rejected.push($('#exitName').textContent);
  $('#message').textContent =
    '현재 경로를 제외했습니다. 새 경로 데이터가 필요합니다.';
  render();
});
$('#resetButton').addEventListener('click', () => {
  rejected = [];
  $('#message').textContent = '제외한 경로 기록을 초기화했습니다.';
  render();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && isActive()) $('#mapClose').click();
});
document.addEventListener('visibilitychange', () => {
  if (!isActive()) return;
  if (document.hidden) leave();
  else {
    startCamera();
  }
});
window.addEventListener('pagehide', leave);

subscribe(['screen'], syncScreen);
syncScreen(getState());
