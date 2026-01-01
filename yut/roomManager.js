const crypto = require('crypto');
const {
  rollYut,
  createPieces,
  buildBoardState,
  validateMove,
  findMovablePieces,
  DEFAULT_PIECE_COUNT,
} = require('./gameLogic');

const rooms = new Map();
const socketToRoom = new Map();
const botTimers = new Map();
let broadcast = () => {};

const PLAYER_COLORS = ['#3b82f6', '#f59e0b', '#10b981', '#ec4899'];

function setBroadcaster(handler) {
  broadcast = handler;
}

function now() {
  return Date.now();
}

function shortId() {
  return crypto.randomBytes(4).toString('hex');
}

function hashPassword(raw = '') {
  return crypto.createHash('sha256').update(String(raw)).digest('hex');
}

function assignColor(index = 0) {
  return PLAYER_COLORS[index % PLAYER_COLORS.length];
}

function createRoom({ name, hostName, socketId, maxPlayers = 4, password = '', allowBackDo = true, pieceCount = DEFAULT_PIECE_COUNT }) {
  const roomId = shortId();
  const normalizedName = name?.trim() || '새로운 윷방';
  const room = {
    id: roomId,
    name: normalizedName,
    maxPlayers: Math.min(4, Math.max(2, Number(maxPlayers) || 4)),
    createdAt: now(),
    allowBackDo: allowBackDo !== false,
    pieceCount: Math.min(6, Math.max(3, Number(pieceCount) || DEFAULT_PIECE_COUNT)),
    passwordHash: password ? hashPassword(password) : null,
    players: new Map(),
    spectators: new Map(),
    chat: [],
    game: {
      status: 'waiting',
      turnOrder: [],
      currentTurnIndex: 0,
      pendingResults: [],
      throwQuota: 0,
      lastRoll: null,
      winnerIds: [],
      activityLog: [],
    },
  };

  rooms.set(roomId, room);

  const host = addPlayerToRoom({
    room,
    socketId,
    name: hostName,
    isHost: true,
    isBot: false,
  });

  logActivity(room, `${host.name}님이 방을 만들었습니다.`);
  return { room, player: host };
}

function addPlayerToRoom({ room, socketId, name, isHost = false, isBot = false }) {
  const playerId = shortId();
  const joinedAt = now();
  const player = {
    id: playerId,
    name: name?.trim() || `플레이어 ${room.players.size + 1}`,
    socketId,
    isHost,
    isReady: isHost,
    isBot,
    connected: true,
    color: assignColor(room.players.size),
    pieces: createPieces(room.pieceCount),
    finishedCount: 0,
    joinedAt,
  };
  room.players.set(playerId, player);
  socketToRoom.set(socketId, room.id);
  return player;
}

function serializePlayer(player) {
  return {
    id: player.id,
    name: player.name,
    isHost: player.isHost,
    isReady: player.isReady,
    isBot: player.isBot,
    connected: player.connected,
    color: player.color,
    pieces: player.pieces,
    finishedCount: player.finishedCount,
  };
}

function serializeRoom(room) {
  return {
    id: room.id,
    name: room.name,
    allowBackDo: room.allowBackDo,
    pieceCount: room.pieceCount,
    maxPlayers: room.maxPlayers,
    createdAt: room.createdAt,
    hasPassword: Boolean(room.passwordHash),
    players: Array.from(room.players.values()).map(serializePlayer),
    spectators: Array.from(room.spectators.values()).map((spectator) => ({
      id: spectator.id,
      name: spectator.name,
      connected: spectator.connected,
    })),
    chat: room.chat.slice(-50),
    game: {
      ...room.game,
      board: Array.from(buildBoardState(Array.from(room.players.values())).entries()).map(([key, value]) => ({ position: key, occupants: value })),
    },
  };
}

function listRooms() {
  return Array.from(rooms.values()).map((room) => ({
    id: room.id,
    name: room.name,
    playerCount: room.players.size,
    spectatorCount: room.spectators.size,
    maxPlayers: room.maxPlayers,
    status: room.game.status,
    allowBackDo: room.allowBackDo,
    hasPassword: Boolean(room.passwordHash),
    createdAt: room.createdAt,
  }));
}

function findRoomBySocket(socketId) {
  const roomId = socketToRoom.get(socketId);
  if (!roomId) return null;
  return rooms.get(roomId) || null;
}

function attachSpectator(room, socketId, name) {
  const spectator = {
    id: shortId(),
    name: name?.trim() || '관전자',
    socketId,
    connected: true,
  };
  room.spectators.set(spectator.id, spectator);
  socketToRoom.set(socketId, room.id);
  return spectator;
}

function logActivity(room, message) {
  room.game.activityLog.push({
    id: shortId(),
    message,
    at: now(),
  });
  room.game.activityLog = room.game.activityLog.slice(-80);
}

function addChatMessage(roomId, sender, text, type = 'chat') {
  const room = rooms.get(roomId);
  if (!room) {
    throw new Error('방을 찾을 수 없습니다.');
  }
  const payload = {
    id: shortId(),
    sender: sender || '시스템',
    text: text?.slice(0, 500) || '',
    type,
    at: now(),
  };
  room.chat.push(payload);
  room.chat = room.chat.slice(-100);
  broadcast(room.id, serializeRoom(room));
}

function joinRoom({ roomId, socketId, name, password, playerId, asSpectator = false }) {
  const room = rooms.get(roomId);
  if (!room) {
    throw new Error('존재하지 않는 방입니다.');
  }
  if (room.game.status === 'playing' && !playerId && !asSpectator) {
    throw new Error('게임 진행 중에는 새로운 플레이어가 입장할 수 없습니다.');
  }

  if (room.passwordHash) {
    const hashed = hashPassword(password || '');
    if (hashed !== room.passwordHash) {
      throw new Error('비밀번호가 올바르지 않습니다.');
    }
  }

  if (asSpectator) {
    const spectator = attachSpectator(room, socketId, name);
    broadcast(room.id, serializeRoom(room));
    return { room, player: null, spectator };
  }

  let player = playerId ? room.players.get(playerId) : null;
  if (player) {
    player.socketId = socketId;
    player.connected = true;
    socketToRoom.set(socketId, room.id);
    broadcast(room.id, serializeRoom(room));
    return { room, player, reconnected: true };
  }

  if (room.players.size >= room.maxPlayers) {
    throw new Error('방이 가득 찼습니다.');
  }

  player = addPlayerToRoom({ room, socketId, name });
  logActivity(room, `${player.name}님이 입장했습니다.`);
  broadcast(room.id, serializeRoom(room));
  return { room, player };
}

function leaveRoom(socketId) {
  const room = findRoomBySocket(socketId);
  if (!room) return null;
  socketToRoom.delete(socketId);

  for (const [id, player] of room.players.entries()) {
    if (player.socketId === socketId) {
      player.connected = false;
      player.socketId = null;
      logActivity(room, `${player.name}님이 접속을 종료했습니다.`);
      ensureHost(room);
      if (room.game.status === 'playing' && currentPlayer(room)?.id === player.id) {
        advanceTurn(room);
        return room;
      }
      broadcast(room.id, serializeRoom(room));
      return room;
    }
  }

  for (const [id, spectator] of room.spectators.entries()) {
    if (spectator.socketId === socketId) {
      room.spectators.delete(id);
      broadcast(room.id, serializeRoom(room));
      return room;
    }
  }

  if (room.players.size === 0) {
    rooms.delete(room.id);
  } else {
    broadcast(room.id, serializeRoom(room));
  }
  return room;
}

function toggleReady(roomId, playerId, ready) {
  const room = rooms.get(roomId);
  if (!room) throw new Error('방을 찾을 수 없습니다.');
  const player = room.players.get(playerId);
  if (!player) throw new Error('플레이어를 찾을 수 없습니다.');
  if (room.game.status !== 'waiting') {
    throw new Error('게임 중에는 준비 상태를 변경할 수 없습니다.');
  }
  player.isReady = ready;
  broadcast(room.id, serializeRoom(room));
}

function resetGame(room) {
  room.game = {
    status: 'waiting',
    turnOrder: [],
    currentTurnIndex: 0,
    pendingResults: [],
    throwQuota: 0,
    lastRoll: null,
    winnerIds: [],
    activityLog: [],
  };
  room.players.forEach((player) => {
    player.pieces = createPieces(room.pieceCount);
    player.finishedCount = 0;
    player.isReady = false;
  });
}

function ensureHost(room) {
  const hasHost = Array.from(room.players.values()).some((p) => p.isHost);
  if (hasHost) return;
  const [first] = Array.from(room.players.values()).sort((a, b) => a.joinedAt - b.joinedAt);
  if (first) {
    first.isHost = true;
    first.isReady = true;
  }
}

function startGame(roomId, playerId) {
  const room = rooms.get(roomId);
  if (!room) throw new Error('방을 찾을 수 없습니다.');
  const player = room.players.get(playerId);
  if (!player || !player.isHost) {
    throw new Error('방장만 시작할 수 있습니다.');
  }
  if (room.players.size < 2) {
    throw new Error('2명 이상이 필요합니다.');
  }
  const everyoneReady = Array.from(room.players.values()).every((p) => p.isReady || p.isBot);
  if (!everyoneReady) {
    throw new Error('모든 플레이어가 준비 상태여야 합니다.');
  }

  room.players.forEach((p, idx) => {
    p.pieces = createPieces(room.pieceCount);
    p.finishedCount = 0;
  });

  room.game = {
    status: 'playing',
    turnOrder: Array.from(room.players.keys()),
    currentTurnIndex: 0,
    pendingResults: [],
    throwQuota: 1,
    lastRoll: null,
    winnerIds: [],
    activityLog: [],
    allowBackDo: room.allowBackDo,
  };
  logActivity(room, '게임이 시작되었습니다. 첫 번째 플레이어의 턴입니다.');
  broadcast(room.id, serializeRoom(room));
  scheduleBot(room.id);
}

function currentPlayer(room) {
  if (!room || room.game.status !== 'playing') return null;
  const orderLength = room.game.turnOrder.length;
  if (orderLength === 0) return null;

  for (let i = 0; i < orderLength; i += 1) {
    const index = (room.game.currentTurnIndex + i) % orderLength;
    const playerId = room.game.turnOrder[index];
    const player = room.players.get(playerId);
    if (player && player.connected) {
      room.game.currentTurnIndex = index;
      return player;
    }
  }
  return null;
}

function advanceTurn(room) {
  if (room.game.status !== 'playing') return;
  const startingIndex = room.game.currentTurnIndex;
  const orderLength = room.game.turnOrder.length;
  for (let i = 1; i <= orderLength; i += 1) {
    const nextIndex = (startingIndex + i) % orderLength;
    const nextId = room.game.turnOrder[nextIndex];
    const nextPlayer = room.players.get(nextId);
    if (nextPlayer && nextPlayer.connected) {
      room.game.currentTurnIndex = nextIndex;
      room.game.throwQuota = 1;
      room.game.pendingResults = [];
      room.game.lastRoll = null;
      logActivity(room, `${nextPlayer.name}님의 턴입니다.`);
      broadcast(room.id, serializeRoom(room));
      scheduleBot(room.id);
      return;
    }
  }
  room.game.throwQuota = 0;
  room.game.pendingResults = [];
  broadcast(room.id, serializeRoom(room));
}

function awardBonusThrow(room, reason = '') {
  room.game.throwQuota += 1;
  if (reason) {
    logActivity(room, reason);
  }
}

function handleRoll(roomId, playerId) {
  const room = rooms.get(roomId);
  if (!room) throw new Error('방을 찾을 수 없습니다.');
  if (room.game.status !== 'playing') throw new Error('게임이 시작되지 않았습니다.');
  const player = room.players.get(playerId);
  if (!player) throw new Error('플레이어를 찾을 수 없습니다.');
  const current = currentPlayer(room);
  if (!current || current.id !== playerId) throw new Error('현재 턴이 아닙니다.');
  if (room.game.throwQuota <= 0) throw new Error('던질 수 있는 기회가 없습니다.');

  const result = rollYut({ allowBackDo: room.allowBackDo });
  room.game.throwQuota -= 1;
  room.game.pendingResults.push({ value: result.value, label: result.label, extra: result.extra });
  room.game.lastRoll = result;
  if (result.extra) {
    awardBonusThrow(room, `${result.label}이 나와 한 번 더 던집니다.`);
  }
  logActivity(room, `${player.name}님이 ${result.label}(${result.value})을(를) 던졌습니다.`);
  broadcast(room.id, serializeRoom(room));
  scheduleBot(room.id);
  return result;
}

function capturePieces(room, destination, ownerId) {
  const captured = [];
  room.players.forEach((player) => {
    if (player.id === ownerId) return;
    player.pieces.forEach((piece) => {
      if (piece.position === destination && destination !== 'END' && destination !== 'START') {
        piece.position = 'START';
        piece.lastEntry = 'START';
        captured.push({ playerId: player.id, pieceId: piece.id });
      }
    });
  });
  return captured;
}

function checkWinner(room, player) {
  const finished = player.pieces.every((piece) => piece.position === 'END');
  if (finished) {
    room.game.status = 'finished';
    room.game.winnerIds = [player.id];
    logActivity(room, `${player.name}님이 모든 말을 완주했습니다!`);
  }
}

function applyMove(roomId, playerId, { pieceId, useDiagonal = false, resultIndex = 0 }) {
  const room = rooms.get(roomId);
  if (!room) throw new Error('방을 찾을 수 없습니다.');
  if (room.game.status !== 'playing') throw new Error('게임이 시작되지 않았습니다.');
  const player = room.players.get(playerId);
  if (!player) throw new Error('플레이어를 찾을 수 없습니다.');
  const current = currentPlayer(room);
  if (!current || current.id !== playerId) throw new Error('현재 턴이 아닙니다.');
  if (!Array.isArray(room.game.pendingResults) || room.game.pendingResults.length === 0) {
    throw new Error('이동할 결과가 없습니다.');
  }
  const targetResult = room.game.pendingResults[resultIndex];
  if (!targetResult) {
    throw new Error('잘못된 이동 선택입니다.');
  }

  const validation = validateMove({ player, pieceId, steps: targetResult.value, useDiagonal });
  if (!validation.ok) {
    throw new Error(validation.reason || '이동할 수 없습니다.');
  }

  validation.movingPieces.forEach((piece) => {
    piece.position = validation.destination;
    piece.lastEntry = validation.lastEntry;
    if (piece.position === 'END') {
      player.finishedCount += 1;
    }
  });

  const captured = capturePieces(room, validation.destination, player.id);
  if (captured.length > 0) {
    awardBonusThrow(room, '잡기에 성공해 한 번 더 던질 수 있습니다.');
  }

  room.game.pendingResults.splice(resultIndex, 1);
  checkWinner(room, player);

  if (room.game.status !== 'finished') {
    if (room.game.throwQuota <= 0 && room.game.pendingResults.length === 0) {
      advanceTurn(room);
    } else {
      broadcast(room.id, serializeRoom(room));
      scheduleBot(room.id);
    }
  } else {
    broadcast(room.id, serializeRoom(room));
  }

  return { destination: validation.destination, captured };
}

function movableExists(room, playerId, resultIndex = 0) {
  const player = room.players.get(playerId);
  const result = room.game.pendingResults[resultIndex];
  if (!player || !result) return false;
  const nonDiag = findMovablePieces(player, result.value, { useDiagonal: false });
  if (nonDiag.length > 0) return true;
  const diag = findMovablePieces(player, result.value, { useDiagonal: true });
  return diag.length > 0;
}

function consumeResult(roomId, playerId, resultIndex = 0) {
  const room = rooms.get(roomId);
  if (!room) throw new Error('방을 찾을 수 없습니다.');
  if (room.game.status !== 'playing') throw new Error('게임이 시작되지 않았습니다.');
  const current = currentPlayer(room);
  if (!current || current.id !== playerId) throw new Error('현재 턴이 아닙니다.');
  if (!room.game.pendingResults[resultIndex]) throw new Error('소진할 결과가 없습니다.');
  if (movableExists(room, playerId, resultIndex)) {
    throw new Error('이동 가능한 말이 있어 결과를 소진할 수 없습니다.');
  }
  const skipped = room.game.pendingResults.splice(resultIndex, 1);
  logActivity(room, `${current.name}님이 ${skipped[0].label}을(를) 사용할 수 없어 소진했습니다.`);
  if (room.game.throwQuota <= 0 && room.game.pendingResults.length === 0) {
    advanceTurn(room);
  } else {
    broadcast(room.id, serializeRoom(room));
    scheduleBot(room.id);
  }
}

function restartRoom(roomId, playerId) {
  const room = rooms.get(roomId);
  if (!room) throw new Error('방을 찾을 수 없습니다.');
  const player = room.players.get(playerId);
  if (!player || !player.isHost) throw new Error('방장만 재시작할 수 있습니다.');
  resetGame(room);
  ensureHost(room);
  broadcast(room.id, serializeRoom(room));
}

function addDummyPlayers(roomId, requesterId, count = 1) {
  const room = rooms.get(roomId);
  if (!room) throw new Error('방을 찾을 수 없습니다.');
  const requester = room.players.get(requesterId);
  if (!requester || !requester.isHost) throw new Error('방장만 더미를 추가할 수 있습니다.');
  if (room.game.status === 'playing') {
    throw new Error('게임 중에는 더미를 추가할 수 없습니다.');
  }
  const normalized = Math.min(4 - room.players.size, Math.max(0, count));
  for (let i = 0; i < normalized; i += 1) {
    const bot = addPlayerToRoom({
      room,
      socketId: `bot-${shortId()}`,
      name: `더미 ${room.players.size + 1}`,
      isBot: true,
    });
    bot.isReady = true;
  }
  broadcast(room.id, serializeRoom(room));
}

function scheduleBot(roomId) {
  const room = rooms.get(roomId);
  if (!room || room.game.status !== 'playing') return;
  const current = currentPlayer(room);
  if (!current || !current.isBot) {
    clearTimeout(botTimers.get(roomId));
    return;
  }

  clearTimeout(botTimers.get(roomId));
  const delay = 350;
  const timeout = setTimeout(() => {
    try {
      runBotTurn(roomId, current.id);
    } catch (error) {
      console.error('Bot error:', error.message);
    }
  }, delay);
  botTimers.set(roomId, timeout);
}

function runBotTurn(roomId, botId) {
  const room = rooms.get(roomId);
  if (!room || room.game.status !== 'playing') return;
  const current = currentPlayer(room);
  if (!current || current.id !== botId) return;

  if (room.game.throwQuota > 0) {
    handleRoll(roomId, botId);
    return;
  }

  if (room.game.pendingResults.length > 0) {
    const resultIndex = 0;
    const result = room.game.pendingResults[resultIndex];
    const movable = findMovablePieces(current, result.value, { useDiagonal: true });
    if (movable.length === 0) {
      consumeResult(roomId, botId, resultIndex);
      return;
    }
    const target = movable[movable.length - 1];
    applyMove(roomId, botId, { pieceId: target.piece.id, useDiagonal: true, resultIndex });
    return;
  }
}

module.exports = {
  setBroadcaster,
  createRoom,
  joinRoom,
  leaveRoom,
  listRooms,
  toggleReady,
  startGame,
  handleRoll,
  applyMove,
  consumeResult,
  restartRoom,
  addChatMessage,
  addDummyPlayers,
  serializeRoom,
};
