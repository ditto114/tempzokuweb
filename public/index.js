const CHANNEL_CODE_KEY = 'timer_channel_code';

const openButton = document.getElementById('open-timer-channel');
const modal = document.getElementById('channel-modal');
const backdrop = document.getElementById('channel-modal-backdrop');
const form = document.getElementById('channel-modal-form');
const input = document.getElementById('channel-code-input');
const errorElement = document.getElementById('channel-modal-error');
const cancelButton = document.getElementById('channel-modal-cancel');

function getStoredChannelCode() {
  try {
    return localStorage.getItem(CHANNEL_CODE_KEY) || '';
  } catch (error) {
    return '';
  }
}

function storeChannelCode(value) {
  try {
    localStorage.setItem(CHANNEL_CODE_KEY, value);
  } catch (error) {
    // ignore
  }
}

function showChannelModal() {
  if (!modal || !backdrop) {
    return;
  }
  modal.classList.remove('hidden');
  backdrop.classList.remove('hidden');
  if (errorElement) {
    errorElement.classList.add('hidden');
    errorElement.textContent = '';
  }
  const stored = getStoredChannelCode();
  if (input) {
    input.value = stored || 'ca01';
    input.focus();
    input.select();
  }
}

function hideChannelModal() {
  if (!modal || !backdrop) {
    return;
  }
  modal.classList.add('hidden');
  backdrop.classList.add('hidden');
}

function handleChannelSubmit(event) {
  event.preventDefault();
  if (!input) {
    return;
  }
  const code = input.value.trim();
  if (!code) {
    if (errorElement) {
      errorElement.textContent = '채널 코드를 입력해주세요.';
      errorElement.classList.remove('hidden');
    }
    input.focus();
    return;
  }
  storeChannelCode(code);
  window.location.href = `/timers.html?channelCode=${encodeURIComponent(code)}`;
}

function attachChannelModalEvents() {
  if (openButton) {
    openButton.addEventListener('click', () => showChannelModal());
  }
  if (cancelButton) {
    cancelButton.addEventListener('click', () => hideChannelModal());
  }
  if (backdrop) {
    backdrop.addEventListener('click', () => hideChannelModal());
  }
  if (form) {
    form.addEventListener('submit', handleChannelSubmit);
  }
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modal?.classList.contains('hidden')) {
      hideChannelModal();
    }
  });
}

attachChannelModalEvents();
