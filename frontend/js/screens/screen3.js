/**
 * screen3.js — 화면 3: AR 안내 (모바일 후면 카메라)
 *
 * 소유 DOM: #screen3 내부 전부
 *
 * 원칙:
 *   - 경로·방향·목적지를 계산하지 않는다. state.js 의 route(백엔드 응답)만 표시한다.
 *   - 카메라는 스마트폰 후면(environment)을 요청한다.
 *   - 카메라가 실패해도 시뮬레이션 배경으로 안내를 계속한다. (흐름이 끊기지 않게)
 *   - 화면을 벗어나거나 앱이 백그라운드로 가면 카메라를 반드시 끈다.
 *   - #screen3 의 .active 토글은 이 파일만 한다.
 *
 * 참고: getUserMedia 는 HTTPS 또는 localhost 에서만 동작한다.
 *   안드로이드 시연은 USB 연결 후 PC 크롬 chrome://inspect → Port forwarding
 *   (5000 → localhost:5000) 으로 폰에서 http://localhost:5000 접속.
 */

import {
  SCREEN,
  getState,
  subscribe,
  goScreen,
  advanceArLeg,
  hasRoute,
  isExitDestination,
  mobilityLabel,
  arCurrentNode,
  arNextNode,
  arRemainingLegs,
  arRemainingMeters,
  arArrived,
} from '../state.js';

/* ───────── DOM ───────── */

const screenEl = document.getElementById('screen3');
const videoEl = document.getElementById('ar-video');
const fallbackBg = document.getElementById('ar-fallback-bg');
const cameraNote = document.getElementById('ar-camera-note');
const chevrons = document.getElementById('ar-chevrons');
const targetBadge = document.getElementById('ar-target-badge');
const nextNameEl = document.getElementById('ar-next-name');
const remainEl = document.getElementById('ar-remain');
const floorEl = document.getElementById('ar-floor');
const legsEl = document.getElementById('ar-legs');
const mobilityEl = document.getElementById('ar-mobility');
const nextBtn = document.getElementById('btn-ar-next');
const backBtn = document.getElementById('btn-ar-back');

/* ───────── 카메라 ───────── */

let stream = null;          // 현재 켜져 있는 카메라 스트림
let pendingRequest = null;  // 진행 중인 getUserMedia 요청 (중복 요청 방지)
let cameraSession = 0;      // stopCamera 때마다 증가. 늦게 도착한 스트림을 판별한다

/** 지금 카메라를 켜 둬야 하는 상황인지 (AR 화면이 앞에 보이는 중) */
function cameraWanted() {
  return getState().screen === SCREEN.AR && !document.hidden;
}

function stopTracks(mediaStream) {
  mediaStream.getTracks().forEach((t) => t.stop());
}

/** 카메라 사용 불가 시 폴백 화면으로 전환 */
function showCameraFallback(message) {
  videoEl.classList.add('hidden');
  fallbackBg.classList.remove('hidden');
  cameraNote.textContent = message;
  cameraNote.classList.remove('hidden');
}

/** 카메라 실패 원인을 사용자에게 보여줄 문구로 바꾼다. */
function cameraErrorMessage(err) {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return '카메라 권한이 거부되어 시뮬레이션 화면으로 안내합니다. 브라우저 설정에서 카메라를 허용하면 다시 켤 수 있습니다.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return '사용할 수 있는 카메라를 찾지 못해 시뮬레이션 화면으로 안내합니다.';
    case 'NotReadableError':
    case 'AbortError':
      return '다른 앱이 카메라를 사용 중이라 시뮬레이션 화면으로 안내합니다.';
    default:
      return '카메라를 사용할 수 없어 시뮬레이션 화면으로 안내합니다.';
  }
}

/** 후면 카메라 요청. 실패하면 조건을 완화해서 한 번 더 시도한다. */
async function requestRearCamera() {
  const base = { width: { ideal: 1280 }, height: { ideal: 720 } };
  try {
    // 1차: 후면 카메라를 강제 (안드로이드 폰에서 전면이 켜지는 것 방지)
    return await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { ...base, facingMode: { exact: 'environment' } },
    });
  } catch (err) {
    // 권한 거부는 재시도해도 소용없으므로 그대로 던진다
    if (err.name === 'NotAllowedError' || err.name === 'SecurityError') throw err;
    // 2차: 후면을 우선하되 없으면 기본 카메라 (PC 개발 테스트용)
    return navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { ...base, facingMode: { ideal: 'environment' } },
    });
  }
}

async function startCamera() {
  if (stream || pendingRequest || !cameraWanted()) return;

  // 안드로이드 크롬은 보안 컨텍스트가 아니면 mediaDevices 자체가 없으므로 이 순서로 검사한다
  if (!window.isSecureContext) {
    showCameraFallback('보안 연결(HTTPS 또는 localhost)이 아니라 카메라를 쓸 수 없어 시뮬레이션 화면으로 안내합니다.');
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    showCameraFallback('이 브라우저는 카메라 기능을 지원하지 않아 시뮬레이션 화면으로 안내합니다.');
    return;
  }

  const session = cameraSession;
  let mediaStream;
  try {
    pendingRequest = requestRearCamera();
    mediaStream = await pendingRequest;
  } catch (err) {
    if (session !== cameraSession) {
      // 요청 도중 화면을 벗어났다. 다시 돌아와 있으면 새로 요청한다
      pendingRequest = null;
      if (cameraWanted()) startCamera();
      return;
    }
    console.error('[screen3] 카메라 시작 실패', err);
    showCameraFallback(cameraErrorMessage(err)); // 안내 흐름(HUD·버튼)은 그대로 동작한다
    return;
  } finally {
    pendingRequest = null;
  }

  // 요청 중에 화면을 벗어났거나 앱이 백그라운드로 갔으면 받은 스트림을 즉시 해제
  if (session !== cameraSession || !cameraWanted()) {
    stopTracks(mediaStream);
    if (cameraWanted()) startCamera(); // 벗어났다가 다시 들어온 경우 새로 요청
    return;
  }

  stream = mediaStream;
  videoEl.muted = true;
  videoEl.setAttribute('muted', '');
  videoEl.setAttribute('playsinline', '');
  videoEl.srcObject = stream;
  try {
    await videoEl.play();
  } catch (err) {
    // 자동재생 정책 등으로 거부돼도 멈추지 않는다 (autoplay 속성으로 다시 재생된다)
    console.warn('[screen3] 카메라 영상 재생 시작 실패', err);
  }
  if (stream !== mediaStream) return; // 재생을 기다리는 사이 카메라가 꺼졌다

  videoEl.classList.remove('hidden');
  fallbackBg.classList.add('hidden');
  cameraNote.classList.add('hidden');
}

function stopCamera() {
  cameraSession += 1; // 진행 중인 요청이 있으면 그 스트림은 도착하는 즉시 해제된다
  if (stream) {
    stopTracks(stream);
    stream = null;
  }
  videoEl.pause();
  videoEl.srcObject = null;
  videoEl.classList.add('hidden');
  fallbackBg.classList.remove('hidden');
}

/* ───────── 화면 동기화 ───────── */

function syncScreen(s) {
  const active = s.screen === SCREEN.AR;
  screenEl.classList.toggle('active', active);
  if (active) {
    startCamera();
    syncHud();
  } else {
    stopCamera();
  }
}

// 추후 확장: DeviceOrientation(나침반)으로 #ar-chevrons 를 회전시키는 기능은 이번 범위가 아니다.
//   붙일 때도 방향을 JS 에서 추정하지 말고 백엔드 route 값을 기준으로 할 것.
function syncHud() {
  mobilityEl.textContent = mobilityLabel();

  if (!hasRoute()) {
    // 경로 없음: AR 대신 구조 대기 안내 (평면도로 돌아가 폴백 안내 확인)
    nextNameEl.textContent = '방화문 안쪽에서 구조 대기';
    targetBadge.textContent = '119 신고';
    remainEl.textContent = '0';
    floorEl.textContent = '—';
    legsEl.textContent = '—';
    nextBtn.disabled = true;
    nextBtn.textContent = '안내할 경로가 없습니다';
    chevrons.classList.add('opacity-0');
    return;
  }

  const current = arCurrentNode();
  const next = arNextNode();
  floorEl.textContent = current ? `${current.floor}층` : '—';
  remainEl.textContent = String(arRemainingMeters());
  legsEl.textContent = `${arRemainingLegs()}구간`;

  if (arArrived()) {
    // 도착하면 현재 노드는 경로의 마지막 노드, 즉 백엔드가 준 목적지다
    nextNameEl.textContent = current ? current.name : '목적지';
    targetBadge.textContent = isExitDestination() ? '집결지로 이동' : '이곳에서 구조 대기';
    nextBtn.disabled = true;
    nextBtn.textContent = isExitDestination()
      ? '도착했습니다. 집결지로 이동하세요'
      : '도착했습니다. 이곳에서 구조를 기다리세요';
    chevrons.classList.add('opacity-0');
  } else {
    nextNameEl.textContent = next ? next.name : '—';
    targetBadge.textContent = next && next.floor !== current?.floor
      ? `${next.floor}층으로 이동`
      : '직진';
    nextBtn.disabled = false;
    nextBtn.textContent = '이 지점 도착';
    chevrons.classList.remove('opacity-0');
  }
}

/* ───────── 이벤트 ───────── */

nextBtn.addEventListener('click', () => {
  advanceArLeg();
  if (navigator.vibrate) navigator.vibrate(60); // 안드로이드 진동 피드백
});
backBtn.addEventListener('click', () => goScreen(SCREEN.PLAN));

// 앱이 백그라운드로 가면 카메라 해제, 돌아오면 재시작
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopCamera(); // 요청 중인 스트림도 도착하는 즉시 해제된다
  else if (getState().screen === SCREEN.AR) startCamera();
});
window.addEventListener('pagehide', stopCamera);
// 뒤로가기 캐시(bfcache)에서 복원되면 pagehide 로 꺼진 카메라를 다시 켠다
window.addEventListener('pageshow', (event) => {
  if (event.persisted && getState().screen === SCREEN.AR) startCamera();
});

subscribe(['screen'], syncScreen);
subscribe(['route', 'arLegIndex', 'mobility', 'profiles'], (s) => {
  if (s.screen === SCREEN.AR) syncHud();
});

// 초기 동기화
syncScreen(getState());
