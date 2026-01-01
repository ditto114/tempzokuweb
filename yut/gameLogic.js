const THROW_OUTCOMES = [
  { label: '도', value: 1, extra: false },
  { label: '개', value: 2, extra: false },
  { label: '걸', value: 3, extra: false },
  { label: '윷', value: 4, extra: true },
  { label: '모', value: 5, extra: true },
  { label: '빽도', value: -1, extra: false },
];

const NEXT_MAP = Object.freeze({
  START: ['O1'],
  O1: ['O2'],
  O2: ['O3'],
  O3: ['O4'],
  O4: ['O5'],
  O5: ['O6', 'D1'],
  O6: ['O7'],
  O7: ['O8'],
  O8: ['O9'],
  O9: ['O10'],
  O10: ['O11', 'D3'],
  O11: ['O12'],
  O12: ['O13'],
  O13: ['O14'],
  O14: ['O15'],
  D1: ['D2'],
  D2: ['CENTER'],
  D3: ['D4'],
  D4: ['CENTER'],
  CENTER: ['O15'],
  O15: ['O16'],
  O16: ['O17'],
  O17: ['O18'],
  O18: ['O19'],
  O19: ['END'],
  END: ['END'],
});

const PREV_MAP = Object.freeze({
  START: ['O19'],
  O1: ['START'],
  O2: ['O1'],
  O3: ['O2'],
  O4: ['O3'],
  O5: ['O4'],
  O6: ['O5'],
  D1: ['O5'],
  D2: ['D1'],
  O7: ['O6'],
  O8: ['O7'],
  O9: ['O8'],
  O10: ['O9'],
  O11: ['O10'],
  D3: ['O10'],
  D4: ['D3'],
  O12: ['O11'],
  O13: ['O12'],
  O14: ['O13'],
  O15: ['O14', 'CENTER'],
  O16: ['O15'],
  O17: ['O16'],
  O18: ['O17'],
  O19: ['O18'],
  CENTER: ['D2', 'D4'],
  END: ['O19'],
});

const DEFAULT_PIECE_COUNT = 4;

function rollYut({ allowBackDo = true } = {}) {
  const candidates = allowBackDo ? THROW_OUTCOMES : THROW_OUTCOMES.filter((item) => item.value !== -1);
  const roll = candidates[Math.floor(Math.random() * candidates.length)];
  return { ...roll };
}

function createPieces(count = DEFAULT_PIECE_COUNT) {
  return Array.from({ length: count }, (_, index) => ({
    id: `p${index + 1}`,
    position: 'START',
    lastEntry: 'START',
  }));
}

function pickNextPosition(current, useDiagonal = false) {
  const nextOptions = NEXT_MAP[current] || [];
  if (nextOptions.length === 0) {
    return null;
  }
  if (nextOptions.length === 1) {
    return nextOptions[0];
  }
  if (useDiagonal) {
    const diagonal = nextOptions.find((pos) => pos.startsWith('D'));
    if (diagonal) {
      return diagonal;
    }
  }
  return nextOptions.find((pos) => !pos.startsWith('D')) || nextOptions[0];
}

function pickPreviousPosition(current, lastEntry) {
  const prevOptions = PREV_MAP[current] || [];
  if (prevOptions.length === 0) {
    return null;
  }
  if (prevOptions.length === 1) {
    return prevOptions[0];
  }
  if (lastEntry && prevOptions.includes(lastEntry)) {
    return lastEntry;
  }
  return prevOptions[0];
}

function advancePosition(startPosition, steps, { useDiagonal = false, lastEntry = 'START' } = {}) {
  if (!Number.isInteger(steps)) {
    return { valid: false, position: startPosition, lastEntry, path: [] };
  }
  if (steps === 0) {
    return { valid: true, position: startPosition, lastEntry, path: [] };
  }
  let current = startPosition || 'START';
  let previous = lastEntry || 'START';
  const path = [];
  const direction = steps > 0 ? 1 : -1;
  let remaining = Math.abs(steps);

  while (remaining > 0) {
    if (direction > 0) {
      const next = pickNextPosition(current, useDiagonal);
      if (!next) {
        return { valid: false, position: current, lastEntry: previous, path };
      }
      path.push(next);
      previous = current;
      current = next;
      if (current === 'END' && remaining > 1) {
        return { valid: false, position: current, lastEntry: previous, path };
      }
    } else {
      const prev = pickPreviousPosition(current, previous);
      if (!prev) {
        return { valid: false, position: current, lastEntry: previous, path };
      }
      path.push(prev);
      previous = current;
      current = prev;
      if (current === 'START' && remaining > 1) {
        return { valid: false, position: current, lastEntry: previous, path };
      }
    }
    remaining -= 1;
  }

  return { valid: true, position: current, lastEntry: previous, path };
}

function summarizeBoard(players = []) {
  const occupancy = {};
  players.forEach((player) => {
    if (!player || !Array.isArray(player.pieces)) {
      return;
    }
    player.pieces.forEach((piece) => {
      const position = piece.position || 'START';
      if (!occupancy[position]) {
        occupancy[position] = [];
      }
      occupancy[position].push({ playerId: player.id, pieceId: piece.id });
    });
  });
  return occupancy;
}

function getStackForPiece(player, pieceId) {
  const target = player.pieces.find((piece) => piece.id === pieceId);
  if (!target) {
    return null;
  }
  const stack = player.pieces.filter(
    (piece) => piece.position === target.position && piece.position !== 'END',
  );
  return { anchor: target, pieces: stack };
}

function findMovablePieces(player, steps, options = {}) {
  if (!player || !Array.isArray(player.pieces)) {
    return [];
  }
  return player.pieces
    .filter((piece) => piece.position !== 'END' || steps < 0)
    .map((piece) => {
      const advance = advancePosition(piece.position, steps, {
        useDiagonal: options.useDiagonal,
        lastEntry: piece.lastEntry,
      });
      return { piece, advance };
    })
    .filter(({ advance }) => advance.valid);
}

function buildBoardState(players = []) {
  const board = new Map();
  players.forEach((player) => {
    player.pieces.forEach((piece) => {
      const key = piece.position;
      if (!board.has(key)) {
        board.set(key, []);
      }
      board.get(key).push({ playerId: player.id, pieceId: piece.id });
    });
  });
  return board;
}

function validateMove({ player, pieceId, steps, useDiagonal = false }) {
  if (!player) {
    return { ok: false, reason: '플레이어가 존재하지 않습니다.' };
  }
  const stackInfo = getStackForPiece(player, pieceId);
  if (!stackInfo) {
    return { ok: false, reason: '해당 말을 찾을 수 없습니다.' };
  }
  const { anchor, pieces } = stackInfo;
  if (anchor.position === 'END' && steps > 0) {
    return { ok: false, reason: '완주한 말은 이동할 수 없습니다.' };
  }

  const advance = advancePosition(anchor.position, steps, {
    useDiagonal,
    lastEntry: anchor.lastEntry,
  });

  if (!advance.valid) {
    return { ok: false, reason: '해당 칸으로 이동할 수 없습니다.' };
  }

  return {
    ok: true,
    movingPieces: pieces,
    destination: advance.position,
    lastEntry: advance.lastEntry,
    path: advance.path,
  };
}

module.exports = {
  rollYut,
  createPieces,
  advancePosition,
  summarizeBoard,
  findMovablePieces,
  buildBoardState,
  validateMove,
  THROW_OUTCOMES,
  DEFAULT_PIECE_COUNT,
};
