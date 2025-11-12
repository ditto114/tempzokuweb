const DEFAULT_TIMER_DURATION_MS = 15 * 60 * 1000;
const MIN_TIMER_DURATION_MS = 5 * 1000;
const MAX_TIMER_DURATION_MS = 3 * 60 * 60 * 1000;

const timerListElement = document.getElementById('timer-list');
const statusElement = document.getElementById('timer-stream-status');
const addTimerButton = document.getElementById('add-timer-button');
const toggleEditButton = document.getElementById('toggle-edit-mode');
const gridSettingsPanel = document.getElementById('timer-grid-settings');
const gridColumnsInput = document.getElementById('timer-grid-columns');
const gridRowsInput = document.getElementById('timer-grid-rows');

const timers = new Map();
const timerDisplays = new Map();
const timerProgressBars = new Map();

let eventSource = null;
let isEditMode = false;
let draggedTimerId = null;
let slotLayout = [];
const DEFAULT_GRID_SETTINGS = Object.freeze({ columns: 3, rows: 2 });
let gridSettings = { ...DEFAULT_GRID_SETTINGS };

function clampTimerDuration(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return DEFAULT_TIMER_DURATION_MS;
  }
  return Math.min(Math.max(value, MIN_TIMER_DURATION_MS), MAX_TIMER_DURATION_MS);
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

function getTimerRemaining(timer, now = Date.now()) {
  if (!timer) {
    return 0;
  }
  if (timer.isRunning && typeof timer.endTime === 'number') {
    return Math.max(0, timer.endTime - now);
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
  try {
    const response = await fetch('/api/timers/grid-settings', {
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
  timers.clear();
  sortTimersForDisplay(list.map((item) => normalizeTimer(item))).forEach((timer) => {
    timers.set(timer.id, timer);
  });
  renderTimers();
}

function applyTimerUpdate(timerData) {
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
  } else if (timer.isRunning) {
    const resetContainer = document.createElement('div');
    resetContainer.className = 'timer-card-action timer-card-reset-area';
    resetContainer.classList.add('is-running');
    resetContainer.appendChild(createResetSlider(timer));
    actionElement = resetContainer;
  } else {
    const startButton = document.createElement('button');
    startButton.type = 'button';
    startButton.className = 'timer-card-action primary';
    startButton.textContent = '시작';
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

function createResetSlider(timer) {
  const slider = document.createElement('div');
  slider.className = 'timer-reset-slider';

  const label = document.createElement('span');
  label.className = 'timer-reset-label';
  label.textContent = '밀어서 타이머 리셋';

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
        .catch(() => {})
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

  applyGridSettings();
  clearTimerDisplays();
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

  timerListElement.appendChild(fragment);
  updateTimerDisplays();
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
  timerDisplays.forEach((element, id) => {
    const timer = timers.get(id);
    if (!timer || !element) {
      return;
    }
    const remaining = getTimerRemaining(timer, now);
    element.textContent = formatTimerDisplay(remaining);
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
}

async function fetchTimers() {
  try {
    const response = await fetch('/api/timers');
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
  try {
    const response = await fetch(url, config);
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
      timers.delete(Number(id));
      renderTimers();
    }
  } catch (error) {
    // 상태 메시지 출력됨
  }
}

function toggleEditMode() {
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
  if (eventSource) {
    eventSource.close();
  }

  eventSource = new EventSource('/api/timers/stream');

  eventSource.onopen = () => {
    updateStatus('실시간으로 연결되었습니다.');
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
    updateStatus('연결이 불안정합니다. 잠시 후 다시 시도해주세요.', true);
  };
}

if (addTimerButton) {
  addTimerButton.addEventListener('click', () => addTimer());
}

if (toggleEditButton) {
  toggleEditButton.addEventListener('click', () => toggleEditMode());
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

syncGridSettingsInputs();
updateGridSettingsVisibility();
applyGridSettings();

window.setInterval(() => {
  updateTimerDisplays();
}, 250);

fetchTimers();
connectStream();
