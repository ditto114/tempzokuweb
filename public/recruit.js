const DEFAULT_STATE = Object.freeze({
  title: '망용둥 5인',
  endHour: 5,
  endMinute: 58,
  positions: {
    roof: { name: '옥상', level: 189, job: '보마', price: 150, filled: true },
    second: { name: '2층', level: 0, job: '', price: 150, filled: false },
    center: { name: '경심/띱숍', level: 116, job: '프리', price: 150, price2: 100, filled: true },
    left: { name: '좌1', level: 120, job: '보마', price: 300, filled: true },
    right: { name: '우1', level: 131, job: '섀도', price: 300, filled: true },
  },
});

const DRAG_PIXEL_STEP = 8;

const elements = {
  titleInput: document.getElementById('recruit-title'),
  hourInput: document.getElementById('recruit-hour'),
  minuteInput: document.getElementById('recruit-minute'),
  preview: document.getElementById('recruit-preview'),
  plainOutput: document.getElementById('recruit-plain-output'),
  copyButton: document.getElementById('recruit-copy'),
  resetButton: document.getElementById('recruit-reset'),
  copyStatus: document.getElementById('recruit-copy-status'),
};

let state = cloneState(DEFAULT_STATE);
let activeDrag = null;

function cloneState(source) {
  return JSON.parse(JSON.stringify(source));
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

function formatSupportPosition(position, bindingKey, useHtml) {
  const prefix = position.filled ? '🟢' : '🔴';
  const priceValue = `${position.price}`;
  const priceText = useHtml
    ? `${wrapNumber(position.price, { binding: `positions.${bindingKey}.price`, step: 10, min: 0 })}지원`
    : `${priceValue}지원`;

  if (position.filled) {
    const level = useHtml
      ? wrapNumber(position.level, { binding: `positions.${bindingKey}.level`, step: 1, min: 0 })
      : position.level;
    return `${prefix}${position.name}: ${level}${displayText(position.job, useHtml)}(${priceText})`;
  }
  return `${prefix}${position.name}: 구인중(${priceText})`;
}

function formatDualSupportPosition(position, bindingKey, useHtml) {
  const prefix = position.filled ? '🟢' : '🔴';
  const price1 = useHtml
    ? wrapNumber(position.price, { binding: `positions.${bindingKey}.price`, step: 10, min: 0 })
    : position.price;
  const price2 = useHtml
    ? wrapNumber(position.price2, { binding: `positions.${bindingKey}.price2`, step: 10, min: 0 })
    : position.price2;
  const priceText = `${price1}/${price2}지원`;

  if (position.filled) {
    const level = useHtml
      ? wrapNumber(position.level, { binding: `positions.${bindingKey}.level`, step: 1, min: 0 })
      : position.level;
    return `${prefix}${position.name}: ${level}${displayText(position.job, useHtml)}(${priceText})`;
  }
  return `${prefix}${position.name}: 구인중(${priceText})`;
}

function formatStandardPosition(position, bindingKey, useHtml) {
  const prefix = position.filled ? '🟢' : '🔴';
  const priceText = useHtml
    ? wrapNumber(position.price, { binding: `positions.${bindingKey}.price`, step: 10, min: 0 })
    : position.price;

  if (position.filled) {
    const level = useHtml
      ? wrapNumber(position.level, { binding: `positions.${bindingKey}.level`, step: 1, min: 0 })
      : position.level;
    return `${prefix}${position.name}: ${level}${displayText(position.job, useHtml)}(${priceText})`;
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
  return `🐣 ${displayText(state.title, useHtml)} ${hour}:${minute}종료 🐣`;
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

function copyToClipboard() {
  const text = elements.plainOutput?.value || '';
  if (!text) {
    setCopyStatus('복사할 내용이 없습니다.', true);
    return;
  }
  if (navigator?.clipboard?.writeText) {
    navigator.clipboard
      .writeText(text)
      .then(() => setCopyStatus('복사 완료!'))
      .catch(() => fallbackCopy(text));
    return;
  }
  fallbackCopy(text);
}

function fallbackCopy(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'absolute';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand('copy');
    setCopyStatus('복사 완료!');
  } catch (error) {
    setCopyStatus('복사에 실패했습니다. 직접 복사해주세요.', true);
  } finally {
    textarea.remove();
  }
}

function setCopyStatus(message, isError = false) {
  if (!elements.copyStatus) return;
  elements.copyStatus.textContent = message;
  elements.copyStatus.classList.toggle('error', Boolean(isError));
}

function clearCopyStatus() {
  if (elements.copyStatus) {
    elements.copyStatus.textContent = '';
    elements.copyStatus.classList.remove('error');
  }
}

function resetState() {
  state = cloneState(DEFAULT_STATE);
  render();
  setCopyStatus('기본값을 불러왔습니다.');
}

function attachEvents() {
  document.querySelectorAll('[data-field-path]').forEach((input) => {
    input.addEventListener('input', handleInputChange);
    input.addEventListener('change', handleInputChange);
  });

  elements.titleInput?.addEventListener('input', handleBaseInput);
  elements.hourInput?.addEventListener('input', handleBaseInput);
  elements.minuteInput?.addEventListener('input', handleBaseInput);

  elements.preview?.addEventListener('mousedown', (event) => {
    const target = event.target.closest('.drag-number');
    if (target) {
      startNumberDrag(target, event);
    }
  });

  elements.copyButton?.addEventListener('click', copyToClipboard);
  elements.resetButton?.addEventListener('click', resetState);
}

attachEvents();
render();
