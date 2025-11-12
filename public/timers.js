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
let editingTimerId = null;
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

  const nameLabel = document.createElement('span');
  nameLabel.className = 'timer-card-name';
  nameLabel.textContent = timer.name;

  infoHeader.appendChild(repeatButton);
  infoHeader.appendChild(nameLabel);

  const display = document.createElement('div');
  display.className = 'timer-card-display';
  const remaining = getTimerRemaining(timer);
  display.textContent = formatTimerDisplay(remaining);
  if (!timer.isRunning && remaining === 0) {
    display.classList.add('finished');
  } else if (remaining > 0 && remaining <= 60 * 1000) {
    display.classList.add('critical');
  }
  timerDisplays.set(timer.id, display);

  const secondaryActions = document.createElement('div');
  secondaryActions.className = 'timer-card-secondary-actions';

  const auxButton = document.createElement('button');
  auxButton.type = 'button';
  auxButton.className = 'tertiary';
  if (timer.isRunning) {
    auxButton.textContent = '일시정지';
    auxButton.addEventListener('click', () => pauseTimer(timer.id));
  } else {
    auxButton.textContent = '초기화';
    auxButton.addEventListener('click', () => resetTimer(timer.id));
  }
  secondaryActions.appendChild(auxButton);

  info.appendChild(infoHeader);
  info.appendChild(display);
  info.appendChild(secondaryActions);

  if (isEditMode && editingTimerId === timer.id) {
    info.appendChild(createEditPanel(timer));
  }

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

  const actionButton = document.createElement('button');
  actionButton.type = 'button';
  actionButton.className = 'timer-card-action';

  if (isEditMode) {
    actionButton.classList.add('secondary');
    actionButton.textContent = '수정';
    actionButton.addEventListener('click', () => openEditPanel(timer.id));
  } else {
    actionButton.classList.add(timer.isRunning ? 'danger' : 'primary');
    actionButton.textContent = timer.isRunning ? '리셋' : '시작';
    actionButton.addEventListener('click', () => {
      if (timer.isRunning) {
        resetTimer(timer.id);
      } else {
        startTimer(timer.id);
      }
    });
  }

  card.appendChild(info);
  card.appendChild(progress);
  card.appendChild(actionButton);

  return card;
}

function createEditPanel(timer) {
  const panel = document.createElement('div');
  panel.className = 'timer-edit-panel';

  const nameLabel = document.createElement('label');
  nameLabel.textContent = '타이머 이름';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.value = timer.name;
  nameInput.maxLength = 50;
  nameLabel.appendChild(nameInput);

  const durationWrapper = document.createElement('div');
  durationWrapper.className = 'timer-edit-duration';

  const minuteLabel = document.createElement('label');
  minuteLabel.textContent = '분';
  const minuteInput = document.createElement('input');
  minuteInput.type = 'number';
  minuteInput.min = '0';
  minuteInput.max = '180';
  minuteInput.value = String(Math.floor(timer.durationMs / 60000));
  minuteLabel.appendChild(minuteInput);

  const secondLabel = document.createElement('label');
  secondLabel.textContent = '초';
  const secondInput = document.createElement('input');
  secondInput.type = 'number';
  secondInput.min = '0';
  secondInput.max = '59';
  secondInput.value = String(Math.floor((timer.durationMs % 60000) / 1000)).padStart(2, '0');
  secondLabel.appendChild(secondInput);

  durationWrapper.appendChild(minuteLabel);
  durationWrapper.appendChild(secondLabel);

  const actionRow = document.createElement('div');
  actionRow.className = 'timer-edit-actions';

  const saveButton = document.createElement('button');
  saveButton.type = 'button';
  saveButton.className = 'primary';
  saveButton.textContent = '저장';
  saveButton.addEventListener('click', async () => {
    const name = nameInput.value.trim() || timer.name;
    const minutes = Number(minuteInput.value);
    const seconds = Number(secondInput.value);
    const safeMinutes = Number.isFinite(minutes) ? Math.max(0, Math.floor(minutes)) : 0;
    const safeSeconds = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
    const clampedSeconds = Math.min(59, safeSeconds);
    minuteInput.value = String(safeMinutes);
    secondInput.value = String(clampedSeconds).padStart(2, '0');
    const totalSeconds = safeMinutes * 60 + clampedSeconds;
    const durationMs = clampTimerDuration(totalSeconds * 1000);

    if (durationMs < MIN_TIMER_DURATION_MS) {
      alert('타이머 시간은 최소 5초 이상이어야 합니다.');
      return;
    }

    await updateTimer(timer.id, { name, duration: durationMs });
    closeEditPanel();
  });

  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'secondary';
  cancelButton.textContent = '취소';
  cancelButton.addEventListener('click', () => closeEditPanel());

  actionRow.appendChild(saveButton);
  actionRow.appendChild(cancelButton);

  panel.appendChild(nameLabel);
  panel.appendChild(durationWrapper);
  panel.appendChild(actionRow);

  window.setTimeout(() => {
    nameInput.focus();
  }, 0);

  return panel;
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
    fragment.appendChild(emptyMessage);
  } else {
    sortedTimers.forEach((timer) => {
      fragment.appendChild(createTimerCard(timer));
    });
  }

  timerListElement.appendChild(fragment);
  updateTimerDisplays();
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

async function pauseTimer(id) {
  try {
    const timer = await requestJson(`/api/timers/${id}/pause`, { method: 'POST' });
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

function openEditPanel(id) {
  editingTimerId = id;
  renderTimers();
}

function closeEditPanel() {
  editingTimerId = null;
  renderTimers();
}

function toggleEditMode() {
  isEditMode = !isEditMode;
  if (!isEditMode) {
    editingTimerId = null;
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
  timerListElement.querySelectorAll('.timer-card').forEach((card) => {
    card.classList.remove('dragging', 'drop-target', 'drop-target-before', 'drop-target-after');
  });
}

function handleDragStart(event) {
  if (!isEditMode || !event.currentTarget) {
    event.preventDefault();
    return;
  }
  if (!event.target || !event.target.closest('.timer-card-drag-handle')) {
    event.preventDefault();
    return;
  }
  const card = event.currentTarget;
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

function handleDrop(event) {
  if (!isEditMode || draggedTimerId == null || !event.currentTarget) {
    return;
  }
  event.preventDefault();
  const card = event.currentTarget;
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
