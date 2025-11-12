const DEFAULT_TIMER_DURATION_MS = 15 * 60 * 1000;
const MIN_TIMER_DURATION_MS = 5 * 1000;
const MAX_TIMER_DURATION_MS = 3 * 60 * 60 * 1000;

const timerListElement = document.getElementById('timer-list');
const statusElement = document.getElementById('timer-stream-status');
const addTimerButton = document.getElementById('add-timer-button');
const toggleEditButton = document.getElementById('toggle-edit-mode');

const timers = new Map();
const timerDisplays = new Map();
const timerProgressBars = new Map();

let eventSource = null;
let isEditMode = false;
let draggedTimerId = null;

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

function createTimerCard(timer) {
  const card = document.createElement('article');
  card.className = 'timer-card';
  card.dataset.timerId = String(timer.id);

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

  const progress = document.createElement('div');
  progress.className = 'timer-progress';
  const progressInner = document.createElement('div');
  progressInner.className = 'timer-progress-bar';
  const durationMs = Math.max(timer.durationMs, 1);
  const progressRatio = Math.max(0, Math.min(1, remaining / durationMs));
  progressInner.style.width = `${progressRatio * 100}%`;
  if (remaining > 0 && remaining <= 60 * 1000) {
    progressInner.classList.add('critical');
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
  knob.textContent = '➜';

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

function renderTimers() {
  if (!timerListElement) {
    return;
  }

  clearTimerDisplays();
  timerListElement.innerHTML = '';

  const fragment = document.createDocumentFragment();
  const sortedTimers = sortTimersForDisplay();

  if (sortedTimers.length === 0) {
    const emptyMessage = document.createElement('p');
    emptyMessage.className = 'timer-empty';
    emptyMessage.textContent = '등록된 타이머가 없습니다. 추가 버튼을 눌러 타이머를 만들어주세요.';
    if (isEditMode) {
      emptyMessage.classList.add('timer-empty--editing');
    }
    fragment.appendChild(emptyMessage);
  } else {
    sortedTimers.forEach((timer) => {
      fragment.appendChild(createTimerCard(timer));
    });
  }

  if (isEditMode) {
    appendDropSlots(fragment, sortedTimers.length);
  }

  timerListElement.appendChild(fragment);
  updateTimerDisplays();
}

function appendDropSlots(fragment, timerCount) {
  if (!timerListElement) {
    return;
  }

  const columnCount = Math.max(1, getGridColumnCount(timerListElement));
  const remainder = timerCount % columnCount;
  const baseSlots = columnCount;
  const extraSlots = remainder === 0 ? baseSlots : columnCount - remainder;
  const totalSlots = timerCount === 0 ? baseSlots : extraSlots;

  for (let index = 0; index < totalSlots; index += 1) {
    fragment.appendChild(createDropSlot(timerCount + index));
  }
}

function getGridColumnCount(element) {
  if (!element) {
    return 0;
  }
  const template = window.getComputedStyle(element).gridTemplateColumns || '';
  const repeatMatch = template.match(/repeat\((\d+)/);
  if (repeatMatch) {
    return Number.parseInt(repeatMatch[1], 10) || 0;
  }
  const minmaxMatches = template.match(/minmax\(/g);
  if (minmaxMatches && minmaxMatches.length > 0) {
    return minmaxMatches.length;
  }
  const parts = template.trim().split(/\s+/).filter(Boolean);
  return parts.length;
}

function createDropSlot(index) {
  const slot = document.createElement('div');
  slot.className = 'timer-drop-slot';
  slot.dataset.dropIndex = String(index);
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
      if (!isFinished && remaining > 0 && remaining <= 60 * 1000) {
        progressElement.classList.add('critical');
      } else {
        progressElement.classList.remove('critical');
      }
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
    applyTimerList(Array.isArray(data) ? data : []);
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
    if (Array.isArray(response?.timers)) {
      applyTimerList(response.timers);
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
  if (!Number.isInteger(targetId) || targetId === draggedTimerId) {
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

function performLocalReorder(sourceId, targetId, insertAfter) {
  const sortedTimers = sortTimersForDisplay();
  const order = sortedTimers.map((timer) => timer.id);
  const fromIndex = order.indexOf(sourceId);
  if (fromIndex === -1) {
    return;
  }
  const [movedId] = order.splice(fromIndex, 1);
  let targetIndex = order.indexOf(targetId);
  if (targetIndex === -1) {
    return;
  }
  if (insertAfter) {
    targetIndex += 1;
  }
  order.splice(targetIndex, 0, movedId);

  const hasChanged = order.some((id, index) => id !== sortedTimers[index]?.id);
  if (!hasChanged) {
    return;
  }

  order.forEach((id, index) => {
    const timer = timers.get(id);
    if (timer) {
      timer.displayOrder = index;
    }
  });
  renderTimers();

  requestJson('/api/timers/reorder', {
    method: 'POST',
    body: JSON.stringify({ order }),
  })
    .then((data) => {
      if (Array.isArray(data?.timers)) {
        applyTimerList(data.timers);
      }
    })
    .catch(() => {
      fetchTimers();
    });
}

function performLocalReorderToIndex(sourceId, targetIndex) {
  const sortedTimers = sortTimersForDisplay();
  const order = sortedTimers.map((timer) => timer.id);
  const fromIndex = order.indexOf(sourceId);
  if (fromIndex === -1) {
    return;
  }

  const [movedId] = order.splice(fromIndex, 1);
  const desiredIndexRaw = Number(targetIndex);
  const desiredIndex = Number.isFinite(desiredIndexRaw) ? desiredIndexRaw : order.length;
  const clampedIndex = Math.max(0, Math.min(desiredIndex, order.length));
  order.splice(clampedIndex, 0, movedId);

  const hasChanged = order.some((id, index) => id !== sortedTimers[index]?.id);
  if (!hasChanged) {
    return;
  }

  order.forEach((id, index) => {
    const timer = timers.get(id);
    if (timer) {
      timer.displayOrder = index;
    }
  });

  renderTimers();

  requestJson('/api/timers/reorder', {
    method: 'POST',
    body: JSON.stringify({ order }),
  })
    .then((data) => {
      if (Array.isArray(data?.timers)) {
        applyTimerList(data.timers);
      }
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
  if (card.classList.contains('timer-drop-slot')) {
    const dropIndex = Number(card.dataset.dropIndex);
    clearDropIndicators();
    performLocalReorderToIndex(draggedTimerId, dropIndex);
    return;
  }
  const targetId = Number(card.dataset.timerId);
  if (!Number.isInteger(targetId) || targetId === draggedTimerId) {
    clearDropIndicators();
    return;
  }
  const rect = card.getBoundingClientRect();
  const insertAfter = event.clientY - rect.top > rect.height / 2;
  clearDropIndicators();
  performLocalReorder(draggedTimerId, targetId, insertAfter);
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
      if (Array.isArray(data?.timers)) {
        applyTimerList(data.timers);
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

window.setInterval(() => {
  updateTimerDisplays();
}, 250);

fetchTimers();
connectStream();
