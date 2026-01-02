const DEFAULT_STATE = Object.freeze({
  title: '망용둥 5인',
  endHour: 5,
  endMinute: 58,
  showEndTime: true,
  guideMessage: '',
  positions: {
    roof: { name: '옥상', level: 189, job: '보마', price: 150, filled: true },
    second: { name: '2층', level: 0, job: '', price: 150, filled: false },
    center: { name: '경심/띱숍', level: 116, job: '프리', price: 150, price2: 100, filled: true },
    left: { name: '좌1', level: 120, job: '보마', price: 300, filled: true },
    right: { name: '우1', level: 131, job: '섀도', price: 300, filled: true },
  },
});

const DRAG_PIXEL_STEP = 8;
const JOB_OPTIONS = ['보마', '렌져', '신궁', '저격', '나로', '허밋', '섀도', '시프', '닼나', '용', '혀로', '프리', '숍'];
const LOCAL_STORAGE_KEY = 'recruit-state';
const DATA_FILE_NAME = 'recruit-data.json';
const PERSIST_DELAY = 220;

const elements = {
  titleInput: document.getElementById('recruit-title'),
  hourInput: document.getElementById('recruit-hour'),
  minuteInput: document.getElementById('recruit-minute'),
  showTimeInput: document.getElementById('recruit-show-time'),
  preview: document.getElementById('recruit-preview'),
  plainOutput: document.getElementById('recruit-plain-output'),
  guideInput: document.getElementById('recruit-guide-text'),
  copyButton: document.getElementById('recruit-copy'),
  guideCopyButton: document.getElementById('recruit-guide-copy'),
  resetButton: document.getElementById('recruit-reset'),
  copyStatus: document.getElementById('recruit-copy-status'),
  guideCopyStatus: document.getElementById('recruit-guide-copy-status'),
  connectStorageButton: document.getElementById('recruit-connect-storage'),
  storageStatus: document.getElementById('recruit-storage-status'),
};

let state = cloneState(DEFAULT_STATE);
let activeDrag = null;
let isHydrating = true;
let persistTimer = null;
const jobRouletteState = {
  overlay: null,
  wheel: null,
  options: [],
  binding: null,
  center: { x: 0, y: 0 },
  activeIndex: -1,
};
const storageState = {
  fileHandle: null,
  saveQueue: Promise.resolve(),
};

function cloneState(source) {
  return JSON.parse(JSON.stringify(source));
}

function mergePositionState(target, incoming) {
  if (!incoming || typeof incoming !== 'object') return;
  Object.keys(target).forEach((key) => {
    if (incoming[key] && typeof incoming[key] === 'object') {
      Object.assign(target[key], incoming[key]);
    }
  });
}

function applyLoadedState(nextState) {
  if (!nextState || typeof nextState !== 'object') return;
  const merged = cloneState(DEFAULT_STATE);
  merged.title = nextState.title ?? merged.title;
  merged.endHour = Number.isFinite(nextState.endHour) ? nextState.endHour : merged.endHour;
  merged.endMinute = Number.isFinite(nextState.endMinute) ? nextState.endMinute : merged.endMinute;
  merged.showEndTime = nextState.showEndTime ?? merged.showEndTime;
  merged.guideMessage =
    typeof nextState.guideMessage === 'string' ? nextState.guideMessage : merged.guideMessage;
  mergePositionState(merged.positions, nextState.positions);
  state = merged;
}

function loadStateFromLocalStorage() {
  try {
    const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!saved) return null;
    return JSON.parse(saved);
  } catch (error) {
    console.error('로컬 스토리지 로드 실패', error);
    return null;
  }
}

function saveStateToLocalStorage(snapshot) {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(snapshot));
  } catch (error) {
    console.error('로컬 스토리지 저장 실패', error);
  }
}

function openHandleDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('recruit-file-store', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('handles');
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

async function getStoredFileHandle() {
  if (!('indexedDB' in window)) return null;
  try {
    const db = await openHandleDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('handles', 'readonly');
      const store = tx.objectStore('handles');
      const request = store.get('data-file');
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('파일 핸들 로드 실패', error);
    return null;
  }
}

async function storeFileHandle(handle) {
  if (!('indexedDB' in window)) return;
  try {
    const db = await openHandleDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('handles', 'readwrite');
      const store = tx.objectStore('handles');
      const request = store.put(handle, 'data-file');
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('파일 핸들 저장 실패', error);
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function displayText(value, useHtml) {
  const text = String(value ?? '');
  return useHtml ? escapeHtml(text) : text;
}

function padTime(value) {
  const num = Number(value) || 0;
  return String(Math.max(0, Math.min(99, num))).padStart(2, '0');
}

function clampNumber(value, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

function getValueByPath(path) {
  return path.split('.').reduce((acc, segment) => (acc ? acc[segment] : undefined), state);
}

function setValueByPath(path, rawValue) {
  const parts = path.split('.');
  const last = parts.pop();
  let current = state;
  for (const part of parts) {
    if (current[part] === undefined) {
      current[part] = {};
    }
    current = current[part];
  }
  current[last] = rawValue;
}

function normalizeState() {
  state.endHour = clampNumber(Math.round(Number(state.endHour) || 0), 0, 23);
  state.endMinute = clampNumber(Math.round(Number(state.endMinute) || 0), 0, 59);
  state.showEndTime = Boolean(state.showEndTime);
  state.guideMessage = String(state.guideMessage ?? '');

  Object.keys(state.positions).forEach((key) => {
    const position = state.positions[key];
    position.level = clampNumber(Math.round(Number(position.level) || 0), 0, 400);
    position.price = clampNumber(Math.round(Number(position.price) || 0), 0, 100000);
    if (Object.prototype.hasOwnProperty.call(position, 'price2')) {
      position.price2 = clampNumber(Math.round(Number(position.price2) || 0), 0, 100000);
    }
    position.job = String(position.job ?? '');
    position.filled = Boolean(position.filled);
  });
}

function wrapNumber(value, { binding, step, min, max, pad = false }) {
  const numericValue = Number.isFinite(value) ? value : 0;
  const displayValue = pad ? padTime(numericValue) : String(numericValue);
  const minAttr = Number.isFinite(min) ? ` data-min="${min}"` : '';
  const maxAttr = Number.isFinite(max) ? ` data-max="${max}"` : '';
  return `<span class="drag-number" data-binding="${binding}" data-step="${step}"${minAttr}${maxAttr}>${escapeHtml(displayValue)}</span>`;
}

function formatStatusIndicator(position, bindingKey, useHtml) {
  const emoji = position.filled ? '🟢' : '🔴';
  if (!useHtml) {
    return emoji;
  }
  const binding = `positions.${bindingKey}.filled`;
  return `<span class="status-toggle" role="button" aria-pressed="${position.filled}" data-binding="${binding}" title="클릭해 구인 여부 전환">${emoji}</span>`;
}

function formatJobText(position, bindingKey, useHtml) {
  const text = position.job ?? '';
  if (!useHtml) {
    return displayText(text, useHtml);
  }
  const classes = ['job-text'];
  if (!text) {
    classes.push('job-text-empty');
  }
  const safeText = escapeHtml(text || '\u200b');
  const binding = `positions.${bindingKey}.job`;
  return `<span class="${classes.join(' ')}" data-job-binding="${binding}" data-placeholder="직업 선택" title="직업을 길게 눌러 변경">${safeText}</span>`;
}

function formatSupportPosition(position, bindingKey, useHtml) {
  const prefix = formatStatusIndicator(position, bindingKey, useHtml);
  const priceValue = `${position.price}`;
  const priceText = useHtml
    ? `${wrapNumber(position.price, { binding: `positions.${bindingKey}.price`, step: 10, min: 0 })}지원`
    : `${priceValue}지원`;

  if (position.filled) {
    const job = formatJobText(position, bindingKey, useHtml);
    const level = useHtml
      ? wrapNumber(position.level, { binding: `positions.${bindingKey}.level`, step: 1, min: 0 })
      : position.level;
    if (bindingKey === 'roof') {
      return `${prefix}${position.name}: ${level}${job}`;
    }
    return `${prefix}${position.name}: ${level}${job}(${priceText})`;
  }
  return `${prefix}${position.name}: 구인중(${priceText})`;
}

function formatDualSupportPosition(position, bindingKey, useHtml) {
  const prefix = formatStatusIndicator(position, bindingKey, useHtml);
  const price1 = useHtml
    ? wrapNumber(position.price, { binding: `positions.${bindingKey}.price`, step: 10, min: 0 })
    : position.price;
  const price2 = useHtml
    ? wrapNumber(position.price2, { binding: `positions.${bindingKey}.price2`, step: 10, min: 0 })
    : position.price2;
  const priceText = `${price1}/${price2}지원`;

  if (position.filled) {
    const job = formatJobText(position, bindingKey, useHtml);
    const level = useHtml
      ? wrapNumber(position.level, { binding: `positions.${bindingKey}.level`, step: 1, min: 0 })
      : position.level;
    return `${prefix}${position.name}: ${level}${job}(${priceText})`;
  }
  return `${prefix}${position.name}: 구인중(${priceText})`;
}

function formatStandardPosition(position, bindingKey, useHtml) {
  const prefix = formatStatusIndicator(position, bindingKey, useHtml);
  const priceText = useHtml
    ? wrapNumber(position.price, { binding: `positions.${bindingKey}.price`, step: 10, min: 0 })
    : position.price;

  if (position.filled) {
    const job = formatJobText(position, bindingKey, useHtml);
    const level = useHtml
      ? wrapNumber(position.level, { binding: `positions.${bindingKey}.level`, step: 1, min: 0 })
      : position.level;
    return `${prefix}${position.name}: ${level}${job}(${priceText})`;
  }
  return `${prefix}${position.name}: 구인중(${priceText})`;
}

function formatHeader(useHtml) {
  const hour = useHtml
    ? wrapNumber(state.endHour, { binding: 'endHour', step: 1, min: 0, max: 23, pad: true })
    : padTime(state.endHour);
  const minute = useHtml
    ? wrapNumber(state.endMinute, { binding: 'endMinute', step: 1, min: 0, max: 59, pad: true })
    : padTime(state.endMinute);
  const parts = [`🐣 ${displayText(state.title, useHtml)}`];
  if (state.showEndTime) {
    parts.push(`${hour}:${minute}종료`);
  }
  parts.push('🐣');
  return parts.join(' ');
}

function buildFormatted(useHtml = false) {
  const line1 = `${formatHeader(useHtml)} ${formatSupportPosition(state.positions.roof, 'roof', useHtml)}`;
  const line2 = `${formatStandardPosition(state.positions.second, 'second', useHtml)} ${formatDualSupportPosition(state.positions.center, 'center', useHtml)}`;
  const line3 = `${formatStandardPosition(state.positions.left, 'left', useHtml)} ${formatStandardPosition(state.positions.right, 'right', useHtml)}`;
  return [line1, line2, line3].join('\n');
}

function render(options = {}) {
  normalizeState();
  updateInputs();

  if (elements.preview) {
    elements.preview.innerHTML = buildFormatted(true);
    if (activeDrag?.binding) {
      const activeElement = elements.preview.querySelector(`[data-binding="${activeDrag.binding}"]`);
      if (activeElement) {
        activeElement.classList.add('drag-number-active');
      }
    }
  }

  if (elements.plainOutput) {
    elements.plainOutput.value = buildFormatted(false);
  }

  if (!options.silent) {
    clearCopyStatus();
    clearGuideCopyStatus();
  }

  if (!options.skipPersist && !isHydrating) {
    schedulePersist();
  }
}

function updateInputs() {
  if (elements.titleInput) {
    elements.titleInput.value = state.title ?? '';
  }
  if (elements.hourInput) {
    elements.hourInput.value = state.endHour ?? 0;
  }
  if (elements.minuteInput) {
    elements.minuteInput.value = state.endMinute ?? 0;
  }
  if (elements.showTimeInput) {
    elements.showTimeInput.checked = Boolean(state.showEndTime);
  }

  document.querySelectorAll('[data-field-path]').forEach((input) => {
    const path = input.getAttribute('data-field-path');
    const value = getValueByPath(path);
    if (input.type === 'checkbox') {
      input.checked = Boolean(value);
    } else if (input.type === 'number') {
      input.value = value ?? 0;
    } else {
      input.value = value ?? '';
    }
  });
}

function handleInputChange(event) {
  const target = event.target;
  const path = target.getAttribute('data-field-path');
  if (!path) {
    return;
  }

  if (target.type === 'checkbox') {
    setValueByPath(path, target.checked);
  } else if (target.type === 'number') {
    setValueByPath(path, Number(target.value) || 0);
  } else {
    setValueByPath(path, target.value);
  }
  render();
}

function handleBaseInput(event) {
  const { id, value } = event.target;
  if (id === 'recruit-title') {
    state.title = value;
  } else if (id === 'recruit-hour') {
    state.endHour = Number(value) || 0;
  } else if (id === 'recruit-minute') {
    state.endMinute = Number(value) || 0;
  } else if (id === 'recruit-show-time') {
    state.showEndTime = Boolean(event.target.checked);
  }
  render();
}

function startNumberDrag(target, event) {
  const binding = target.getAttribute('data-binding');
  if (!binding) return;

  event.preventDefault();

  const step = Number(target.getAttribute('data-step')) || 1;
  const min = target.getAttribute('data-min') !== null ? Number(target.getAttribute('data-min')) : Number.NEGATIVE_INFINITY;
  const max = target.getAttribute('data-max') !== null ? Number(target.getAttribute('data-max')) : Number.POSITIVE_INFINITY;
  const currentValue = Number(getValueByPath(binding)) || 0;

  activeDrag = {
    binding,
    startY: event.clientY,
    startValue: currentValue,
    step,
    min,
    max,
  };

  target.classList.add('drag-number-active');
  document.addEventListener('mousemove', handleDragMove);
  document.addEventListener('mouseup', stopNumberDrag);
}

function handleDragMove(event) {
  if (!activeDrag) return;
  const diff = activeDrag.startY - event.clientY;
  const steps = Math.trunc(diff / DRAG_PIXEL_STEP);
  const nextValue = clampNumber(activeDrag.startValue + steps * activeDrag.step, activeDrag.min, activeDrag.max);
  if (nextValue !== getValueByPath(activeDrag.binding)) {
    setValueByPath(activeDrag.binding, nextValue);
    render({ silent: true });
  }
}

function stopNumberDrag() {
  if (activeDrag?.binding && elements.preview) {
    const activeElement = elements.preview.querySelector(`[data-binding="${activeDrag.binding}"]`);
    if (activeElement) {
      activeElement.classList.remove('drag-number-active');
    }
  }
  activeDrag = null;
  document.removeEventListener('mousemove', handleDragMove);
  document.removeEventListener('mouseup', stopNumberDrag);
  render();
}

function toggleFilled(binding) {
  if (!binding) return;
  const currentValue = Boolean(getValueByPath(binding));
  setValueByPath(binding, !currentValue);
  render();
}

function positionRouletteOptions() {
  if (!jobRouletteState.wheel) return;
  const total = JOB_OPTIONS.length;
  const radius = 42;
  jobRouletteState.options.forEach((option, index) => {
    const angle = (index / total) * 360 - 90;
    const radians = (angle * Math.PI) / 180;
    const x = 50 + radius * Math.cos(radians);
    const y = 50 + radius * Math.sin(radians);
    option.style.left = `${x}%`;
    option.style.top = `${y}%`;
  });
}

function ensureJobRoulette() {
  if (jobRouletteState.overlay) return;

  const overlay = document.createElement('div');
  overlay.className = 'job-roulette';

  const wheel = document.createElement('div');
  wheel.className = 'job-roulette-wheel';
  overlay.appendChild(wheel);

  JOB_OPTIONS.forEach((label, index) => {
    const option = document.createElement('div');
    option.className = 'job-roulette-option';
    option.textContent = label;
    option.dataset.index = index;
    wheel.appendChild(option);
  });

  document.body.appendChild(overlay);
  jobRouletteState.overlay = overlay;
  jobRouletteState.wheel = wheel;
  jobRouletteState.options = Array.from(wheel.querySelectorAll('.job-roulette-option'));
  positionRouletteOptions();
}

function setActiveJobOption(index) {
  if (!jobRouletteState.options.length) return;
  jobRouletteState.activeIndex = index;
  jobRouletteState.options.forEach((option, optionIndex) => {
    option.classList.toggle('active', optionIndex === index);
  });
}

function updateJobOptionFromPointer(clientX, clientY) {
  if (!jobRouletteState.overlay || jobRouletteState.binding === null) return;
  const dx = clientX - jobRouletteState.center.x;
  const dy = clientY - jobRouletteState.center.y;
  if (dx === 0 && dy === 0) return;
  const rawAngle = Math.atan2(dy, dx) * (180 / Math.PI);
  const normalized = (rawAngle + 450) % 360; // shift so top = 0
  const segment = 360 / JOB_OPTIONS.length;
  const index = Math.floor(normalized / segment);
  setActiveJobOption(index);
}

function showJobRoulette(binding, event) {
  ensureJobRoulette();
  jobRouletteState.binding = binding;
  jobRouletteState.center = { x: event.clientX, y: event.clientY };
  setActiveJobOption(-1);

  jobRouletteState.wheel.style.left = `${event.clientX}px`;
  jobRouletteState.wheel.style.top = `${event.clientY}px`;
  jobRouletteState.overlay.classList.add('active');

  document.addEventListener('mousemove', handleJobRouletteMove);
  document.addEventListener('mouseup', handleJobRouletteEnd);
  updateJobOptionFromPointer(event.clientX, event.clientY);
}

function hideJobRoulette() {
  if (jobRouletteState.overlay) {
    jobRouletteState.overlay.classList.remove('active');
  }
  jobRouletteState.binding = null;
  jobRouletteState.center = { x: 0, y: 0 };
  jobRouletteState.activeIndex = -1;
  document.removeEventListener('mousemove', handleJobRouletteMove);
  document.removeEventListener('mouseup', handleJobRouletteEnd);
}

function handleJobRouletteMove(event) {
  updateJobOptionFromPointer(event.clientX, event.clientY);
}

function handleJobRouletteEnd() {
  if (jobRouletteState.binding && jobRouletteState.activeIndex >= 0) {
    const selectedJob = JOB_OPTIONS[jobRouletteState.activeIndex];
    setValueByPath(jobRouletteState.binding, selectedJob);
    render();
  }
  hideJobRoulette();
}

function copyToClipboard() {
  copyText({
    text: elements.plainOutput?.value || '',
    onSuccess: () => setCopyStatus('복사 완료!'),
    onEmpty: () => setCopyStatus('복사할 내용이 없습니다.', true),
    onFailure: () => setCopyStatus('복사에 실패했습니다. 직접 복사해주세요.', true),
  });
}

function copyGuideToClipboard() {
  copyText({
    text: elements.guideInput?.value || '',
    onSuccess: () => setGuideCopyStatus('안내멘트를 복사했습니다.'),
    onEmpty: () => setGuideCopyStatus('복사할 안내멘트가 없습니다.', true),
    onFailure: () => setGuideCopyStatus('복사에 실패했습니다. 직접 복사해주세요.', true),
  });
}

function copyText({ text, onSuccess, onEmpty, onFailure }) {
  const content = text ?? '';
  if (!content.trim()) {
    onEmpty?.();
    return;
  }

  const fallbackCopy = () => {
    const textarea = document.createElement('textarea');
    textarea.value = content;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'absolute';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    let success = false;
    try {
      success = document.execCommand('copy');
    } catch (error) {
      success = false;
    } finally {
      textarea.remove();
    }
    if (success) {
      onSuccess?.();
    } else {
      onFailure?.();
    }
  };

  if (navigator?.clipboard?.writeText) {
    navigator.clipboard.writeText(content).then(onSuccess).catch(fallbackCopy);
    return;
  }
  fallbackCopy();
}

function setCopyStatus(message, isError = false) {
  if (!elements.copyStatus) return;
  elements.copyStatus.textContent = message;
  elements.copyStatus.classList.toggle('error', Boolean(isError));
}

function setGuideCopyStatus(message, isError = false) {
  if (!elements.guideCopyStatus) return;
  elements.guideCopyStatus.textContent = message;
  elements.guideCopyStatus.classList.toggle('error', Boolean(isError));
}

function clearCopyStatus() {
  if (elements.copyStatus) {
    elements.copyStatus.textContent = '';
    elements.copyStatus.classList.remove('error');
  }
}

function clearGuideCopyStatus() {
  if (elements.guideCopyStatus) {
    elements.guideCopyStatus.textContent = '';
    elements.guideCopyStatus.classList.remove('error');
  }
}

function setStorageStatus(message, isError = false) {
  if (!elements.storageStatus || !message) return;
  elements.storageStatus.textContent = message;
  elements.storageStatus.classList.toggle('error', Boolean(isError));
}

function clearStorageStatus() {
  if (elements.storageStatus) {
    elements.storageStatus.textContent = '';
    elements.storageStatus.classList.remove('error');
  }
}

function schedulePersist() {
  if (persistTimer) {
    clearTimeout(persistTimer);
  }
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistState();
  }, PERSIST_DELAY);
}

async function ensureFilePermission(handle, requestWrite = false) {
  if (!handle?.queryPermission) return false;
  const options = { mode: 'readwrite' };
  let permission = await handle.queryPermission(options);
  if (permission === 'granted') return true;
  if (!requestWrite) return false;
  permission = await handle.requestPermission(options);
  return permission === 'granted';
}

async function writeStateToFile(handle, snapshot) {
  try {
    const allowed = await ensureFilePermission(handle, true);
    if (!allowed) {
      setStorageStatus('데이터 파일 저장 권한을 허용해주세요.', true);
      return;
    }
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(snapshot, null, 2));
    await writable.close();
    setStorageStatus(`${DATA_FILE_NAME}에 저장했습니다.`);
  } catch (error) {
    console.error('파일 저장 실패', error);
    setStorageStatus('데이터 파일 저장 중 오류가 발생했습니다.', true);
  }
}

async function persistState() {
  const snapshot = cloneState(state);
  saveStateToLocalStorage(snapshot);
  if (storageState.fileHandle) {
    storageState.saveQueue = storageState.saveQueue
      .catch(() => {})
      .then(() => writeStateToFile(storageState.fileHandle, snapshot));
  }
}

async function readStateFromFile(handle) {
  try {
    const allowed = await ensureFilePermission(handle, true);
    if (!allowed) {
      setStorageStatus('데이터 파일 읽기 권한을 허용해주세요.', true);
      return null;
    }
    const file = await handle.getFile();
    const text = await file.text();
    const parsed = JSON.parse(text || '{}');
    setStorageStatus(`${DATA_FILE_NAME}에서 불러왔습니다.`);
    return parsed;
  } catch (error) {
    console.error('파일 읽기 실패', error);
    setStorageStatus('데이터 파일을 읽을 수 없습니다. JSON 형식을 확인해주세요.', true);
    return null;
  }
}

async function promptForDataFile() {
  if (!('showSaveFilePicker' in window) && !('showOpenFilePicker' in window)) {
    setStorageStatus('브라우저가 파일 저장을 지원하지 않아 JSON 파일을 사용할 수 없습니다.', true);
    return null;
  }

  try {
    if ('showSaveFilePicker' in window) {
      return await window.showSaveFilePicker({
        suggestedName: DATA_FILE_NAME,
        types: [{ description: 'JSON 파일', accept: { 'application/json': ['.json'] } }],
      });
    }
    const [handle] = await window.showOpenFilePicker({
      multiple: false,
      types: [{ description: 'JSON 파일', accept: { 'application/json': ['.json'] } }],
    });
    return handle;
  } catch (error) {
    if (error?.name !== 'AbortError') {
      console.error('파일 선택 실패', error);
      setStorageStatus('데이터 파일을 선택하지 못했습니다.', true);
    } else {
      setStorageStatus('파일 선택이 취소되었습니다.', true);
    }
    return null;
  }
}

async function connectSavedFileHandle() {
  const savedHandle = await getStoredFileHandle();
  if (!savedHandle) return;
  const allowed = await ensureFilePermission(savedHandle, false);
  if (!allowed) return;
  storageState.fileHandle = savedHandle;
  const loaded = await readStateFromFile(savedHandle);
  if (loaded) {
    applyLoadedState(loaded);
    render({ skipPersist: true, silent: true });
  }
}

async function handleConnectStorage() {
  clearStorageStatus();
  const handle = await promptForDataFile();
  if (!handle) return;
  const allowed = await ensureFilePermission(handle, true);
  if (!allowed) {
    setStorageStatus('파일 접근 권한이 없어 저장할 수 없습니다.', true);
    return;
  }

  storageState.fileHandle = handle;
  await storeFileHandle(handle);
  const loaded = await readStateFromFile(handle);
  if (loaded) {
    applyLoadedState(loaded);
    render({ skipPersist: true, silent: true });
  } else {
    setStorageStatus(`${DATA_FILE_NAME} 파일을 새로 생성합니다.`);
  }
  schedulePersist();
}

function resetState() {
  state = cloneState(DEFAULT_STATE);
  render();
  setCopyStatus('기본값을 불러왔습니다.');
}

function handlePreviewClick(event) {
  const statusToggle = event.target.closest('.status-toggle');
  if (statusToggle) {
    const binding = statusToggle.getAttribute('data-binding');
    toggleFilled(binding);
  }
}

function handlePreviewMouseDown(event) {
  if (event.button !== 0) return;

  const statusToggle = event.target.closest('.status-toggle');
  if (statusToggle) {
    event.preventDefault();
    return;
  }

  const numberTarget = event.target.closest('.drag-number');
  if (numberTarget) {
    startNumberDrag(numberTarget, event);
    return;
  }

  const jobTarget = event.target.closest('.job-text');
  if (jobTarget) {
    const binding = jobTarget.getAttribute('data-job-binding');
    if (binding) {
      event.preventDefault();
      showJobRoulette(binding, event);
    }
  }
}

async function hydrateState() {
  const savedLocal = loadStateFromLocalStorage();
  if (savedLocal) {
    applyLoadedState(savedLocal);
  }
  await connectSavedFileHandle();
  if (!storageState.fileHandle) {
    setStorageStatus('JSON 파일과 연결하면 동일 폴더에 자동 저장됩니다.');
  }
  isHydrating = false;
}

function attachEvents() {
  document.querySelectorAll('[data-field-path]').forEach((input) => {
    input.addEventListener('input', handleInputChange);
    input.addEventListener('change', handleInputChange);
  });

  elements.titleInput?.addEventListener('input', handleBaseInput);
  elements.hourInput?.addEventListener('input', handleBaseInput);
  elements.minuteInput?.addEventListener('input', handleBaseInput);

  elements.preview?.addEventListener('mousedown', handlePreviewMouseDown);
  elements.preview?.addEventListener('click', handlePreviewClick);

  elements.copyButton?.addEventListener('click', copyToClipboard);
  elements.guideCopyButton?.addEventListener('click', copyGuideToClipboard);
  elements.resetButton?.addEventListener('click', resetState);
  elements.showTimeInput?.addEventListener('change', handleBaseInput);
  elements.connectStorageButton?.addEventListener('click', handleConnectStorage);
}

attachEvents();
hydrateState().finally(() => {
  render({ skipPersist: true });
  isHydrating = false;
  schedulePersist();
});
