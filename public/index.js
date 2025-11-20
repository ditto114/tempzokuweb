const CHANNEL_STORAGE_KEY = 'timer_channels';
const KNOWN_CHANNEL_NAMES = Object.freeze({
  ca01: 'CASS 텔공대',
});

const openButton = document.getElementById('open-timer-channel');
const modal = document.getElementById('channel-modal');
const backdrop = document.getElementById('channel-modal-backdrop');
const channelListElement = document.getElementById('channel-list');
const emptyStateElement = document.getElementById('channel-empty');
const registerTrigger = document.getElementById('channel-register-button');
const registerForm = document.getElementById('channel-register-form');
const codeInput = document.getElementById('channel-code-input');
const nameInput = document.getElementById('channel-name-input');
const errorElement = document.getElementById('channel-modal-error');
const registerCancelButton = document.getElementById('channel-register-cancel');

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

function saveStoredChannels(channels) {
  try {
    localStorage.setItem(CHANNEL_STORAGE_KEY, JSON.stringify(channels));
  } catch (error) {
    // ignore
  }
}

function resolveChannelName(code, customName = '') {
  if (customName) {
    return customName;
  }
  const normalized = code.trim().toLowerCase();
  return KNOWN_CHANNEL_NAMES[normalized] || '등록된 채널';
}

function hideError() {
  if (errorElement) {
    errorElement.textContent = '';
    errorElement.classList.add('hidden');
  }
}

function showError(message) {
  if (!errorElement) {
    return;
  }
  errorElement.textContent = message;
  errorElement.classList.remove('hidden');
}

function renderChannelList() {
  if (!channelListElement || !emptyStateElement) {
    return;
  }
  const channels = loadStoredChannels();
  channelListElement.innerHTML = '';
  emptyStateElement.classList.toggle('hidden', channels.length > 0);
  channels.forEach((channel) => {
    const item = document.createElement('li');
    item.className = 'channel-list-item';

    const name = document.createElement('span');
    name.className = 'channel-name';
    name.textContent = resolveChannelName(channel.code, channel.name);

    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'primary';
    action.textContent = '접속하기';
    action.addEventListener('click', () => {
      window.location.href = `/timers.html?channelCode=${encodeURIComponent(channel.code)}`;
    });

    item.append(name, action);
    channelListElement.appendChild(item);
  });
}

function showChannelModal() {
  if (!modal || !backdrop) {
    return;
  }
  modal.classList.remove('hidden');
  backdrop.classList.remove('hidden');
  hideError();
  if (registerForm) {
    registerForm.classList.add('hidden');
  }
}

function hideChannelModal() {
  if (!modal || !backdrop) {
    return;
  }
  modal.classList.add('hidden');
  backdrop.classList.add('hidden');
  hideError();
}

function showRegisterForm() {
  if (!registerForm) {
    return;
  }
  hideError();
  registerForm.classList.remove('hidden');
  if (codeInput) {
    codeInput.value = '';
    codeInput.focus();
  }
  if (nameInput) {
    nameInput.value = '';
  }
}

function hideRegisterForm() {
  if (registerForm) {
    registerForm.classList.add('hidden');
  }
  hideError();
}

async function verifyChannelCode(code) {
  try {
    const response = await fetch(`/api/timers?channelCode=${encodeURIComponent(code)}`);
    return response.ok;
  } catch (error) {
    return false;
  }
}

async function handleRegisterSubmit(event) {
  event.preventDefault();
  if (!codeInput) {
    return;
  }

  hideError();
  const code = codeInput.value.trim();
  const customName = nameInput?.value.trim() || '';
  if (!code) {
    showError('채널 코드를 입력해주세요.');
    codeInput.focus();
    return;
  }

  const isValid = await verifyChannelCode(code);
  if (!isValid) {
    showError('유효하지 않은 채널 코드입니다. 다시 확인해주세요.');
    codeInput.focus();
    return;
  }

  const channels = loadStoredChannels();
  const channelName = resolveChannelName(code, customName);
  const normalizedCode = code.trim();
  const filtered = channels.filter((item) => item.code.toLowerCase() !== normalizedCode.toLowerCase());
  filtered.unshift({ code: normalizedCode, name: channelName });
  saveStoredChannels(filtered);
  renderChannelList();
  hideRegisterForm();
}

function attachChannelModalEvents() {
  if (openButton) {
    openButton.addEventListener('click', () => {
      renderChannelList();
      showChannelModal();
    });
  }
  if (registerTrigger) {
    registerTrigger.addEventListener('click', () => showRegisterForm());
  }
  if (registerCancelButton) {
    registerCancelButton.addEventListener('click', () => hideRegisterForm());
  }
  if (backdrop) {
    backdrop.addEventListener('click', () => hideChannelModal());
  }
  if (registerForm) {
    registerForm.addEventListener('submit', handleRegisterSubmit);
  }
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modal?.classList.contains('hidden')) {
      hideChannelModal();
    }
  });
}

renderChannelList();
attachChannelModalEvents();
