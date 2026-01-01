(() => {
  const socket = io({ transports: ['websocket'] });
  const STORAGE_KEY = 'yut-session';
  const COLOR_FALLBACK = '#4b5563';
  const NODE_POSITIONS = {
    START: { x: 50, y: 94 },
    O1: { x: 36, y: 88 },
    O2: { x: 22, y: 82 },
    O3: { x: 14, y: 68 },
    O4: { x: 10, y: 52 },
    O5: { x: 12, y: 36 },
    O6: { x: 16, y: 20 },
    O7: { x: 32, y: 12 },
    O8: { x: 48, y: 10 },
    O9: { x: 64, y: 12 },
    O10: { x: 80, y: 20 },
    O11: { x: 90, y: 34 },
    O12: { x: 92, y: 50 },
    O13: { x: 90, y: 66 },
    O14: { x: 80, y: 80 },
    O15: { x: 66, y: 88 },
    O16: { x: 52, y: 90 },
    O17: { x: 38, y: 90 },
    O18: { x: 24, y: 90 },
    O19: { x: 50, y: 74 },
    D1: { x: 28, y: 46 },
    D2: { x: 44, y: 32 },
    D3: { x: 62, y: 44 },
    D4: { x: 78, y: 58 },
    CENTER: { x: 50, y: 58 },
    END: { x: 50, y: 18 },
  };

  const BOARD_EDGES = [
    ['START', 'O1'], ['O1', 'O2'], ['O2', 'O3'], ['O3', 'O4'], ['O4', 'O5'],
    ['O5', 'O6'], ['O6', 'O7'], ['O7', 'O8'], ['O8', 'O9'], ['O9', 'O10'],
    ['O10', 'O11'], ['O11', 'O12'], ['O12', 'O13'], ['O13', 'O14'], ['O14', 'O15'],
    ['O15', 'O16'], ['O16', 'O17'], ['O17', 'O18'], ['O18', 'O19'], ['O19', 'END'],
    ['O5', 'D1'], ['D1', 'D2'], ['D2', 'CENTER'], ['CENTER', 'O15'],
    ['O10', 'D3'], ['D3', 'D4'], ['D4', 'CENTER'],
  ];

  const els = {
    roomList: document.getElementById('room-list'),
    roomEmpty: document.getElementById('room-empty'),
    createForm: document.getElementById('create-room-form'),
    createName: document.getElementById('create-room-name'),
    createNick: document.getElementById('create-nickname'),
    createMax: document.getElementById('create-max'),
    createPassword: document.getElementById('create-password'),
    createBackdo: document.getElementById('create-backdo'),
    createPieces: document.getElementById('create-pieces'),
    joinForm: document.getElementById('join-room-form'),
    joinRoomId: document.getElementById('join-room-id'),
    joinNick: document.getElementById('join-nickname'),
    joinPassword: document.getElementById('join-password'),
    joinSpectator: document.getElementById('join-spectator'),
    reconnect: document.getElementById('reconnect'),
    boardSvg: document.getElementById('yut-board'),
    tokenLayer: document.getElementById('yut-token-layer'),
    nodeLayer: document.getElementById('yut-nodes'),
    pending: document.getElementById('pending-results'),
    rollButton: document.getElementById('roll-button'),
    moveButton: document.getElementById('move-button'),
    skipButton: document.getElementById('skip-button'),
    diagonalToggle: document.getElementById('diagonal-toggle'),
    soundToggle: document.getElementById('sound-toggle'),
    readyButton: document.getElementById('ready-button'),
    startButton: document.getElementById('start-button'),
    restartButton: document.getElementById('restart-button'),
    dummyButton: document.getElementById('dummy-button'),
    playerList: document.getElementById('player-list'),
    activityLog: document.getElementById('activity-log'),
    chatBox: document.getElementById('chat-box'),
    chatForm: document.getElementById('chat-form'),
    chatInput: document.getElementById('chat-input'),
    statusText: document.getElementById('status-text'),
    rollResult: document.getElementById('roll-result'),
    roomTitle: document.getElementById('room-title'),
    roomSubtitle: document.getElementById('room-subtitle'),
    roomBadges: document.getElementById('room-badges'),
    toast: document.getElementById('toast'),
    refreshRooms: document.getElementById('refresh-rooms'),
  };

  const state = {
    room: null,
    selfId: null,
    selectedPiece: null,
    selectedResultIndex: 0,
    diagonal: false,
    sound: true,
  };

  function showToast(message) {
    if (!els.toast) return;
    els.toast.textContent = message;
    els.toast.classList.add('show');
    setTimeout(() => els.toast.classList.remove('show'), 1800);
  }

  function playSound() {
    if (!state.sound || typeof window.AudioContext !== 'function') return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 480;
    gain.gain.value = 0.08;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.12);
  }

  function saveSession(roomId, playerId, nickname) {
    try {
      const payload = { roomId, playerId, nickname };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      els.reconnect?.classList.remove('hidden');
    } catch (error) {
      // ignore
    }
  }

  function loadSession() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (error) {
      return null;
    }
  }

  function clearSession() {
    localStorage.removeItem(STORAGE_KEY);
    els.reconnect?.classList.add('hidden');
  }

  function renderRooms(rooms = []) {
    if (!els.roomList) return;
    els.roomList.innerHTML = '';
    els.roomEmpty.classList.toggle('hidden', rooms.length > 0);
    rooms.forEach((room) => {
      const item = document.createElement('div');
      item.className = 'room-item';
      const info = document.createElement('div');
      const badge = room.allowBackDo ? '빽도 ON' : '빽도 OFF';
      info.innerHTML = `<strong>${room.name}</strong><span class="yut-meta">${room.playerCount}/${room.maxPlayers} · ${badge} ${room.hasPassword ? ' · 🔒' : ''}</span>`;
      const actions = document.createElement('div');
      actions.className = 'room-actions';
      const joinBtn = document.createElement('button');
      joinBtn.className = 'primary';
      joinBtn.textContent = '입장';
      joinBtn.addEventListener('click', () => {
        els.joinRoomId.value = room.id;
        els.joinNick.focus();
      });
      actions.appendChild(joinBtn);
      item.append(info, actions);
      els.roomList.appendChild(item);
    });
  }

  function drawBoard() {
    if (!els.boardSvg || !els.nodeLayer) return;
    els.boardSvg.innerHTML = '';
    els.nodeLayer.innerHTML = '';
    const pathGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    pathGroup.setAttribute('stroke', '#c49b66');
    pathGroup.setAttribute('stroke-width', '2');
    pathGroup.setAttribute('fill', 'none');

    BOARD_EDGES.forEach(([from, to]) => {
      const a = NODE_POSITIONS[from];
      const b = NODE_POSITIONS[to];
      if (!a || !b) return;
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', a.x);
      line.setAttribute('y1', a.y);
      line.setAttribute('x2', b.x);
      line.setAttribute('y2', b.y);
      pathGroup.appendChild(line);
    });

    els.boardSvg.appendChild(pathGroup);

    Object.entries(NODE_POSITIONS).forEach(([key, value]) => {
      const node = document.createElement('div');
      node.className = 'yut-node';
      if (key === 'START') node.classList.add('start');
      if (key === 'END') node.classList.add('end');
      node.style.left = `${value.x}%`;
      node.style.top = `${value.y}%`;
      node.title = key;
      els.nodeLayer.appendChild(node);
    });
  }

  function getPlayerColor(playerId) {
    if (!state.room) return COLOR_FALLBACK;
    const player = state.room.players?.find((p) => p.id === playerId);
    return player?.color || COLOR_FALLBACK;
  }

  function getCurrentPlayerId() {
    const game = state.room?.game;
    if (!game || !Array.isArray(game.turnOrder)) return null;
    return game.turnOrder[game.currentTurnIndex] || null;
  }

  function renderBoardTokens() {
    if (!els.tokenLayer) return;
    els.tokenLayer.innerHTML = '';
    if (!state.room) return;

    const board = new Map();
    const players = state.room.players || [];
    players.forEach((player) => {
      player.pieces.forEach((piece) => {
        const key = piece.position;
        if (!board.has(key)) board.set(key, []);
        board.get(key).push({ playerId: player.id, pieceId: piece.id });
      });
    });

    board.forEach((pieces, position) => {
      const coord = NODE_POSITIONS[position];
      if (!coord) return;
      const byOwner = pieces.reduce((acc, entry) => {
        const arr = acc[entry.playerId] || [];
        arr.push(entry);
        acc[entry.playerId] = arr;
        return acc;
      }, {});

      Object.entries(byOwner).forEach(([playerId, ownedPieces], idx) => {
        const token = document.createElement('div');
        token.className = 'yut-token';
        token.style.left = `${coord.x + idx * 3}%`;
        token.style.top = `${coord.y + idx * 3}%`;
        token.style.backgroundColor = getPlayerColor(playerId);
        if (playerId === getCurrentPlayerId()) {
          token.classList.add('turn');
        }
        token.textContent = ownedPieces.length === 1 ? ownedPieces[0].pieceId.toUpperCase() : `${ownedPieces.length}말`;
        const stack = document.createElement('span');
        stack.className = 'stack';
        stack.textContent = position;
        token.appendChild(stack);
        token.addEventListener('click', () => {
          state.selectedPiece = { playerId, pieceId: ownedPieces[0].pieceId, position };
          showToast(`${position}의 말을 선택했습니다.`);
        });
        els.tokenLayer.appendChild(token);
      });
    });
  }

  function renderPending() {
    if (!els.pending) return;
    els.pending.innerHTML = '';
    const pending = state.room?.game?.pendingResults || [];
    if (state.selectedResultIndex >= pending.length) {
      state.selectedResultIndex = 0;
    }
    pending.forEach((result, index) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'pending-chip';
      if (index === state.selectedResultIndex) chip.classList.add('active');
      chip.textContent = `${result.label} (${result.value})`;
      chip.addEventListener('click', () => {
        state.selectedResultIndex = index;
        renderPending();
      });
      els.pending.appendChild(chip);
    });
  }

  function renderPlayers() {
    if (!els.playerList) return;
    els.playerList.innerHTML = '';
    const players = state.room?.players || [];
    const currentId = getCurrentPlayerId();
    players.forEach((player) => {
      const card = document.createElement('div');
      card.className = 'player-card';
      const header = document.createElement('div');
      header.className = 'player-name';
      const dot = document.createElement('span');
      dot.className = 'player-dot';
      dot.style.backgroundColor = getPlayerColor(player.id);
      const name = document.createElement('span');
      name.textContent = `${player.name}${player.id === state.selfId ? ' (나)' : ''}`;
      header.append(dot, name);
      const meta = document.createElement('div');
      meta.className = 'yut-meta';
      const turnMark = player.id === currentId ? '🔥 턴 진행 중' : '';
      meta.textContent = `${player.isHost ? '방장 · ' : ''}${player.isReady ? '준비완료' : '대기중'}${turnMark ? ' · ' + turnMark : ''}`;
      const finished = document.createElement('div');
      finished.className = 'badge';
      finished.textContent = `완주: ${player.finishedCount}/${state.room?.pieceCount ?? 4}`;
      card.append(header, meta, finished);
      els.playerList.appendChild(card);
    });
  }

  function renderLogs() {
    if (!els.activityLog) return;
    els.activityLog.innerHTML = '';
    const logs = state.room?.game?.activityLog || [];
    logs.forEach((log) => {
      const row = document.createElement('div');
      row.className = 'chat-row';
      row.textContent = log.message;
      els.activityLog.appendChild(row);
    });
    els.activityLog.scrollTop = els.activityLog.scrollHeight;
  }

  function renderChat() {
    if (!els.chatBox) return;
    els.chatBox.innerHTML = '';
    const chats = state.room?.chat || [];
    chats.forEach((chat) => {
      const row = document.createElement('div');
      row.className = 'chat-row';
      row.innerHTML = `<strong>${chat.sender}</strong>: ${chat.text}`;
      els.chatBox.appendChild(row);
    });
    els.chatBox.scrollTop = els.chatBox.scrollHeight;
  }

  function renderRoomMeta() {
    if (!state.room) {
      els.roomTitle.textContent = '대기 중';
      els.roomSubtitle.textContent = '방을 선택하세요.';
      els.roomBadges.innerHTML = '';
      return;
    }
    els.roomTitle.textContent = `${state.room.name} (${state.room.id})`;
    els.roomSubtitle.textContent = `인원 ${state.room.players.length}/${state.room.maxPlayers}`;
    els.roomBadges.innerHTML = '';
    const badges = [
      state.room.allowBackDo ? '빽도 허용' : '빽도 없음',
      `말 ${state.room.pieceCount}개`,
      `상태: ${state.room.game?.status || '대기'}`,
    ];
    badges.forEach((text) => {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = text;
      els.roomBadges.appendChild(badge);
    });
  }

  function renderStatus() {
    if (!els.statusText) return;
    if (!state.room) {
      els.statusText.textContent = '방에 입장하고 준비를 눌러주세요.';
      return;
    }
    if (state.room.game?.status === 'finished') {
      const winnerId = state.room.game?.winnerIds?.[0];
      const winner = state.room.players.find((p) => p.id === winnerId);
      els.statusText.textContent = `${winner?.name || '플레이어'}가 승리했습니다.`;
      return;
    }
    if (state.room.game?.status !== 'playing') {
      els.statusText.textContent = '준비가 끝나면 방장이 시작할 수 있습니다.';
      return;
    }
    const current = getCurrentPlayerId();
    const player = state.room.players.find((p) => p.id === current);
    const isMyTurn = current === state.selfId;
    const quota = state.room.game.throwQuota;
    els.statusText.textContent = `${player?.name || '플레이어'}의 턴 · 던질 기회 ${quota}회` + (isMyTurn ? ' (내 턴)' : '');
  }

  function renderControls() {
    const status = state.room?.game?.status;
    const myPlayer = state.room?.players?.find((p) => p.id === state.selfId);
    const isHost = myPlayer?.isHost;
    const myTurn = getCurrentPlayerId() === state.selfId;
    const hasPending = (state.room?.game?.pendingResults || []).length > 0;

    els.rollButton.disabled = !(status === 'playing' && myTurn && state.room.game.throwQuota > 0);
    els.moveButton.disabled = !(status === 'playing' && myTurn && hasPending);
    els.skipButton.disabled = !(status === 'playing' && myTurn && hasPending);
    els.readyButton.disabled = status !== 'waiting' || !myPlayer;
    els.readyButton.textContent = myPlayer?.isReady ? '준비 해제' : '준비';
    els.startButton.disabled = !(status === 'waiting' && isHost);
    els.restartButton.disabled = !(isHost && status !== 'waiting');
    els.dummyButton.disabled = !(isHost && status === 'waiting');
  }

  function renderState(room) {
    if (room) state.room = room;
    if (!state.room) return;
    renderRoomMeta();
    renderBoardTokens();
    renderPending();
    renderPlayers();
    renderLogs();
    renderChat();
    renderStatus();
    renderControls();
  }

  socket.on('yut:rooms', (rooms) => renderRooms(rooms));

  socket.on('yut:joined', (payload) => {
    state.room = payload.room;
    state.selfId = payload.playerId;
    saveSession(state.room.id, state.selfId, state.room.players.find((p) => p.id === state.selfId)?.name);
    renderState();
    playSound();
  });

  socket.on('yut:state', (room) => {
    const wasStatus = state.room?.game?.status;
    state.room = room;
    renderState();
    if (wasStatus !== room.game?.status && room.game?.status === 'finished') {
      showToast('게임 종료! 재시작을 눌러 다시 시작하세요.');
    }
  });

  socket.on('yut:error', (message) => {
    showToast(message || '오류가 발생했습니다');
  });

  els.refreshRooms?.addEventListener('click', () => socket.emit('yut:list'));

  els.createForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    socket.emit('yut:create', {
      name: els.createName.value,
      nickname: els.createNick.value,
      maxPlayers: Number(els.createMax.value),
      password: els.createPassword.value,
      allowBackDo: els.createBackdo.checked,
      pieceCount: Number(els.createPieces.value),
    });
  });

  els.joinForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    socket.emit('yut:join', {
      roomId: els.joinRoomId.value.trim(),
      nickname: els.joinNick.value.trim(),
      password: els.joinPassword.value,
      asSpectator: els.joinSpectator.checked,
    });
  });

  els.reconnect?.addEventListener('click', () => {
    const saved = loadSession();
    if (!saved) return;
    socket.emit('yut:join', {
      roomId: saved.roomId,
      playerId: saved.playerId,
      nickname: saved.nickname,
    });
  });

  els.rollButton?.addEventListener('click', () => {
    if (!state.room) return;
    socket.emit('yut:roll', { roomId: state.room.id, playerId: state.selfId });
  });

  els.moveButton?.addEventListener('click', () => {
    if (!state.room || !state.selectedPiece) return;
    socket.emit('yut:move', {
      roomId: state.room.id,
      playerId: state.selfId,
      pieceId: state.selectedPiece.pieceId,
      useDiagonal: state.diagonal,
      resultIndex: state.selectedResultIndex,
    });
  });

  els.skipButton?.addEventListener('click', () => {
    if (!state.room) return;
    socket.emit('yut:skip', {
      roomId: state.room.id,
      playerId: state.selfId,
      resultIndex: state.selectedResultIndex,
    });
  });

  els.readyButton?.addEventListener('click', () => {
    if (!state.room) return;
    const me = state.room.players.find((p) => p.id === state.selfId);
    socket.emit('yut:ready', { roomId: state.room.id, playerId: state.selfId, ready: !me?.isReady });
  });

  els.startButton?.addEventListener('click', () => {
    if (!state.room) return;
    socket.emit('yut:start', { roomId: state.room.id, playerId: state.selfId });
  });

  els.restartButton?.addEventListener('click', () => {
    if (!state.room) return;
    socket.emit('yut:restart', { roomId: state.room.id, playerId: state.selfId });
  });

  els.dummyButton?.addEventListener('click', () => {
    if (!state.room) return;
    socket.emit('yut:add-dummy', { roomId: state.room.id, playerId: state.selfId, count: 1 });
  });

  els.diagonalToggle?.addEventListener('change', (e) => {
    state.diagonal = e.target.checked;
  });

  els.soundToggle?.addEventListener('change', (e) => {
    state.sound = e.target.checked;
  });

  els.chatForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!state.room || !els.chatInput.value.trim()) return;
    socket.emit('yut:chat', {
      roomId: state.room.id,
      sender: state.room.players.find((p) => p.id === state.selfId)?.name || '익명',
      text: els.chatInput.value.trim(),
    });
    els.chatInput.value = '';
  });

  drawBoard();
  const saved = loadSession();
  if (saved) {
    els.reconnect?.classList.remove('hidden');
  }
})();
