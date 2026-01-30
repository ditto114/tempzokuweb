const DEFAULT_TIMER_DURATION_MS = 15 * 60 * 1000;
const MIN_TIMER_DURATION_MS = 5 * 1000;
const MAX_TIMER_DURATION_MS = 3 * 60 * 60 * 1000;

const CHANNEL_STORAGE_KEY = 'timer_channels';
const KNOWN_CHANNEL_NAMES = Object.freeze({
  ca01: 'CASS 텔공대',
});

const timerListElement = document.getElementById('timer-list');
const statusElement = document.getElementById('timer-stream-status');
const addTimerButton = document.getElementById('add-timer-button');
const toggleEditButton = document.getElementById('toggle-edit-mode');
const gridSettingsPanel = document.getElementById('timer-grid-settings');
const gridColumnsInput = document.getElementById('timer-grid-columns');
const gridRowsInput = document.getElementById('timer-grid-rows');
const shortcutButton = document.getElementById('timer-shortcut-button');
const toggleViewModeButton = document.getElementById('toggle-view-mode');
const urlParams = new URLSearchParams(window.location.search);
const channelCode = (urlParams.get('channelCode') || '').trim();
const channelLabelElement = document.getElementById('channel-code-label');

function loadStoredChannels() {
  try {
    const raw = localStorage.getItem(CHANNEL_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((item) => ({
        code: typeof item.code === 'string' ? item.code.trim() : '',
        name: typeof item.name === 'string' ? item.name.trim() : '',
      }))
      .filter((item) => item.code);
  } catch (error) {
    return [];
  }
}

function resolveChannelName(code) {
  if (!code) {
    return '';
  }
  const normalized = code.trim().toLowerCase();
  const stored = loadStoredChannels().find((item) => item.code.toLowerCase() === normalized);
  if (stored?.name) {
    return stored.name;
  }
  return KNOWN_CHANNEL_NAMES[normalized] || '';
}

const channelName = resolveChannelName(channelCode);

const timers = new Map();
const timerDisplays = new Map();
const timerProgressBars = new Map();

const SHORTCUT_COOKIE_NAME = 'timer_shortcuts';
const SHORTCUT_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
const VIEW_MODE_COOKIE_NAME = 'timer_view_positions';
const VIEW_MODE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
const VIEW_MODE_GRID_SIZE = 10;
const BLOCKED_SHORTCUT_KEYS = new Set([
  'Shift',
  'Control',
  'Alt',
  'Meta',
  'Escape',
  'Backspace',
  'Delete',
  'Tab',
  'CapsLock',
  'NumLock',
  'ScrollLock',
]);

const shortcutAssignments = new Map();
const shortcutKeyToTimer = new Map();
const viewModePositions = new Map();

let eventSource = null;
let isEditMode = false;
let isShortcutMode = false;
let isViewMode = false;
let draggedTimerId = null;
let slotLayout = [];
const DEFAULT_GRID_SETTINGS = Object.freeze({ columns: 3, rows: 2 });
let gridSettings = { ...DEFAULT_GRID_SETTINGS };
let serverClockOffsetMs = 0;
let hasServerClockOffset = false;
let pendingShortcutTimerId = null;
let shortcutModalElements = null;
let shortcutModalKeyListener = null;
let viewModeDragState = null;
let sseReconnectTimeout = null;
let sseReconnectDelay = 1000;

function clampTimerDuration(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return DEFAULT_TIMER_DURATION_MS;
  }
  return Math.min(Math.max(value, MIN_TIMER_DURATION_MS), MAX_TIMER_DURATION_MS);
}

function buildChannelUrl(path) {
  if (!channelCode) {
    throw new Error('채널 코드가 설정되지 않았습니다.');
  }
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}channelCode=${encodeURIComponent(channelCode)}`;
}

function updateChannelLabel() {
  if (!channelLabelElement) {
    return;
  }
  if (!channelCode) {
    channelLabelElement.textContent = '채널 정보 확인 후 이용해주세요.';
    return;
  }
  if (channelName) {
    channelLabelElement.textContent = `채널: ${channelName}`;
    return;
  }
  channelLabelElement.textContent = '채널에 접속 중입니다.';
}

function normalizeShortcutValue(value) {
  if (typeof value !== 'string') {
    return null;
  }
  if (BLOCKED_SHORTCUT_KEYS.has(value)) {
    return null;
  }
  if (value === ' ') {
    return 'Space';
  }
  if (value.length === 1) {
    return value.toUpperCase();
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || BLOCKED_SHORTCUT_KEYS.has(trimmed)) {
    return null;
  }
  return trimmed;
}

function getTimerShortcut(timerId) {
  const id = Number(timerId);
  if (!Number.isInteger(id)) {
    return null;
  }
  return shortcutAssignments.get(id) ?? null;
}

function formatActionLabel(baseText, timerId) {
  const shortcut = getTimerShortcut(timerId);
  if (!shortcut) {
    return baseText;
  }
  return `${baseText} (${shortcut})`;
}

function persistShortcutAssignments() {
  try {
    const payload = {};
    shortcutAssignments.forEach((value, id) => {
      payload[id] = value;
    });
    const encoded = encodeURIComponent(JSON.stringify(payload));
    document.cookie = `${SHORTCUT_COOKIE_NAME}=${encoded};path=/;max-age=${SHORTCUT_COOKIE_MAX_AGE};samesite=lax`;
  } catch (error) {
    console.error('Failed to persist timer shortcuts:', error);
  }
}

function loadShortcutAssignments() {
  shortcutAssignments.clear();
  shortcutKeyToTimer.clear();
  const cookieString = document.cookie || '';
  const prefix = `${SHORTCUT_COOKIE_NAME}=`;
  const parts = cookieString.split(';');
  let storedValue = null;
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      storedValue = trimmed.slice(prefix.length);
      break;
    }
  }
  if (!storedValue) {
    return;
  }
  try {
    const decoded = decodeURIComponent(storedValue);
    const parsed = JSON.parse(decoded);
    let needsPersist = false;
    if (parsed && typeof parsed === 'object') {
      Object.entries(parsed).forEach(([idKey, keyValue]) => {
        const id = Number(idKey);
        if (!Number.isInteger(id) || typeof keyValue !== 'string') {
          needsPersist = true;
          return;
        }
        const normalized = normalizeShortcutValue(keyValue);
        if (!normalized) {
          needsPersist = true;
          return;
        }
        if (shortcutKeyToTimer.has(normalized)) {
          needsPersist = true;
          return;
        }
        shortcutAssignments.set(id, normalized);
        shortcutKeyToTimer.set(normalized, id);
      });
    }
    if (needsPersist) {
      persistShortcutAssignments();
    }
  } catch (error) {
    console.error('Failed to load timer shortcuts:', error);
    shortcutAssignments.clear();
    shortcutKeyToTimer.clear();
    persistShortcutAssignments();
  }
}

function snapToViewGrid(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.round(value / VIEW_MODE_GRID_SIZE) * VIEW_MODE_GRID_SIZE;
}

function snapViewPosition(position) {
  if (!position || typeof position !== 'object') {
    return { x: 0, y: 0 };
  }
  return {
    x: snapToViewGrid(Number(position.x)),
    y: snapToViewGrid(Number(position.y)),
  };
}

function normalizeViewModePosition(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const xValue = raw.x ?? raw.left ?? (Array.isArray(raw) ? raw[0] : undefined);
  const yValue = raw.y ?? raw.top ?? (Array.isArray(raw) ? raw[1] : undefined);
  const x = Number(xValue);
  const y = Number(yValue);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  return { x, y };
}

function persistViewModePositions() {
  try {
    if (viewModePositions.size === 0) {
      document.cookie = `${VIEW_MODE_COOKIE_NAME}=;path=/;max-age=0;samesite=lax`;
      return;
    }
    const payload = {};
    viewModePositions.forEach((value, id) => {
      const normalized = normalizeViewModePosition(value);
      if (!normalized) {
        return;
      }
      payload[id] = { x: normalized.x, y: normalized.y };
    });
    const encoded = encodeURIComponent(JSON.stringify(payload));
    document.cookie = `${VIEW_MODE_COOKIE_NAME}=${encoded};path=/;max-age=${VIEW_MODE_COOKIE_MAX_AGE};samesite=lax`;
  } catch (error) {
    console.error('Failed to persist timer view positions:', error);
  }
}

function loadViewModePositions() {
  viewModePositions.clear();
  const cookieString = document.cookie || '';
  const prefix = `${VIEW_MODE_COOKIE_NAME}=`;
  const parts = cookieString.split(';');
  let storedValue = null;
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      storedValue = trimmed.slice(prefix.length);
      break;
    }
  }
  if (!storedValue) {
    return;
  }
  try {
    const decoded = decodeURIComponent(storedValue);
    const parsed = JSON.parse(decoded);
    let needsPersist = false;
    if (parsed && typeof parsed === 'object') {
      Object.entries(parsed).forEach(([idKey, value]) => {
        const id = Number(idKey);
        const normalized = normalizeViewModePosition(value);
        if (!Number.isInteger(id) || !normalized) {
          needsPersist = true;
          return;
        }
        viewModePositions.set(id, normalized);
      });
    }
    if (needsPersist) {
      persistViewModePositions();
    }
  } catch (error) {
    console.error('Failed to load timer view positions:', error);
    viewModePositions.clear();
    persistViewModePositions();
  }
}

function getViewModePosition(timerId) {
  const id = Number(timerId);
  if (!Number.isInteger(id)) {
    return null;
  }
  return viewModePositions.get(id) ?? null;
}

function setViewModePosition(timerId, position, { persist = true } = {}) {
  const id = Number(timerId);
  if (!Number.isInteger(id)) {
    return false;
  }
  const normalized = normalizeViewModePosition(position);
  if (!normalized) {
    return false;
  }
  const snapped = snapViewPosition(normalized);
  viewModePositions.set(id, snapped);
  if (persist) {
    persistViewModePositions();
  }
  return true;
}

function removeViewModePosition(timerId, { persist = true } = {}) {
  const id = Number(timerId);
  if (!Number.isInteger(id)) {
    return false;
  }
  const hasItem = viewModePositions.delete(id);
  if (hasItem && persist) {
    persistViewModePositions();
  }
  return hasItem;
}

function pruneViewModePositions() {
  let hasChanges = false;
  viewModePositions.forEach((_, id) => {
    if (!timers.has(id)) {
      viewModePositions.delete(id);
      hasChanges = true;
    }
  });
  if (hasChanges) {
    persistViewModePositions();
  }
}

function removeTimerShortcut(timerId, { persist = true } = {}) {
  const id = Number(timerId);
  if (!Number.isInteger(id)) {
    return false;
  }
  const existingKey = shortcutAssignments.get(id);
  if (!existingKey) {
    return false;
  }
  shortcutAssignments.delete(id);
  if (shortcutKeyToTimer.get(existingKey) === id) {
    shortcutKeyToTimer.delete(existingKey);
  }
  if (persist) {
    persistShortcutAssignments();
  }
  return true;
}

function setTimerShortcut(timerId, rawKey) {
  const id = Number(timerId);
  if (!Number.isInteger(id)) {
    return;
  }
  const normalized = normalizeShortcutValue(rawKey);
  if (!normalized) {
    return;
  }
  const currentKey = shortcutAssignments.get(id);
  if (currentKey === normalized) {
    return;
  }
  const previousOwner = shortcutKeyToTimer.get(normalized);
  if (Number.isInteger(previousOwner) && previousOwner !== id) {
    removeTimerShortcut(previousOwner, { persist: false });
  }
  if (currentKey && currentKey !== normalized) {
    shortcutKeyToTimer.delete(currentKey);
  }
  shortcutAssignments.set(id, normalized);
  shortcutKeyToTimer.set(normalized, id);
  persistShortcutAssignments();
  renderTimers();
}

function clearTimerShortcut(timerId) {
  const removed = removeTimerShortcut(timerId, { persist: false });
  if (removed) {
    persistShortcutAssignments();
    renderTimers();
  }
}

function pruneShortcutAssignments() {
  let changed = false;
  shortcutAssignments.forEach((_, id) => {
    if (!timers.has(id)) {
      if (removeTimerShortcut(id, { persist: false })) {
        changed = true;
      }
    }
  });
  if (changed) {
    persistShortcutAssignments();
  }
}

function updateShortcutButtonState() {
  if (!shortcutButton) {
    return;
  }
  shortcutButton.classList.toggle('timer-shortcut-button-active', isShortcutMode);
  shortcutButton.setAttribute('aria-pressed', String(isShortcutMode));
  shortcutButton.textContent = isShortcutMode ? '단축키 설정 완료' : '단축키';
}

function getEffectiveNow(now = Date.now()) {
  if (!hasServerClockOffset) {
    return now;
  }
  return now + serverClockOffsetMs;
}

function updateServerClockOffsetFromTimers(payload, receiveTime = Date.now()) {
  const collection = Array.isArray(payload) ? payload : [payload];
  const timestamps = [];
  collection.forEach((item) => {
    if (!item) {
      return;
    }
    const numeric = Number(item.updatedAt);
    if (Number.isFinite(numeric)) {
      timestamps.push(numeric);
    }
  });
  if (timestamps.length === 0) {
    return;
  }
  const total = timestamps.reduce((sum, value) => sum + value, 0);
  const average = total / timestamps.length;
  const nextOffset = average - receiveTime;
  if (!hasServerClockOffset) {
    serverClockOffsetMs = nextOffset;
    hasServerClockOffset = true;
    return;
  }
  const SMOOTHING_FACTOR = 0.2;
  serverClockOffsetMs += (nextOffset - serverClockOffsetMs) * SMOOTHING_FACTOR;
}

function formatTimerDisplay(ms) {
  const safeMs = Math.max(0, Math.floor(ms));
  const totalSeconds = Math.floor(safeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function updateStatus(message, isError = false) {
  if (!statusElement) {
    return;
  }
  statusElement.textContent = message;
  if (isError) {
    statusElement.classList.add('error');
  } else {
    statusElement.classList.remove('error');
  }
}

function ensureShortcutModalElements() {
  if (shortcutModalElements) {
    return shortcutModalElements;
  }
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop hidden';
  const modal = document.createElement('div');
  modal.className = 'modal hidden';
  const content = document.createElement('div');
  content.className = 'modal-content';

  const message = document.createElement('p');
  message.className = 'shortcut-modal-message';
  message.textContent = '키를 입력하세요';

  const hint = document.createElement('p');
  hint.className = 'shortcut-modal-hint';
  hint.textContent = '원하는 키를 눌러주세요. Esc로 취소, Backspace로 해제.';

  content.appendChild(message);
  content.appendChild(hint);
  modal.appendChild(content);
  document.body.appendChild(backdrop);
  document.body.appendChild(modal);

  backdrop.addEventListener('click', () => {
    closeShortcutModal();
  });

  shortcutModalElements = { backdrop, modal, message, hint };
  return shortcutModalElements;
}

function closeShortcutModal() {
  if (shortcutModalKeyListener) {
    window.removeEventListener('keydown', shortcutModalKeyListener, true);
    shortcutModalKeyListener = null;
  }
  if (!shortcutModalElements) {
    pendingShortcutTimerId = null;
    return;
  }
  const { backdrop, modal } = shortcutModalElements;
  backdrop.classList.add('hidden');
  modal.classList.add('hidden');
  pendingShortcutTimerId = null;
}

function openShortcutModal(timerId) {
  const id = Number(timerId);
  if (!Number.isInteger(id)) {
    return;
  }
  const elements = ensureShortcutModalElements();
  const timer = timers.get(id);
  if (elements.message) {
    elements.message.textContent = timer
      ? `${timer.name} 타이머의 단축키를 입력하세요`
      : '키를 입력하세요';
  }
  if (elements.hint) {
    elements.hint.textContent = '원하는 키를 눌러주세요. Esc로 취소, Backspace로 해제.';
  }
  elements.backdrop.classList.remove('hidden');
  elements.modal.classList.remove('hidden');
  pendingShortcutTimerId = id;

  if (shortcutModalKeyListener) {
    window.removeEventListener('keydown', shortcutModalKeyListener, true);
  }

  shortcutModalKeyListener = (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      closeShortcutModal();
      return;
    }
    if (!Number.isInteger(pendingShortcutTimerId)) {
      return;
    }
    if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault();
      const targetId = pendingShortcutTimerId;
      closeShortcutModal();
      clearTimerShortcut(targetId);
      return;
    }
    const normalized = normalizeShortcutValue(event.key);
    if (!normalized) {
      return;
    }
    event.preventDefault();
    const targetId = pendingShortcutTimerId;
    closeShortcutModal();
    setTimerShortcut(targetId, normalized);
  };

  window.addEventListener('keydown', shortcutModalKeyListener, true);
}

function enterShortcutMode() {
  if (isShortcutMode) {
    return;
  }
  isShortcutMode = true;
  pendingShortcutTimerId = null;
  updateShortcutButtonState();
  renderTimers();
}

function exitShortcutMode({ shouldRender = true } = {}) {
  if (!isShortcutMode) {
    closeShortcutModal();
    return;
  }
  isShortcutMode = false;
  closeShortcutModal();
  updateShortcutButtonState();
  if (shouldRender) {
    renderTimers();
  }
}

function toggleShortcutMode() {
  if (!isShortcutMode && isEditMode) {
    toggleEditMode();
  }
  if (isShortcutMode) {
    exitShortcutMode();
  } else {
    enterShortcutMode();
  }
}

function handleGlobalShortcutKeydown(event) {
  if (isShortcutMode || pendingShortcutTimerId != null) {
    return;
  }
  if (event.metaKey || event.ctrlKey || event.altKey) {
    return;
  }
  const target = event.target;
  if (target instanceof HTMLElement) {
    const interactive = target.closest('input, textarea, select, [contenteditable="true"], button');
    if (interactive && !(interactive instanceof HTMLButtonElement)) {
      return;
    }
  }
  const normalized = normalizeShortcutValue(event.key);
  if (!normalized) {
    return;
  }
  const timerId = shortcutKeyToTimer.get(normalized);
  if (!Number.isInteger(timerId)) {
    return;
  }
  const timer = timers.get(timerId);
  if (!timer) {
    return;
  }
  event.preventDefault();
  if (timer.isRunning) {
    resetTimer(timerId);
  } else {
    startTimer(timerId);
  }
}

function getTimerRemaining(timer, now = Date.now()) {
  if (!timer) {
    return 0;
  }
  if (timer.isRunning && typeof timer.endTime === 'number') {
    const effectiveNow = getEffectiveNow(now);
    return Math.max(0, timer.endTime - effectiveNow);
  }
  return Math.max(0, timer.remainingMs);
}

function normalizeTimer(raw) {
  const duration = clampTimerDuration(Number(raw.duration));
  const remaining = Math.max(0, Number(raw.remaining));
  const endTime = raw.endTime != null ? Number(raw.endTime) : null;

  return {
    id: Number(raw.id),
    name: String(raw.name ?? '').trim() || '타이머',
    durationMs: duration,
    remainingMs: remaining,
    isRunning: Boolean(raw.isRunning),
    repeatEnabled: Boolean(raw.repeatEnabled),
    swipeToReset: Boolean(raw.swipeToReset),
    displayOrder: Number.isFinite(raw.displayOrder) ? Number(raw.displayOrder) : Number(raw.id),
    endTime: Number.isFinite(endTime) ? endTime : null,
    updatedAt: raw.updatedAt != null ? Number(raw.updatedAt) : Date.now(),
  };
}

function sortTimersForDisplay(values = Array.from(timers.values())) {
  return values.sort((a, b) => {
    const orderA = Number.isFinite(a.displayOrder) ? a.displayOrder : a.id;
    const orderB = Number.isFinite(b.displayOrder) ? b.displayOrder : b.id;
    if (orderA !== orderB) {
      return orderA - orderB;
    }
    return a.id - b.id;
  });
}

function clampGridValue(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return min;
  }
  return Math.max(min, Math.min(max, Math.floor(numeric)));
}

function normalizeGridSettings(raw = {}) {
  const columns = clampGridValue(raw.columns ?? DEFAULT_GRID_SETTINGS.columns, 1, 6);
  const rows = clampGridValue(raw.rows ?? DEFAULT_GRID_SETTINGS.rows, 1, 6);
  return { columns, rows };
}

function applyGridSettings() {
  if (!timerListElement || !gridSettings) {
    return;
  }
  timerListElement.style.setProperty('--timer-grid-columns', String(gridSettings.columns));
  timerListElement.style.setProperty('--timer-grid-rows', String(gridSettings.rows));
}

function setGridSettings(nextSettings, { shouldRender = true, syncInputs = true } = {}) {
  const normalized = normalizeGridSettings(nextSettings);
  const hasChanged =
    normalized.columns !== gridSettings.columns || normalized.rows !== gridSettings.rows;

  gridSettings = normalized;
  applyGridSettings();

  if (syncInputs) {
    syncGridSettingsInputs();
  }

  if (hasChanged && shouldRender) {
    renderTimers();
  }

  return hasChanged;
}

async function persistGridSettings(settings) {
  if (!channelCode) {
    updateStatus('채널 코드가 필요합니다.', true);
    return;
  }
  try {
    const response = await fetch(buildChannelUrl('/api/timers/grid-settings'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
    if (!response.ok) {
      throw new Error('Failed to persist grid settings');
    }
    const data = await response.json();
    if (data?.gridSettings) {
      setGridSettings(data.gridSettings, { shouldRender: false, syncInputs: true });
    }
  } catch (error) {
    console.error('Failed to save grid settings:', error);
    updateStatus('타이머 슬롯 설정을 저장하지 못했습니다.', true);
    fetchTimers();
  }
}

function syncGridSettingsInputs() {
  if (!gridColumnsInput || !gridRowsInput || !gridSettings) {
    return;
  }
  gridColumnsInput.value = String(gridSettings.columns);
  gridRowsInput.value = String(gridSettings.rows);
}

function updateGridSettingsVisibility() {
  if (!gridSettingsPanel) {
    return;
  }
  gridSettingsPanel.classList.toggle('hidden', !isEditMode);
  if (isEditMode) {
    syncGridSettingsInputs();
  }
}

async function handleGridSettingsChange() {
  if (!gridColumnsInput || !gridRowsInput) {
    return;
  }
  const nextSettings = normalizeGridSettings({
    columns: gridColumnsInput.value,
    rows: gridRowsInput.value,
  });
  const hasChanged = setGridSettings(nextSettings, { shouldRender: true, syncInputs: false });
  syncGridSettingsInputs();
  if (hasChanged) {
    await persistGridSettings(gridSettings);
  }
}

function applyTimerState(state) {
  if (!state || typeof state !== 'object') {
    return;
  }
  const hasTimers = Array.isArray(state.timers);
  if (state.gridSettings) {
    setGridSettings(state.gridSettings, { shouldRender: !hasTimers, syncInputs: isEditMode });
  }
  if (hasTimers) {
    applyTimerList(state.timers);
  }
}

function applyTimerList(list) {
  if (!Array.isArray(list)) {
    return;
  }
  updateServerClockOffsetFromTimers(list);
  timers.clear();
  const normalizedTimers = list.map((item) => normalizeTimer(item));
  sortTimersForDisplay(normalizedTimers).forEach((timer) => {
    timers.set(timer.id, timer);
  });
  pruneShortcutAssignments();
  pruneViewModePositions();
  renderTimers();
}

function applyTimerUpdate(timerData) {
  updateServerClockOffsetFromTimers(timerData);
  const timer = normalizeTimer(timerData);
  timers.set(timer.id, timer);
  renderTimers();
}

function clearTimerDisplays() {
  timerDisplays.clear();
  timerProgressBars.clear();
}

function createTimerCard(timer, slotIndex) {
  const card = document.createElement('article');
  card.className = 'timer-card';
  card.dataset.timerId = String(timer.id);
  const normalizedSlotIndex = Number(slotIndex);
  if (Number.isFinite(normalizedSlotIndex)) {
    card.dataset.slotIndex = String(normalizedSlotIndex);
  }

  if (isEditMode) {
    card.classList.add('is-editing');
    card.setAttribute('draggable', 'true');
    card.addEventListener('dragstart', handleDragStart);
    card.addEventListener('dragover', handleDragOver);
    card.addEventListener('dragleave', handleDragLeave);
    card.addEventListener('drop', handleDrop);
    card.addEventListener('dragend', handleDragEnd);
  }

  const info = document.createElement('div');
  info.className = 'timer-card-info';

  const dragHandle = document.createElement('div');
  dragHandle.className = 'timer-card-drag-handle';
  dragHandle.setAttribute('aria-hidden', 'true');
  info.appendChild(dragHandle);

  if (isEditMode) {
    prepareDragHandle(card, dragHandle);
    prepareCardDragArea(card);
  }

  const infoHeader = document.createElement('div');
  infoHeader.className = 'timer-card-info-header';

  const repeatButton = document.createElement('button');
  repeatButton.type = 'button';
  repeatButton.className = 'repeat-button secondary';
  repeatButton.textContent = '반복';
  if (timer.repeatEnabled) {
    repeatButton.classList.add('active');
  }
  repeatButton.addEventListener('click', () => toggleRepeat(timer.id));

  const nameElement = isEditMode ? document.createElement('input') : document.createElement('span');
  if (isEditMode) {
    nameElement.type = 'text';
    nameElement.className = 'timer-card-name-input';
    nameElement.value = timer.name;
    nameElement.maxLength = 50;
  } else {
    nameElement.className = 'timer-card-name';
    nameElement.textContent = timer.name;
  }

  infoHeader.appendChild(repeatButton);
  infoHeader.appendChild(nameElement);

  const display = document.createElement('div');
  const remaining = getTimerRemaining(timer);

  if (isEditMode) {
    display.className = 'timer-card-display timer-card-display-editable';
    const minuteInput = document.createElement('input');
    minuteInput.type = 'number';
    minuteInput.min = '0';
    minuteInput.max = '180';
    minuteInput.value = String(Math.floor(timer.durationMs / 60000));

    const separator = document.createElement('span');
    separator.textContent = ':';

    const secondInput = document.createElement('input');
    secondInput.type = 'number';
    secondInput.min = '0';
    secondInput.max = '59';
    secondInput.value = String(Math.floor((timer.durationMs % 60000) / 1000)).padStart(2, '0');

    display.appendChild(minuteInput);
    display.appendChild(separator);
    display.appendChild(secondInput);

    attachInlineEditor(timer, {
      nameInput: nameElement,
      minuteInput,
      secondInput,
    });

    const options = document.createElement('div');
    options.className = 'timer-card-options';

    const swipeLabel = document.createElement('label');
    swipeLabel.className = 'timer-card-option';
    const swipeCheckbox = document.createElement('input');
    swipeCheckbox.type = 'checkbox';
    swipeCheckbox.checked = Boolean(timer.swipeToReset);
    const swipeText = document.createElement('span');
    swipeText.textContent = '밀어서 리셋';
    swipeLabel.appendChild(swipeCheckbox);
    swipeLabel.appendChild(swipeText);
    options.appendChild(swipeLabel);
    info.appendChild(options);

    let isUpdatingSwipe = false;
    swipeCheckbox.addEventListener('change', async () => {
      if (isUpdatingSwipe) {
        return;
      }
      const previousValue = Boolean(timer.swipeToReset);
      const desiredValue = Boolean(swipeCheckbox.checked);
      if (previousValue === desiredValue) {
        return;
      }
      isUpdatingSwipe = true;
      timer.swipeToReset = desiredValue;
      try {
        await updateTimer(timer.id, { swipeToReset: desiredValue });
      } catch (error) {
        timer.swipeToReset = previousValue;
        swipeCheckbox.checked = previousValue;
      } finally {
        isUpdatingSwipe = false;
      }
    });
  } else {
    display.className = 'timer-card-display';
    display.textContent = formatTimerDisplay(remaining);
    if (!timer.isRunning && remaining === 0) {
      display.classList.add('finished');
    } else if (remaining > 0 && remaining <= 60 * 1000) {
      display.classList.add('critical');
    }
    timerDisplays.set(timer.id, display);
  }

  info.appendChild(infoHeader);
  info.appendChild(display);

  const durationMs = Math.max(timer.durationMs, 1);
  const progressRatio = Math.max(0, Math.min(1, remaining / durationMs));
  const progress = document.createElement('div');
  progress.className = 'timer-progress';
  const progressInner = document.createElement('div');
  progressInner.className = 'timer-progress-bar';
  progressInner.style.width = `${progressRatio * 100}%`;
  if (timer.isRunning) {
    if (remaining > 0 && remaining <= 60 * 1000) {
      progressInner.classList.add('critical');
    }
  } else {
    progressInner.classList.add('paused');
  }
  progress.appendChild(progressInner);
  timerProgressBars.set(timer.id, progressInner);

  let actionElement = null;
  if (isEditMode) {
    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'timer-card-action danger';
    deleteButton.textContent = '삭제';
    deleteButton.addEventListener('click', () => deleteTimer(timer.id));
    actionElement = deleteButton;
  } else if (isShortcutMode) {
    const assignButton = document.createElement('button');
    assignButton.type = 'button';
    assignButton.className = 'timer-card-action timer-shortcut-assign-button';
    assignButton.textContent = '이 곳을 눌러 단축키 설정';
    assignButton.addEventListener('click', () => openShortcutModal(timer.id));
    actionElement = assignButton;
  } else if (timer.isRunning) {
    if (timer.swipeToReset) {
      const resetContainer = document.createElement('div');
      resetContainer.className = 'timer-card-action timer-card-reset-area';
      resetContainer.classList.add('is-running');
      resetContainer.appendChild(
        createResetSlider(timer, { labelText: formatActionLabel('밀어서 타이머 리셋', timer.id) }),
      );
      actionElement = resetContainer;
    } else {
      const resetButton = document.createElement('button');
      resetButton.type = 'button';
      resetButton.className = 'timer-card-action secondary';
      resetButton.textContent = formatActionLabel('리셋', timer.id);
      resetButton.addEventListener('click', () => resetTimer(timer.id));
      actionElement = resetButton;
    }
  } else {
    const startButton = document.createElement('button');
    startButton.type = 'button';
    startButton.className = 'timer-card-action primary';
    startButton.textContent = formatActionLabel('시작', timer.id);
    startButton.addEventListener('click', () => startTimer(timer.id));
    actionElement = startButton;
  }

  card.appendChild(info);
  card.appendChild(progress);
  if (actionElement) {
    card.appendChild(actionElement);
  }

  return card;
}

function prepareDragHandle(card, dragHandle) {
  if (!card || !dragHandle) {
    return;
  }

  const markReady = () => {
    card.dataset.dragReady = 'true';
  };

  const clearReady = () => {
    delete card.dataset.dragReady;
  };

  ['pointerdown', 'mousedown', 'touchstart'].forEach((eventName) => {
    dragHandle.addEventListener(eventName, markReady);
  });

  ['pointerup', 'pointercancel', 'pointerleave', 'mouseup', 'mouseleave', 'touchend', 'touchcancel'].forEach((eventName) => {
    dragHandle.addEventListener(eventName, clearReady);
  });

  card.addEventListener('dragend', clearReady);
}

function prepareCardDragArea(card) {
  if (!card) {
    return;
  }

  const markReady = (event) => {
    if (!isEditMode) {
      return;
    }
    if ((event.type === 'mousedown' || event.type === 'pointerdown') && event.button !== 0) {
      return;
    }
    const interactive = event.target.closest('input, select, textarea, button, a, label');
    if (interactive) {
      return;
    }
    card.dataset.dragReady = 'true';
  };

  const clearReady = () => {
    delete card.dataset.dragReady;
  };

  ['pointerdown', 'mousedown', 'touchstart'].forEach((eventName) => {
    card.addEventListener(eventName, markReady);
  });

  ['pointerup', 'pointercancel', 'pointerleave', 'mouseup', 'mouseleave', 'touchend', 'touchcancel'].forEach((eventName) => {
    card.addEventListener(eventName, clearReady);
  });

  card.addEventListener('dragend', clearReady);
}

function ensureViewModeCardSizing(card, measuredWidth) {
  if (!card) {
    return;
  }
  const widthValue = Number.isFinite(measuredWidth) ? measuredWidth : card.offsetWidth;
  if (Number.isFinite(widthValue) && widthValue > 0) {
    card.style.width = `${widthValue}px`;
    card.dataset.viewModeWidth = String(widthValue);
  }
}

function setViewModeCardPosition(card, position, { skipUpdate = false } = {}) {
  if (!card || !position || typeof position !== 'object') {
    return;
  }
  const x = Number(position.x);
  const y = Number(position.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return;
  }
  card.classList.add('view-mode-card');
  card.style.position = 'absolute';
  card.style.left = `${x}px`;
  card.style.top = `${y}px`;
  card.style.margin = '0';
  card.dataset.viewModeX = String(x);
  card.dataset.viewModeY = String(y);
  if (!skipUpdate) {
    updateViewModeCanvasSize();
  }
}

function updateViewModeCanvasSize() {
  if (!timerListElement) {
    return;
  }
  if (!isViewMode) {
    timerListElement.style.height = '';
    return;
  }
  const cards = timerListElement.querySelectorAll('.timer-card.view-mode-card');
  if (cards.length === 0) {
    timerListElement.style.height = '240px';
    return;
  }
  let maxBottom = 0;
  cards.forEach((card) => {
    const top = Number(card.dataset.viewModeY ?? card.style.top?.replace('px', ''));
    const height = card.offsetHeight;
    if (Number.isFinite(top) && Number.isFinite(height)) {
      const bottom = top + height;
      if (bottom > maxBottom) {
        maxBottom = bottom;
      }
    }
  });
  const padding = 48;
  const safeHeight = Math.max(240, Math.floor(maxBottom + padding));
  timerListElement.style.height = `${safeHeight}px`;
}

function prepareViewModeCard(card, timerId) {
  if (!card || !Number.isInteger(timerId)) {
    return;
  }
  if (card.dataset.viewModePrepared === 'true') {
    return;
  }
  card.dataset.viewModePrepared = 'true';
  card.addEventListener('pointerdown', (event) => handleViewModePointerDown(event, card, timerId));
}

function applyViewModeLayout() {
  if (!timerListElement) {
    return;
  }
  const cards = Array.from(timerListElement.querySelectorAll('.timer-card'));
  if (cards.length === 0) {
    timerListElement.classList.add('view-mode-active');
    updateViewModeCanvasSize();
    return;
  }

  const measurements = cards.map((card) => ({
    card,
    timerId: Number(card.dataset.timerId),
    rect: card.getBoundingClientRect(),
  }));

  const containerRect = timerListElement.getBoundingClientRect();

  timerListElement.classList.add('view-mode-active');

  measurements.forEach(({ card, timerId, rect }) => {
    ensureViewModeCardSizing(card, rect.width);
    if (Number.isInteger(timerId)) {
      prepareViewModeCard(card, timerId);
    }
    const saved = Number.isInteger(timerId) ? getViewModePosition(timerId) : null;
    const defaultPosition = {
      x: rect.left - containerRect.left,
      y: rect.top - containerRect.top,
    };
    const targetPosition = saved ? snapViewPosition(saved) : snapViewPosition(defaultPosition);
    setViewModeCardPosition(card, targetPosition, { skipUpdate: true });
  });

  updateViewModeCanvasSize();
}

function cancelActiveViewModeDrag() {
  if (!viewModeDragState) {
    return;
  }
  const { card, pointerId } = viewModeDragState;
  if (card) {
    card.classList.remove('view-mode-dragging');
    card.style.zIndex = '';
    try {
      card.releasePointerCapture(pointerId);
    } catch (error) {
      // ignore
    }
  }
  viewModeDragState = null;
}

function handleViewModePointerDown(event, card, timerId) {
  if (!isViewMode || !timerListElement) {
    return;
  }
  if (!card || !Number.isInteger(timerId)) {
    return;
  }
  if (event.pointerType === 'mouse' && event.button !== 0) {
    return;
  }
  const interactiveTarget = event.target instanceof HTMLElement ? event.target.closest('button, input, textarea, select, a, label') : null;
  if (interactiveTarget) {
    return;
  }

  const containerRect = timerListElement.getBoundingClientRect();
  const currentX = Number.parseFloat(card.style.left);
  const currentY = Number.parseFloat(card.style.top);
  const cardRect = card.getBoundingClientRect();
  const startX = Number.isFinite(currentX) ? currentX : cardRect.left - containerRect.left;
  const startY = Number.isFinite(currentY) ? currentY : cardRect.top - containerRect.top;
  ensureViewModeCardSizing(card);
  const snappedStart = snapViewPosition({ x: startX, y: startY });

  viewModeDragState = {
    timerId,
    card,
    pointerId: event.pointerId,
    offsetX: event.clientX - (containerRect.left + snappedStart.x),
    offsetY: event.clientY - (containerRect.top + snappedStart.y),
    latestX: snappedStart.x,
    latestY: snappedStart.y,
  };

  card.classList.add('view-mode-dragging');
  card.style.zIndex = '40';

  try {
    card.setPointerCapture(event.pointerId);
  } catch (error) {
    // ignore
  }

  event.preventDefault();
}

function handleViewModePointerMove(event) {
  if (!viewModeDragState || !isViewMode || !timerListElement) {
    return;
  }
  const { card, offsetX, offsetY } = viewModeDragState;
  if (!card) {
    return;
  }
  const containerRect = timerListElement.getBoundingClientRect();
  const nextX = snapToViewGrid(event.clientX - containerRect.left - offsetX);
  const nextY = snapToViewGrid(event.clientY - containerRect.top - offsetY);
  if (!Number.isFinite(nextX) || !Number.isFinite(nextY)) {
    return;
  }

  viewModeDragState.latestX = nextX;
  viewModeDragState.latestY = nextY;

  setViewModeCardPosition(card, { x: nextX, y: nextY }, { skipUpdate: true });
  updateViewModeCanvasSize();
}

function handleViewModePointerUp(event) {
  if (!viewModeDragState) {
    return;
  }
  const { card, pointerId, timerId, latestX, latestY } = viewModeDragState;
  if (event && event.pointerId != null && pointerId != null && event.pointerId !== pointerId) {
    return;
  }
  if (card) {
    card.classList.remove('view-mode-dragging');
    card.style.zIndex = '';
    try {
      card.releasePointerCapture(pointerId);
    } catch (error) {
      // ignore
    }
  }

  if (Number.isInteger(timerId) && Number.isFinite(latestX) && Number.isFinite(latestY)) {
    setViewModePosition(timerId, { x: latestX, y: latestY });
  }

  viewModeDragState = null;
  updateViewModeCanvasSize();
}

function attachInlineEditor(timer, { nameInput, minuteInput, secondInput }) {
  if (!(nameInput instanceof HTMLInputElement) || !(minuteInput instanceof HTMLInputElement) || !(secondInput instanceof HTMLInputElement)) {
    return;
  }

  const applyTimerDefaults = () => {
    minuteInput.value = String(Math.floor(timer.durationMs / 60000));
    secondInput.value = String(Math.floor((timer.durationMs % 60000) / 1000)).padStart(2, '0');
  };

  const normalizeValues = () => {
    const name = nameInput.value.trim() || timer.name;
    const minutesValue = Number(minuteInput.value);
    const secondsValue = Number(secondInput.value);
    const safeMinutes = Number.isFinite(minutesValue) ? Math.max(0, Math.floor(minutesValue)) : 0;
    const safeSecondsRaw = Number.isFinite(secondsValue) ? Math.max(0, Math.floor(secondsValue)) : 0;
    const clampedSeconds = Math.min(59, safeSecondsRaw);

    minuteInput.value = String(safeMinutes);
    secondInput.value = String(clampedSeconds).padStart(2, '0');
    nameInput.value = name;

    const totalSeconds = safeMinutes * 60 + clampedSeconds;
    const durationMs = clampTimerDuration(totalSeconds * 1000);

    return { name, durationMs };
  };

  let isSubmitting = false;
  let pending = false;

  const submitChanges = async () => {
    const { name, durationMs } = normalizeValues();

    if (durationMs < MIN_TIMER_DURATION_MS) {
      window.alert('타이머 시간은 최소 5초 이상이어야 합니다.');
      applyTimerDefaults();
      return;
    }

    if (isSubmitting) {
      pending = true;
      return;
    }

    if (name === timer.name && durationMs === timer.durationMs) {
      return;
    }

    isSubmitting = true;
    try {
      await updateTimer(timer.id, { name, duration: durationMs });
    } finally {
      isSubmitting = false;
      if (pending) {
        pending = false;
        submitChanges();
      }
    }
  };

  const handleBlur = () => {
    normalizeValues();
  };

  [nameInput, minuteInput, secondInput].forEach((element) => {
    element.addEventListener('change', submitChanges);
    element.addEventListener('blur', handleBlur);
    element.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        submitChanges();
      }
    });
  });
}

function createResetSlider(timer, { labelText } = {}) {
  const slider = document.createElement('div');
  slider.className = 'timer-reset-slider';

  const label = document.createElement('span');
  label.className = 'timer-reset-label';
  label.textContent = labelText || '밀어서 타이머 리셋';

  const knob = document.createElement('button');
  knob.type = 'button';
  knob.className = 'timer-reset-knob';
  knob.textContent = '';

  slider.appendChild(label);
  slider.appendChild(knob);

  let isDragging = false;
  let pointerId = null;
  let startX = 0;
  let currentOffset = 0;
  let maxOffset = 0;
  let isProcessing = false;

  const getPointerX = (event) => {
    if (typeof event.clientX === 'number') {
      return event.clientX;
    }
    if (event.touches && event.touches[0]) {
      return event.touches[0].clientX;
    }
    return 0;
  };

  const setPosition = (offset, animate = false) => {
    const clamped = Math.max(0, Math.min(maxOffset, offset));
    currentOffset = clamped;
    if (animate) {
      knob.style.transition = 'transform 0.2s ease';
      label.style.transition = 'opacity 0.2s ease';
    } else {
      knob.style.transition = '';
      label.style.transition = '';
    }

    knob.style.transform = `translateX(${clamped}px)`;
    const ratio = maxOffset > 0 ? Math.min(1, clamped / maxOffset) : 0;
    slider.style.setProperty('--slider-progress', String(ratio));
    label.style.opacity = String(1 - Math.min(0.95, ratio));

    if (animate) {
      window.setTimeout(() => {
        knob.style.transition = '';
        label.style.transition = '';
      }, 200);
    }
  };

  const resetPosition = () => {
    setPosition(0, true);
  };

  const computeMaxOffset = () => {
    const sliderStyles = window.getComputedStyle(slider);
    const paddingLeft = Number.parseFloat(sliderStyles.paddingLeft) || 0;
    const paddingRight = Number.parseFloat(sliderStyles.paddingRight) || 0;
    const baseOffset = Number.parseFloat(window.getComputedStyle(knob).left) || 0;
    const innerWidth = slider.clientWidth - paddingLeft - paddingRight;
    maxOffset = Math.max(0, innerWidth - knob.offsetWidth - baseOffset);
  };

  const startDrag = (event) => {
    if (isProcessing) {
      return;
    }
    event.preventDefault();
    computeMaxOffset();
    isDragging = true;
    pointerId = event.pointerId ?? null;
    const pointerX = getPointerX(event);
    startX = pointerX - currentOffset;
    slider.classList.add('dragging');
    if (pointerId != null && typeof knob.setPointerCapture === 'function') {
      knob.setPointerCapture(pointerId);
    }
  };

  const moveDrag = (event) => {
    if (!isDragging) {
      return;
    }
    if (pointerId != null && event.pointerId != null && event.pointerId !== pointerId) {
      return;
    }
    event.preventDefault();
    const pointerX = getPointerX(event);
    const offset = pointerX - startX;
    setPosition(offset, false);
  };

  const finishDrag = (event) => {
    if (!isDragging) {
      return;
    }
    if (pointerId != null && event.pointerId != null && event.pointerId !== pointerId) {
      return;
    }
    event.preventDefault();
    isDragging = false;
    slider.classList.remove('dragging');
    if (pointerId != null && typeof knob.releasePointerCapture === 'function') {
      knob.releasePointerCapture(pointerId);
    }
    pointerId = null;

    const ratio = maxOffset > 0 ? currentOffset / maxOffset : 0;
    if (ratio >= 0.9) {
      setPosition(maxOffset, true);
      isProcessing = true;
      knob.disabled = true;
      resetTimer(timer.id)
        .catch(() => { })
        .finally(() => {
          isProcessing = false;
          knob.disabled = false;
          resetPosition();
        });
    } else {
      resetPosition();
    }
  };

  knob.addEventListener('pointerdown', startDrag);
  knob.addEventListener('pointermove', moveDrag);
  knob.addEventListener('pointerup', finishDrag);
  knob.addEventListener('pointercancel', finishDrag);

  return slider;
}

function buildSlotLayout(baseLayout = []) {
  const sortedTimers = sortTimersForDisplay();
  const columns = clampGridValue(gridSettings?.columns ?? DEFAULT_GRID_SETTINGS.columns, 1, 6);
  const rows = clampGridValue(gridSettings?.rows ?? DEFAULT_GRID_SETTINGS.rows, 1, 6);
  const highestOrder = sortedTimers.reduce((max, timer) => {
    const order = Number(timer.displayOrder);
    if (Number.isFinite(order)) {
      return Math.max(max, Math.floor(order));
    }
    return max;
  }, -1);
  const baseLength = Math.max(columns * rows, highestOrder + 1, baseLayout.length, sortedTimers.length, 1);
  const slots = new Array(baseLength).fill(null);
  const assigned = new Set();

  sortedTimers.forEach((timer) => {
    if (assigned.has(timer.id)) {
      return;
    }

    let slotIndex = Number(timer.displayOrder);
    if (Number.isFinite(slotIndex)) {
      slotIndex = Math.max(0, Math.floor(slotIndex));
    } else {
      slotIndex = null;
    }

    if (slotIndex != null) {
      while (slotIndex >= slots.length) {
        slots.push(null);
      }
      if (slots[slotIndex] == null) {
        slots[slotIndex] = timer.id;
        assigned.add(timer.id);
        return;
      }
    }

    let fallbackIndex = slots.indexOf(null);
    if (fallbackIndex === -1) {
      slots.push(timer.id);
    } else {
      slots[fallbackIndex] = timer.id;
    }
    assigned.add(timer.id);
  });

  return slots;
}

function createSlotPlaceholder() {
  const placeholder = document.createElement('div');
  placeholder.className = 'timer-slot-placeholder';
  placeholder.setAttribute('aria-hidden', 'true');
  return placeholder;
}

function renderTimers() {
  if (!timerListElement) {
    return;
  }

  cancelActiveViewModeDrag();
  pruneShortcutAssignments();
  pruneViewModePositions();
  applyGridSettings();
  clearTimerDisplays();
  timerListElement.classList.remove('view-mode-active');
  timerListElement.style.height = '';
  timerListElement.innerHTML = '';

  const fragment = document.createDocumentFragment();
  const sortedTimers = sortTimersForDisplay();

  if (!isEditMode && sortedTimers.length === 0) {
    const emptyMessage = document.createElement('p');
    emptyMessage.className = 'timer-empty';
    emptyMessage.textContent = '등록된 타이머가 없습니다. 추가 버튼을 눌러 타이머를 만들어주세요.';
    fragment.appendChild(emptyMessage);
  }

  if (isEditMode || sortedTimers.length > 0) {
    const slots = buildSlotLayout(slotLayout);
    slotLayout = slots.slice();

    if (isViewMode) {
      slots.forEach((timerId, index) => {
        if (Number.isInteger(timerId) && timers.has(timerId)) {
          const timer = timers.get(timerId);
          if (timer) {
            fragment.appendChild(createTimerCard(timer, index));
          }
        }
      });
    } else {
      slots.forEach((timerId, index) => {
        if (Number.isInteger(timerId) && timers.has(timerId)) {
          const timer = timers.get(timerId);
          if (timer) {
            fragment.appendChild(createTimerCard(timer, index));
          }
        } else if (isEditMode) {
          fragment.appendChild(createDropSlot(index));
        } else {
          fragment.appendChild(createSlotPlaceholder());
        }
      });

      if (isEditMode) {
        fragment.appendChild(createDropSlot(slotLayout.length));
      }
    }
  }

  timerListElement.appendChild(fragment);
  updateTimerDisplays();
  if (isViewMode) {
    applyViewModeLayout();
  }
}

function createDropSlot(index) {
  const slot = document.createElement('div');
  slot.className = 'timer-drop-slot';
  slot.dataset.slotIndex = String(index);
  slot.addEventListener('dragover', handleDragOver);
  slot.addEventListener('dragleave', handleDragLeave);
  slot.addEventListener('drop', handleDrop);
  const label = document.createElement('span');
  label.className = 'timer-drop-slot-label';
  label.textContent = '여기에 놓기';
  slot.appendChild(label);
  return slot;
}

function updateTimerDisplays() {
  const now = Date.now();
  let needsRender = false;
  timerDisplays.forEach((element, id) => {
    const timer = timers.get(id);
    if (!timer || !element) {
      return;
    }
    const remaining = getTimerRemaining(timer, now);
    element.textContent = formatTimerDisplay(remaining);

    // 클라이언트 측 타이머 만료 처리: 진행 중인데 남은 시간이 0이면 상태 갱신
    if (timer.isRunning && remaining === 0) {
      if (timer.repeatEnabled) {
        // 반복 활성화: 타이머 재시작
        timer.remainingMs = timer.durationMs;
        timer.endTime = getEffectiveNow(now) + timer.durationMs;
        // 서버에 동기화 요청 (배경에서 처리)
        resetTimer(timer.id).catch(() => { });
      } else {
        timer.isRunning = false;
        timer.remainingMs = 0;
        timer.endTime = null;
      }
      needsRender = true;
    }

    const isFinished = !timer.isRunning && remaining === 0;
    if (isFinished) {
      element.classList.add('finished');
      element.classList.remove('critical');
    } else {
      element.classList.remove('finished');
      if (remaining > 0 && remaining <= 60 * 1000) {
        element.classList.add('critical');
      } else {
        element.classList.remove('critical');
      }
    }

    const progressElement = timerProgressBars.get(id);
    if (progressElement) {
      const duration = Math.max(timer.durationMs, 1);
      const ratio = Math.max(0, Math.min(1, remaining / duration));
      progressElement.style.width = `${ratio * 100}%`;
      const highlightCritical =
        timer.isRunning && !isFinished && remaining > 0 && remaining <= 60 * 1000;
      progressElement.classList.toggle('critical', Boolean(highlightCritical));
      progressElement.classList.toggle('paused', !timer.isRunning);
    }
  });

  // 만료된 타이머가 있으면 UI 다시 렌더링 (버튼 상태 갱신)
  if (needsRender) {
    renderTimers();
  }
}

async function fetchTimers() {
  if (!channelCode) {
    updateStatus('채널 코드가 필요합니다.', true);
    return;
  }
  try {
    const response = await fetch(buildChannelUrl('/api/timers'));
    if (!response.ok) {
      throw new Error('타이머 정보를 불러올 수 없습니다.');
    }
    const data = await response.json();
    if (Array.isArray(data)) {
      applyTimerList(data);
    } else {
      applyTimerState(data);
    }
    updateStatus('실시간으로 연결되었습니다.');
  } catch (error) {
    console.error('Failed to fetch timers:', error);
    updateStatus('타이머 정보를 불러오는 중 문제가 발생했습니다.', true);
  }
}

async function requestJson(url, options = {}) {
  const config = {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  };
  if (!channelCode) {
    updateStatus('채널 코드가 필요합니다.', true);
    throw new Error('Missing channel code');
  }
  const targetUrl = buildChannelUrl(url);
  try {
    const response = await fetch(targetUrl, config);
    if (!response.ok) {
      const message = '요청을 처리하지 못했습니다.';
      throw new Error(message);
    }
    return await response.json();
  } catch (error) {
    console.error('Timer request failed:', error);
    updateStatus('요청 처리 중 오류가 발생했습니다.', true);
    throw error;
  }
}

async function addTimer() {
  try {
    const timer = await requestJson('/api/timers', { method: 'POST' });
    applyTimerUpdate(timer);
  } catch (error) {
    // 이미 상태 메시지 출력됨
  }
}

async function updateTimer(id, payload) {
  try {
    const timer = await requestJson(`/api/timers/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    applyTimerUpdate(timer);
  } catch (error) {
    // 상태 메시지 출력됨
  }
}

async function startTimer(id) {
  try {
    const timer = await requestJson(`/api/timers/${id}/start`, { method: 'POST' });
    applyTimerUpdate(timer);
  } catch (error) {
    // 상태 메시지 출력됨
  }
}

async function resetTimer(id) {
  try {
    const timer = await requestJson(`/api/timers/${id}/reset`, { method: 'POST' });
    applyTimerUpdate(timer);
  } catch (error) {
    // 상태 메시지 출력됨
  }
}

async function toggleRepeat(id) {
  try {
    const timer = await requestJson(`/api/timers/${id}/toggle-repeat`, { method: 'POST' });
    applyTimerUpdate(timer);
  } catch (error) {
    // 상태 메시지 출력됨
  }
}

async function deleteTimer(id) {
  try {
    const response = await requestJson(`/api/timers/${id}`, { method: 'DELETE' });
    if (response) {
      applyTimerState(response);
    } else {
      const numericId = Number(id);
      if (Number.isInteger(numericId)) {
        removeTimerShortcut(numericId);
        timers.delete(numericId);
        removeViewModePosition(numericId);
      }
      renderTimers();
    }
  } catch (error) {
    // 상태 메시지 출력됨
  }
}

function toggleEditMode() {
  if (isShortcutMode) {
    exitShortcutMode({ shouldRender: false });
  }
  if (!isEditMode && isViewMode) {
    toggleViewMode();
  }
  isEditMode = !isEditMode;
  if (!isEditMode) {
    draggedTimerId = null;
  }
  if (toggleEditButton) {
    toggleEditButton.textContent = isEditMode ? '수정 완료' : '수정';
  }
  updateGridSettingsVisibility();
  clearDropIndicators();
  renderTimers();
}

function updateViewModeButtonState() {
  if (!toggleViewModeButton) {
    return;
  }
  toggleViewModeButton.textContent = isViewMode ? '보기 모드 종료' : '보기 모드';
  toggleViewModeButton.setAttribute('aria-pressed', isViewMode ? 'true' : 'false');
}

function toggleViewMode() {
  const nextState = !isViewMode;
  if (nextState) {
    if (isEditMode) {
      toggleEditMode();
    }
    if (isShortcutMode) {
      exitShortcutMode({ shouldRender: false });
    }
  } else {
    cancelActiveViewModeDrag();
  }
  isViewMode = nextState;
  updateViewModeButtonState();
  renderTimers();
}

function clearDropIndicators() {
  if (!timerListElement) {
    return;
  }
  timerListElement.querySelectorAll('.timer-card, .timer-drop-slot').forEach((element) => {
    element.classList.remove('dragging', 'drop-target', 'drop-target-before', 'drop-target-after');
  });
}

function handleDragStart(event) {
  if (!isEditMode || !event.currentTarget) {
    event.preventDefault();
    return;
  }
  const card = event.currentTarget;
  if (card.dataset.dragReady !== 'true') {
    event.preventDefault();
    return;
  }
  delete card.dataset.dragReady;
  const timerId = Number(card.dataset.timerId);
  if (!Number.isInteger(timerId)) {
    event.preventDefault();
    return;
  }
  draggedTimerId = timerId;
  card.classList.add('dragging');
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(timerId));
  }
}

function handleDragOver(event) {
  if (!isEditMode || draggedTimerId == null || !event.currentTarget) {
    return;
  }
  const card = event.currentTarget;
  if (card.classList.contains('timer-drop-slot')) {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    card.classList.add('drop-target');
    return;
  }
  const targetId = Number(card.dataset.timerId);
  const slotIndex = Number(card.dataset.slotIndex);
  if (!Number.isInteger(targetId) || targetId === draggedTimerId || !Number.isFinite(slotIndex)) {
    return;
  }
  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move';
  }
  const rect = card.getBoundingClientRect();
  const isAfter = event.clientY - rect.top > rect.height / 2;
  card.classList.add('drop-target');
  card.classList.toggle('drop-target-after', isAfter);
  card.classList.toggle('drop-target-before', !isAfter);
}

function handleDragLeave(event) {
  if (!event.currentTarget) {
    return;
  }
  const card = event.currentTarget;
  card.classList.remove('drop-target', 'drop-target-before', 'drop-target-after');
}

function computeReorderedSlots(timerId, targetSlotIndex) {
  if (!Number.isInteger(timerId)) {
    return null;
  }
  const nextIndex = Number(targetSlotIndex);
  if (!Number.isFinite(nextIndex) || nextIndex < 0) {
    return null;
  }
  const currentLayout = Array.isArray(slotLayout) ? slotLayout.slice() : [];
  const fromIndex = currentLayout.indexOf(timerId);
  if (fromIndex === -1) {
    return null;
  }
  while (currentLayout.length <= nextIndex) {
    currentLayout.push(null);
  }
  if (fromIndex === nextIndex) {
    return currentLayout;
  }
  const occupant = currentLayout[nextIndex];
  currentLayout[nextIndex] = timerId;
  currentLayout[fromIndex] = Number.isInteger(occupant) ? occupant : null;
  return currentLayout;
}

function applySlotReorder(nextLayout) {
  if (!Array.isArray(nextLayout)) {
    return;
  }
  const normalizedLayout = nextLayout.map((value) => {
    if (value == null || value === '') {
      return null;
    }
    const numeric = Number(value);
    return Number.isInteger(numeric) ? numeric : null;
  });
  const now = Date.now();
  const seen = new Set();

  normalizedLayout.forEach((value, index) => {
    if (Number.isInteger(value) && timers.has(value)) {
      seen.add(value);
      const timer = timers.get(value);
      if (timer && timer.displayOrder !== index) {
        timer.displayOrder = index;
        timer.updatedAt = now;
      }
    } else {
      normalizedLayout[index] = null;
    }
  });

  timers.forEach((timer, id) => {
    if (!seen.has(id)) {
      normalizedLayout.push(id);
      timer.displayOrder = normalizedLayout.length - 1;
      timer.updatedAt = now;
      seen.add(id);
    }
  });

  slotLayout = normalizedLayout;
  renderTimers();

  requestJson('/api/timers/reorder', {
    method: 'POST',
    body: JSON.stringify({ slots: normalizedLayout }),
  })
    .then((data) => {
      applyTimerState(data);
    })
    .catch(() => {
      fetchTimers();
    });
}

function handleDrop(event) {
  if (!isEditMode || draggedTimerId == null || !event.currentTarget) {
    return;
  }
  event.preventDefault();
  const card = event.currentTarget;
  clearDropIndicators();
  if (card.classList.contains('timer-drop-slot')) {
    const slotIndex = Number(card.dataset.slotIndex);
    const nextLayout = computeReorderedSlots(draggedTimerId, slotIndex);
    if (nextLayout) {
      applySlotReorder(nextLayout);
    }
    return;
  }
  const slotIndex = Number(card.dataset.slotIndex);
  if (!Number.isFinite(slotIndex)) {
    draggedTimerId = null;
    return;
  }
  const rect = card.getBoundingClientRect();
  const insertAfter = event.clientY - rect.top > rect.height / 2;
  const desiredIndex = insertAfter ? slotIndex + 1 : slotIndex;
  const nextLayout = computeReorderedSlots(draggedTimerId, desiredIndex);
  if (nextLayout) {
    applySlotReorder(nextLayout);
  }
}

function handleDragEnd(event) {
  if (event.currentTarget) {
    event.currentTarget.classList.remove('dragging');
  }
  clearDropIndicators();
  draggedTimerId = null;
}

function connectStream() {
  if (!channelCode) {
    updateStatus('채널 코드가 필요합니다.', true);
    return;
  }
  if (sseReconnectTimeout) {
    clearTimeout(sseReconnectTimeout);
    sseReconnectTimeout = null;
  }
  if (eventSource) {
    eventSource.close();
  }

  eventSource = new EventSource(buildChannelUrl('/api/timers/stream'));

  eventSource.onopen = () => {
    updateStatus('실시간으로 연결되었습니다.');
    sseReconnectDelay = 1000; // 연결 성공 시 재연결 딜레이 초기화
  };

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      applyTimerState(data);
      if (Array.isArray(data?.timers)) {
        updateStatus('실시간으로 연결되었습니다.');
      }
    } catch (error) {
      console.error('Failed to parse timer stream data:', error);
    }
  };

  eventSource.onerror = () => {
    updateStatus('연결이 불안정합니다. 잠시 후 다시 시도합니다...', true);
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    // 지수 백오프로 재연결 (최대 30초)
    sseReconnectTimeout = setTimeout(() => {
      connectStream();
    }, sseReconnectDelay);
    sseReconnectDelay = Math.min(sseReconnectDelay * 1.5, 30000);
  };
}

if (addTimerButton) {
  addTimerButton.addEventListener('click', () => addTimer());
}

if (toggleEditButton) {
  toggleEditButton.addEventListener('click', () => toggleEditMode());
}

if (shortcutButton) {
  shortcutButton.addEventListener('click', () => toggleShortcutMode());
}

if (toggleViewModeButton) {
  toggleViewModeButton.addEventListener('click', () => toggleViewMode());
}

if (gridColumnsInput) {
  ['change', 'input'].forEach((eventName) => {
    gridColumnsInput.addEventListener(eventName, handleGridSettingsChange);
  });
}

if (gridRowsInput) {
  ['change', 'input'].forEach((eventName) => {
    gridRowsInput.addEventListener(eventName, handleGridSettingsChange);
  });
}

loadViewModePositions();
loadShortcutAssignments();
updateShortcutButtonState();
updateViewModeButtonState();
document.addEventListener('keydown', handleGlobalShortcutKeydown);

window.addEventListener('pointermove', handleViewModePointerMove);
window.addEventListener('pointerup', handleViewModePointerUp);
window.addEventListener('pointercancel', handleViewModePointerUp);
window.addEventListener('resize', () => {
  if (isViewMode) {
    updateViewModeCanvasSize();
  }
});

syncGridSettingsInputs();
updateGridSettingsVisibility();
applyGridSettings();

window.setInterval(() => {
  updateTimerDisplays();
}, 250);

updateChannelLabel();

if (!channelCode) {
  updateStatus('채널 코드가 필요합니다. 메인 화면으로 이동합니다.', true);
  setTimeout(() => {
    window.location.replace('/');
  }, 1200);
} else {
  fetchTimers();
  connectStream();
}
