/**
 * screen1.js — 화면 1: 이동 상태 선택
 *
 * 역할: 이동 상태 카드 렌더링과 입력 처리, 상단 화재 경보 문구.
 *   - 상태는 state.js 의 action 으로만 바꾸고, 표시는 구독(subscribe)으로 동기화한다.
 *   - #screen1 의 .active 토글은 이 파일만 한다. 다른 화면 섹션은 건드리지 않는다.
 *   - 경로 계산은 화면 1의 책임이 아니다. api.postRoute 를 호출하지 않는다.
 *   - 개인정보를 받지 않고, 선택을 브라우저에 저장하지 않는다.
 */

import * as api from '../api.js';
import {
  SCREEN,
  getState,
  subscribe,
  goScreen,
  selectMobility,
  setProfiles,
  setScenarios,
  setBuilding,
  currentScenario,
} from '../state.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

const screenEl = document.getElementById('screen1');
const gridEl = document.getElementById('mobility-grid');
const confirmBtn = document.getElementById('btn-confirm-mobility');
const alertEl = document.getElementById('alert-text');

const ALERT_FAILED = '화재 정보를 불러올 수 없습니다.';

// 선택 전에 "상태에 따라 목적지가 달라진다"는 차별점을 보여주는 문구
const DESTINATION_HINT = {
  exit: '1층 비상구로 안내',
  refuge: '같은 층 대피공간으로 안내',
};

// 고정 아이콘 (서버 값이 아닌 상수 문자열). stroke + currentColor, 머리는 채움(fill).
// 굵은 픽토그램 형태라 선 굵기를 요소마다 따로 지정한다.
const ICON_PATHS = {
  // 걷는 사람
  independent:
    '<circle cx="12.3" cy="4.2" r="1.9" fill="currentColor" stroke="none"/><path d="M12.4 8v5.6" stroke-width="3.4"/><path d="M11 8.2L8.4 10.2 7.2 13M13.7 8.3l.9 2.6 2.7 1.8M12.2 13.6l4.3 6.7 1.8-.6M10.8 15.6l-4.4 5 1.8.7" stroke-width="2.4"/>',
  // 지팡이를 짚은 사람
  walking_aid:
    '<circle cx="12.4" cy="4.5" r="1.8" fill="currentColor" stroke="none"/><path d="M12.4 8.3v5.3" stroke-width="4.4"/><path d="M11.3 13.5v7.1M13.5 13.5v7.1" stroke-width="1.9"/><path d="M10.2 8.2L9.3 12.4M14.7 8.2l.6 5" stroke-width="1.8"/><path d="M8 12.6h1.5M8.9 13l-1.6 8.1" stroke-width="1"/>',
  // 휠체어
  wheelchair:
    '<circle cx="10.2" cy="5" r="2" fill="currentColor" stroke="none"/><path d="M10 8.8v5.2" stroke-width="3.2"/><path d="M10.2 14.3h5l2.6 5.2 2.1-1.1" stroke-width="2.6"/><path d="M11 11.4h4.4" stroke-width="1.6"/><path d="M7.8 11.9A5 5 0 1 0 15.2 17.8" stroke-width="1.3"/>',
  // 들어 올린 손 (도움 요청)
  need_help:
    '<path d="M8 12.5V6a1.5 1.5 0 013 0v5"/><path d="M11 10.5V4.5a1.5 1.5 0 013 0v6"/><path d="M14 10.5V6a1.5 1.5 0 013 0v7"/><path d="M8 11a1.5 1.5 0 00-3 0v3.5A6.5 6.5 0 0011.5 21h1a4.5 4.5 0 004.5-4.5V13"/><path d="M3.5 5.5L2 4M4 2.5L3.5 1"/>',
  // 알 수 없는 key 용 기본 아이콘
  fallback:
    '<circle cx="12" cy="6" r="2.5"/><path d="M7 21v-6a5 5 0 0110 0v6"/>',
};

const CHECK_PATH = '<path d="M5 13l4 4L19 7"/>';

const CARD_CLASS =
  'mobility-card rounded-2xl p-4 flex flex-col justify-between items-start text-left min-h-[145px] ' +
  'border active:scale-[.98] transition-all relative cursor-pointer select-none ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-neon';
const CARD_OFF = ['glass-card', 'border-slate-700/60'];
const CARD_ON = ['glass-card-active', 'border-2', 'border-brand-neon'];

const ICON_WRAP_OFF =
  'icon-wrap w-14 h-14 rounded-xl bg-slate-800/80 border border-slate-700 flex items-center justify-center text-slate-300';
const ICON_WRAP_ON =
  'icon-wrap w-14 h-14 rounded-xl bg-emerald-500/20 border border-brand-neon/40 flex items-center justify-center text-brand-neon';

/* ───────── DOM 생성 도우미 ───────── */

function createIcon(paths, className, strokeWidth) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', strokeWidth);
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = paths; // 위의 고정 상수만 넣는다
  return svg;
}

function createCard(profile) {
  const card = document.createElement('div');
  card.className = `${CARD_CLASS} ${CARD_OFF.join(' ')}`;
  card.setAttribute('role', 'radio');
  card.setAttribute('aria-checked', 'false');
  card.setAttribute('tabindex', '-1');
  card.dataset.key = profile.key;

  const top = document.createElement('div');
  top.className = 'w-full flex items-center justify-between mb-2';

  const iconWrap = document.createElement('div');
  iconWrap.className = ICON_WRAP_OFF;
  iconWrap.append(
    createIcon(ICON_PATHS[profile.key] || ICON_PATHS.fallback, 'w-6 h-6', '2'),
  );

  const check = document.createElement('div');
  check.className =
    'check-icon hidden w-5 h-5 rounded-full bg-brand-neon text-slate-950 items-center justify-center';
  check.append(createIcon(CHECK_PATH, 'w-3 h-3', '3'));

  top.append(iconWrap, check);

  const body = document.createElement('div');
  const title = document.createElement('h2');
  title.className = 'text-sm font-bold text-slate-100';
  title.textContent = profile.label || profile.key;
  const hint = document.createElement('p');
  hint.className = 'text-[11px] text-slate-400 mt-1 leading-snug';
  hint.textContent =
    DESTINATION_HINT[profile.destination_type] || '안내 목적지 정보 없음';
  body.append(title, hint);

  card.append(top, body);
  return card;
}

/** 카드 자리에 한 줄 안내(불러오는 중/실패)를 그린다. withRetry 면 '다시 시도' 버튼을 붙인다. */
function renderGridMessage(message, { withRetry = false } = {}) {
  const box = document.createElement('div');
  box.className =
    'col-span-2 flex flex-col items-center justify-center gap-3 py-8 px-4 rounded-2xl border border-slate-700/60 glass-card text-center';

  const text = document.createElement('p');
  text.className = 'text-xs text-slate-300';
  text.setAttribute('role', withRetry ? 'alert' : 'status');
  text.textContent = message;
  box.append(text);

  if (withRetry) {
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.dataset.action = 'retry-mobility';
    retry.className =
      'px-4 py-2 rounded-xl bg-brand-neon text-slate-950 text-xs font-black active:scale-[.98] transition-all';
    retry.textContent = '다시 시도';
    box.append(retry);
  }

  gridEl.replaceChildren(box);
}

function renderCards(profiles) {
  gridEl.replaceChildren(...profiles.map(createCard));
  // 다시 그린 카드에도 현재 선택을 반영한다 (화면 2에서 되돌아온 경우 등)
  syncSelection(getState());
}

/** 강조 마크업([화재 경보])은 유지하고 그 뒤의 문구만 textContent 로 교체한다. */
function setAlertMessage(message) {
  const strong = alertEl.querySelector('strong');
  if (!strong) {
    alertEl.textContent = `[화재 경보] ${message}`;
  } else {
    [...alertEl.childNodes].forEach((node) => {
      if (node !== strong) node.remove();
    });
    alertEl.append(document.createTextNode(message));
  }
  alertEl.setAttribute('title', message); // 한 줄로 잘릴 때 전체 문구 확인용
}

/* ───────── 구독: 상태 → 화면 동기화 ───────── */

function syncScreen(s) {
  screenEl.classList.toggle('active', s.screen === SCREEN.MOBILITY);
}

function syncSelection(s) {
  const cards = [...gridEl.querySelectorAll('[role="radio"][data-key]')];
  const selectedKey = s.mobility;

  for (const card of cards) {
    const on = card.dataset.key === selectedKey;
    card.setAttribute('aria-checked', String(on));
    card.classList.remove(...(on ? CARD_OFF : CARD_ON));
    card.classList.add(...(on ? CARD_ON : CARD_OFF));

    const check = card.querySelector('.check-icon');
    check.classList.toggle('hidden', !on);
    check.classList.toggle('flex', on);
    card.querySelector('.icon-wrap').className = on
      ? ICON_WRAP_ON
      : ICON_WRAP_OFF;
  }

  // 로빙 tabindex: 선택된 카드(없으면 첫 카드)만 Tab 순서에 들어간다
  const focusable =
    cards.find((card) => card.dataset.key === selectedKey) || cards[0];
  cards.forEach((card) =>
    card.setAttribute('tabindex', card === focusable ? '0' : '-1'),
  );

  confirmBtn.disabled = !selectedKey;
}

function syncAlert(s) {
  const scenario = currentScenario();
  if (!scenario) {
    console.error(
      `[screen1] 시나리오 '${s.scenarioKey}' 를 응답에서 찾을 수 없습니다.`,
    );
    setAlertMessage(ALERT_FAILED);
    return;
  }
  setAlertMessage(
    scenario.origin ? `${scenario.name} — ${scenario.origin}` : scenario.name,
  );
}

subscribe(['screen'], syncScreen);
subscribe(['mobility'], syncSelection);
subscribe(['scenarios', 'scenarioKey'], syncAlert);

/* ───────── 입력 처리 (이벤트 위임 1회) ───────── */

gridEl.addEventListener('click', (event) => {
  if (event.target.closest('[data-action="retry-mobility"]')) {
    loadProfiles();
    return;
  }
  const card = event.target.closest('[role="radio"][data-key]');
  if (card) selectMobility(card.dataset.key);
});

gridEl.addEventListener('keydown', (event) => {
  const card = event.target.closest('[role="radio"][data-key]');
  if (!card) return;

  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    selectMobility(card.dataset.key);
    return;
  }

  // 라디오 그룹 관례: 방향키로 이동하면서 선택
  const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[
    event.key
  ];
  if (!step) return;
  event.preventDefault();
  const cards = [...gridEl.querySelectorAll('[role="radio"][data-key]')];
  const next =
    cards[(cards.indexOf(card) + step + cards.length) % cards.length];
  selectMobility(next.dataset.key);
  next.focus();
});

confirmBtn.addEventListener('click', () => {
  if (!getState().mobility) return;
  goScreen(SCREEN.PLAN);
});

/* ───────── 초기 데이터 ───────── */

async function loadProfiles() {
  renderGridMessage('이동 상태를 불러오는 중…');
  try {
    const profiles = await api.getMobility();
    if (!Array.isArray(profiles) || profiles.length === 0) {
      throw new Error('이동 상태 목록이 비어 있습니다.');
    }
    setProfiles(profiles);
    renderCards(profiles);
  } catch (err) {
    console.error('[screen1] 이동 상태 목록을 불러오지 못했습니다.', err);
    renderGridMessage('이동 상태 목록을 불러오지 못했습니다.', {
      withRetry: true,
    });
  }
}

async function loadScenarios() {
  try {
    setScenarios(await api.getScenarios());
  } catch (err) {
    console.error('[screen1] 시나리오를 불러오지 못했습니다.', err);
    setAlertMessage(ALERT_FAILED);
  }
}

async function loadBuilding() {
  // 화면 2 진입 시 로딩을 없애기 위한 선행 fetch. 실패하면 화면 2가 처리한다.
  try {
    setBuilding(await api.getBuilding());
  } catch (err) {
    console.error('[screen1] 평면도 데이터를 미리 받지 못했습니다.', err);
  }
}

// 각 호출은 도착하는 대로 그리고, 하나가 실패해도 나머지는 계속된다
Promise.allSettled([loadProfiles(), loadScenarios(), loadBuilding()]);
