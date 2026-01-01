const {
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
} = require('./roomManager');

function registerYutSocket(io) {
  setBroadcaster((roomId, state) => {
    io.to(roomId).emit('yut:state', state);
    io.emit('yut:rooms', listRooms());
  });

  io.on('connection', (socket) => {
    socket.emit('yut:rooms', listRooms());

    const emitError = (message) => socket.emit('yut:error', message);

    socket.on('yut:list', () => {
      socket.emit('yut:rooms', listRooms());
    });

    socket.on('yut:create', (payload, cb) => {
      try {
        const { room, player } = createRoom({
          name: payload?.name,
          hostName: payload?.nickname,
          socketId: socket.id,
          maxPlayers: payload?.maxPlayers,
          password: payload?.password,
          allowBackDo: payload?.allowBackDo,
          pieceCount: payload?.pieceCount,
        });
        socket.join(room.id);
        const state = serializeRoom(room);
        socket.emit('yut:joined', { room: state, playerId: player.id });
        io.emit('yut:rooms', listRooms());
        if (typeof cb === 'function') cb({ ok: true, roomId: room.id, playerId: player.id });
      } catch (error) {
        emitError(error.message);
        if (typeof cb === 'function') cb({ ok: false, error: error.message });
      }
    });

    socket.on('yut:join', (payload, cb) => {
      try {
        const { room, player } = joinRoom({
          roomId: payload?.roomId,
          socketId: socket.id,
          name: payload?.nickname,
          password: payload?.password,
          playerId: payload?.playerId,
          asSpectator: payload?.asSpectator,
        });
        socket.join(room.id);
        const state = serializeRoom(room);
        socket.emit('yut:joined', { room: state, playerId: player?.id || null });
        io.emit('yut:rooms', listRooms());
        if (typeof cb === 'function') cb({ ok: true, roomId: room.id, playerId: player?.id });
      } catch (error) {
        emitError(error.message);
        if (typeof cb === 'function') cb({ ok: false, error: error.message });
      }
    });

    socket.on('yut:ready', (payload) => {
      try {
        toggleReady(payload.roomId, payload.playerId, payload.ready);
      } catch (error) {
        emitError(error.message);
      }
    });

    socket.on('yut:start', (payload) => {
      try {
        startGame(payload.roomId, payload.playerId);
      } catch (error) {
        emitError(error.message);
      }
    });

    socket.on('yut:roll', (payload) => {
      try {
        handleRoll(payload.roomId, payload.playerId);
      } catch (error) {
        emitError(error.message);
      }
    });

    socket.on('yut:move', (payload) => {
      try {
        applyMove(payload.roomId, payload.playerId, {
          pieceId: payload.pieceId,
          useDiagonal: payload.useDiagonal,
          resultIndex: payload.resultIndex,
        });
      } catch (error) {
        emitError(error.message);
      }
    });

    socket.on('yut:skip', (payload) => {
      try {
        consumeResult(payload.roomId, payload.playerId, payload.resultIndex);
      } catch (error) {
        emitError(error.message);
      }
    });

    socket.on('yut:restart', (payload) => {
      try {
        restartRoom(payload.roomId, payload.playerId);
      } catch (error) {
        emitError(error.message);
      }
    });

    socket.on('yut:chat', (payload) => {
      try {
        const { roomId, sender, text } = payload || {};
        if (!roomId || !text) return;
        addChatMessage(roomId, sender, text);
      } catch (error) {
        emitError(error.message);
      }
    });

    socket.on('yut:add-dummy', (payload) => {
      try {
        addDummyPlayers(payload.roomId, payload.playerId, payload.count || 1);
      } catch (error) {
        emitError(error.message);
      }
    });

    socket.on('disconnect', () => {
      const room = leaveRoom(socket.id);
      if (room) {
        io.emit('yut:rooms', listRooms());
      }
    });
  });
}

module.exports = { registerYutSocket };
