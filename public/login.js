function getRedirectTarget() {
  const params = new URLSearchParams(window.location.search);
  const redirect = params.get('redirect');
  if (redirect && redirect.startsWith('/')) {
    return redirect;
  }
  return '/distribution.html';
}

const GUILD_TO_USERNAME = Object.freeze({
  cass: 'cass',
  healing: 'healing',
});

function detectGuildHint() {
  const params = new URLSearchParams(window.location.search);
  const directGuild = params.get('guild');
  if (directGuild && GUILD_TO_USERNAME[directGuild]) {
    return directGuild;
  }
  // 서버가 /login.html?redirect=/distribution.html?guild=xxx 로 돌려보낸 경우 대비
  const redirect = params.get('redirect');
  if (redirect) {
    const queryStart = redirect.indexOf('?');
    if (queryStart !== -1) {
      const nested = new URLSearchParams(redirect.slice(queryStart + 1));
      const nestedGuild = nested.get('guild');
      if (nestedGuild && GUILD_TO_USERNAME[nestedGuild]) {
        return nestedGuild;
      }
    }
  }
  return null;
}

function prefillFromGuildHint() {
  const guild = detectGuildHint();
  if (!guild) {
    return;
  }
  const usernameInput = document.getElementById('username');
  const passwordInput = document.getElementById('password');
  if (usernameInput && !usernameInput.value) {
    usernameInput.value = GUILD_TO_USERNAME[guild];
    usernameInput.readOnly = true;
    usernameInput.classList.add('prefilled');
  }
  if (passwordInput) {
    passwordInput.focus();
  }
}

function showError(message) {
  const errorElement = document.getElementById('login-error');
  if (errorElement) {
    errorElement.textContent = message || '';
    if (message) {
      errorElement.classList.add('visible');
    } else {
      errorElement.classList.remove('visible');
    }
  }
}

async function checkExistingSession() {
  try {
    const response = await fetch('/api/session');
    if (response.ok) {
      const data = await response.json();
      if (data?.authenticated) {
        window.location.replace(getRedirectTarget());
        return true;
      }
    }
  } catch (error) {
    // ignore errors during session check
  }
  return false;
}

async function handleLoginSubmit(event) {
  event.preventDefault();
  showError('');

  const form = event.currentTarget;
  const formData = new FormData(form);
  const username = formData.get('username');
  const password = formData.get('password');

  if (!username || !password) {
    showError('아이디와 비밀번호를 모두 입력해주세요.');
    return;
  }

  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username, password }),
    });

    if (!response.ok) {
      if (response.status === 401) {
        showError('아이디 또는 비밀번호가 올바르지 않습니다.');
      } else {
        showError('로그인 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.');
      }
      return;
    }

    const data = await response.json();
    if (data?.authenticated) {
      window.location.replace(getRedirectTarget());
    } else {
      showError('로그인에 실패했습니다. 다시 시도해주세요.');
    }
  } catch (error) {
    showError('로그인 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.');
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  const alreadyLoggedIn = await checkExistingSession();
  if (alreadyLoggedIn) {
    return;
  }

  prefillFromGuildHint();

  const form = document.getElementById('login-form');
  if (form) {
    form.addEventListener('submit', handleLoginSubmit);
  }
});
