const express = require('express');
const path = require('path');
const mysql = require('mysql2/promise');

const app = express();
const PORT = process.env.PORT || 3000;

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'dito1121!',
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
};

const databaseName = process.env.DB_NAME || 'raid_distribution';

let pool;

const DEFAULT_TIMER_DURATION_MS = 15 * 60 * 1000;
const MIN_TIMER_DURATION_MS = 5 * 1000;
const MAX_TIMER_DURATION_MS = 3 * 60 * 60 * 1000;

const timerClients = new Set();
const timers = new Map();

function clampTimerDuration(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return DEFAULT_TIMER_DURATION_MS;
  }
  return Math.min(Math.max(value, MIN_TIMER_DURATION_MS), MAX_TIMER_DURATION_MS);
}

function getTimerRemaining(timer, now = Date.now()) {
  if (!timer) {
    return 0;
  }
  if (timer.isRunning && typeof timer.endTime === 'number') {
    return Math.max(0, timer.endTime - now);
  }
  return Math.max(0, timer.remainingMs ?? 0);
}

function createTimerPayload(timer, now = Date.now()) {
  const remaining = getTimerRemaining(timer, now);
  return {
    id: timer.id,
    name: timer.name,
    duration: timer.durationMs,
    remaining,
    isRunning: timer.isRunning,
    repeatEnabled: timer.repeatEnabled,
    endTime: timer.isRunning ? timer.endTime : null,
    updatedAt: now,
  };
}

function getTimersPayload(now = Date.now()) {
  return {
    timers: Array.from(timers.values())
      .sort((a, b) => a.id - b.id)
      .map((timer) => createTimerPayload(timer, now)),
  };
}

function broadcastTimers(payload = getTimersPayload()) {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const client of timerClients) {
    try {
      client.write(data);
    } catch (error) {
      timerClients.delete(client);
    }
  }
}

function sendTimersState(response, payload = getTimersPayload()) {
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function generateTimerName() {
  const existingNames = new Set(Array.from(timers.values(), (timer) => timer.name));
  let index = timers.size + 1;
  while (existingNames.has(`타이머 ${index}`)) {
    index += 1;
  }
  return `타이머 ${index}`;
}

async function persistTimer(timer) {
  if (!timer || !pool) {
    return;
  }
  const remainingMs = Math.max(0, Math.floor(timer.remainingMs ?? 0));
  const endTime = typeof timer.endTime === 'number' ? Math.floor(timer.endTime) : null;
  await pool.query(
    `UPDATE timers SET name = ?, duration_ms = ?, remaining_ms = ?, is_running = ?, repeat_enabled = ?, end_time = ? WHERE id = ?`,
    [
      timer.name,
      Math.floor(timer.durationMs),
      remainingMs,
      timer.isRunning ? 1 : 0,
      timer.repeatEnabled ? 1 : 0,
      endTime,
      timer.id,
    ],
  );
}

async function createTimerInDatabase({ name, durationMs }) {
  if (!pool) {
    throw new Error('Database connection is not initialized.');
  }
  const [result] = await pool.query(
    `INSERT INTO timers (name, duration_ms, remaining_ms, is_running, repeat_enabled, end_time) VALUES (?, ?, ?, 0, 0, NULL)`,
    [name, Math.floor(durationMs), Math.floor(durationMs)],
  );
  return result.insertId;
}

async function loadTimersFromDatabase() {
  if (!pool) {
    return;
  }

  const [rows] = await pool.query(
    `SELECT id, name, duration_ms, remaining_ms, is_running, repeat_enabled, end_time FROM timers ORDER BY id ASC`,
  );

  const now = Date.now();
  timers.clear();
  const updates = [];

  for (const row of rows) {
    const duration = clampTimerDuration(Number(row.duration_ms));
    const endTime = row.end_time != null ? Number(row.end_time) : null;
    const timer = {
      id: row.id,
      name: row.name || generateTimerName(),
      durationMs: duration,
      remainingMs: Math.max(0, Number(row.remaining_ms) || duration),
      isRunning: Boolean(row.is_running),
      repeatEnabled: Boolean(row.repeat_enabled),
      endTime: typeof endTime === 'number' && Number.isFinite(endTime) ? endTime : null,
      updatedAt: now,
    };

    if (timer.isRunning && typeof timer.endTime === 'number') {
      const remaining = timer.endTime - now;
      if (remaining <= 0) {
        if (timer.repeatEnabled) {
          timer.remainingMs = timer.durationMs;
          timer.endTime = now + timer.durationMs;
        } else {
          timer.isRunning = false;
          timer.remainingMs = 0;
          timer.endTime = null;
        }
        timer.updatedAt = now;
        updates.push(persistTimer(timer));
      } else {
        timer.remainingMs = remaining;
      }
    } else {
      timer.isRunning = false;
      timer.endTime = null;
    }

    timers.set(timer.id, timer);
  }

  if (timers.size === 0) {
    const name = generateTimerName();
    const duration = DEFAULT_TIMER_DURATION_MS;
    const insertId = await createTimerInDatabase({ name, durationMs: duration });
    timers.set(insertId, {
      id: insertId,
      name,
      durationMs: duration,
      remainingMs: duration,
      isRunning: false,
      repeatEnabled: false,
      endTime: null,
      updatedAt: now,
    });
  }

  if (updates.length > 0) {
    await Promise.allSettled(updates);
  }
}

async function initializeDatabase() {
  const connection = await mysql.createConnection(dbConfig);
  await connection.query(`CREATE DATABASE IF NOT EXISTS \`${databaseName}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await connection.query(`USE \`${databaseName}\``);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS members (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nickname VARCHAR(100) NOT NULL,
      job VARCHAR(100) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS distributions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      data JSON NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS timers (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      duration_ms INT NOT NULL,
      remaining_ms INT NOT NULL,
      is_running TINYINT(1) NOT NULL DEFAULT 0,
      repeat_enabled TINYINT(1) NOT NULL DEFAULT 0,
      end_time BIGINT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
  await connection.end();

  pool = mysql.createPool({
    ...dbConfig,
    database: databaseName,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  });

  await loadTimersFromDatabase();
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/members', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, nickname, job FROM members ORDER BY id ASC');
    res.json(rows);
  } catch (error) {
    console.error('Error fetching members:', error);
    res.status(500).json({ message: '공대원 정보를 불러오는 중 오류가 발생했습니다.' });
  }
});

app.post('/api/members', async (req, res) => {
  const { nickname, job } = req.body;

  if (!nickname || !job) {
    return res.status(400).json({ message: '닉네임과 직업을 모두 입력해주세요.' });
  }

  try {
    const [result] = await pool.query('INSERT INTO members (nickname, job) VALUES (?, ?)', [nickname, job]);
    res.status(201).json({ id: result.insertId, nickname, job });
  } catch (error) {
    console.error('Error adding member:', error);
    res.status(500).json({ message: '공대원 정보를 저장하는 중 오류가 발생했습니다.' });
  }
});

app.delete('/api/members/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const [result] = await pool.query('DELETE FROM members WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: '해당 공대원을 찾을 수 없습니다.' });
    }
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting member:', error);
    res.status(500).json({ message: '공대원 정보를 삭제하는 중 오류가 발생했습니다.' });
  }
});

app.get('/api/distributions', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, title, created_at, updated_at FROM distributions ORDER BY created_at DESC, id DESC',
    );
    res.json(rows);
  } catch (error) {
    console.error('Error fetching distributions:', error);
    res.status(500).json({ message: '분배표 목록을 불러오는 중 오류가 발생했습니다.' });
  }
});

app.get('/api/distributions/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await pool.query('SELECT id, title, data, created_at, updated_at FROM distributions WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ message: '해당 분배표를 찾을 수 없습니다.' });
    }
    const distribution = rows[0];
    let payload = distribution.data;
    if (typeof payload === 'string') {
      try {
        payload = JSON.parse(payload);
      } catch (error) {
        console.error('Error parsing distribution payload:', error);
        payload = {};
      }
    }
    res.json({
      id: distribution.id,
      title: distribution.title,
      data: payload,
      created_at: distribution.created_at,
      updated_at: distribution.updated_at,
    });
  } catch (error) {
    console.error('Error fetching distribution detail:', error);
    res.status(500).json({ message: '분배표를 불러오는 중 오류가 발생했습니다.' });
  }
});

app.post('/api/distributions', async (req, res) => {
  const { title, data } = req.body;

  if (!title || !data) {
    return res.status(400).json({ message: '제목과 데이터를 모두 전달해주세요.' });
  }

  try {
    const [result] = await pool.query('INSERT INTO distributions (title, data) VALUES (?, ?)', [title, JSON.stringify(data)]);
    const [rows] = await pool.query('SELECT id, title, created_at, updated_at FROM distributions WHERE id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (error) {
    console.error('Error saving distribution:', error);
    res.status(500).json({ message: '분배표를 저장하는 중 오류가 발생했습니다.' });
  }
});

app.put('/api/distributions/:id', async (req, res) => {
  const { id } = req.params;
  const { title, data } = req.body;

  if (!title || !data) {
    return res.status(400).json({ message: '제목과 데이터를 모두 전달해주세요.' });
  }

  try {
    const [result] = await pool.query('UPDATE distributions SET title = ?, data = ? WHERE id = ?', [title, JSON.stringify(data), id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: '해당 분배표를 찾을 수 없습니다.' });
    }
    const [rows] = await pool.query('SELECT id, title, created_at, updated_at FROM distributions WHERE id = ?', [id]);
    res.json(rows[0]);
  } catch (error) {
    console.error('Error updating distribution:', error);
    res.status(500).json({ message: '분배표를 수정하는 중 오류가 발생했습니다.' });
  }
});

function getTimerById(id) {
  const numericId = Number(id);
  if (!Number.isInteger(numericId)) {
    return null;
  }
  return timers.get(numericId) ?? null;
}

app.get('/api/timers', (req, res) => {
  res.json(getTimersPayload().timers);
});

app.get('/api/timers/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  } else {
    res.writeHead(200);
  }

  timerClients.add(res);
  res.write('retry: 5000\n\n');
  sendTimersState(res);

  req.on('close', () => {
    timerClients.delete(res);
  });
});

app.post('/api/timers', async (req, res) => {
  try {
    const name = generateTimerName();
    const duration = DEFAULT_TIMER_DURATION_MS;
    const insertId = await createTimerInDatabase({ name, durationMs: duration });
    const now = Date.now();
    const timer = {
      id: insertId,
      name,
      durationMs: duration,
      remainingMs: duration,
      isRunning: false,
      repeatEnabled: false,
      endTime: null,
      updatedAt: now,
    };
    timers.set(insertId, timer);
    const payload = createTimerPayload(timer, now);
    broadcastTimers(getTimersPayload(now));
    res.status(201).json(payload);
  } catch (error) {
    console.error('Error creating timer:', error);
    res.status(500).json({ message: '타이머를 추가하는 중 오류가 발생했습니다.' });
  }
});

app.put('/api/timers/:id', async (req, res) => {
  const timer = getTimerById(req.params.id);
  if (!timer) {
    return res.status(404).json({ message: '해당 타이머를 찾을 수 없습니다.' });
  }

  const { name, duration } = req.body ?? {};
  const now = Date.now();

  if (typeof name === 'string' && name.trim().length > 0) {
    timer.name = name.trim();
  }

  if (Number.isFinite(duration) && duration > 0) {
    const safeDuration = clampTimerDuration(duration);
    timer.durationMs = safeDuration;
    timer.remainingMs = safeDuration;
    timer.isRunning = false;
    timer.endTime = null;
  }

  timer.updatedAt = now;

  try {
    await persistTimer(timer);
    const payload = createTimerPayload(timer, now);
    broadcastTimers(getTimersPayload(now));
    res.json(payload);
  } catch (error) {
    console.error('Error updating timer:', error);
    res.status(500).json({ message: '타이머를 수정하는 중 오류가 발생했습니다.' });
  }
});

app.post('/api/timers/:id/start', async (req, res) => {
  const timer = getTimerById(req.params.id);
  if (!timer) {
    return res.status(404).json({ message: '해당 타이머를 찾을 수 없습니다.' });
  }

  if (timer.isRunning) {
    return res.json(createTimerPayload(timer));
  }

  const { duration } = req.body ?? {};
  const now = Date.now();

  if (Number.isFinite(duration) && duration > 0) {
    const safeDuration = clampTimerDuration(duration);
    timer.durationMs = safeDuration;
    timer.remainingMs = safeDuration;
  }

  const remaining = getTimerRemaining(timer, now) || timer.durationMs;
  timer.remainingMs = remaining <= 0 ? timer.durationMs : remaining;
  timer.isRunning = true;
  timer.endTime = now + timer.remainingMs;
  timer.updatedAt = now;

  try {
    await persistTimer(timer);
    const payload = createTimerPayload(timer, now);
    broadcastTimers(getTimersPayload(now));
    res.json(payload);
  } catch (error) {
    console.error('Error starting timer:', error);
    res.status(500).json({ message: '타이머를 시작하는 중 오류가 발생했습니다.' });
  }
});

app.post('/api/timers/:id/pause', async (req, res) => {
  const timer = getTimerById(req.params.id);
  if (!timer) {
    return res.status(404).json({ message: '해당 타이머를 찾을 수 없습니다.' });
  }

  if (!timer.isRunning || typeof timer.endTime !== 'number') {
    return res.json(createTimerPayload(timer));
  }

  const now = Date.now();
  timer.remainingMs = getTimerRemaining(timer, now);
  timer.isRunning = false;
  timer.endTime = null;
  timer.updatedAt = now;

  try {
    await persistTimer(timer);
    const payload = createTimerPayload(timer, now);
    broadcastTimers(getTimersPayload(now));
    res.json(payload);
  } catch (error) {
    console.error('Error pausing timer:', error);
    res.status(500).json({ message: '타이머를 일시정지하는 중 오류가 발생했습니다.' });
  }
});

app.post('/api/timers/:id/reset', async (req, res) => {
  const timer = getTimerById(req.params.id);
  if (!timer) {
    return res.status(404).json({ message: '해당 타이머를 찾을 수 없습니다.' });
  }

  const now = Date.now();
  timer.remainingMs = timer.durationMs;
  timer.isRunning = false;
  timer.endTime = null;
  timer.updatedAt = now;

  try {
    await persistTimer(timer);
    const payload = createTimerPayload(timer, now);
    broadcastTimers(getTimersPayload(now));
    res.json(payload);
  } catch (error) {
    console.error('Error resetting timer:', error);
    res.status(500).json({ message: '타이머를 초기화하는 중 오류가 발생했습니다.' });
  }
});

app.post('/api/timers/:id/toggle-repeat', async (req, res) => {
  const timer = getTimerById(req.params.id);
  if (!timer) {
    return res.status(404).json({ message: '해당 타이머를 찾을 수 없습니다.' });
  }

  timer.repeatEnabled = !timer.repeatEnabled;
  timer.updatedAt = Date.now();

  try {
    await persistTimer(timer);
    const payload = createTimerPayload(timer, timer.updatedAt);
    broadcastTimers(getTimersPayload(timer.updatedAt));
    res.json(payload);
  } catch (error) {
    console.error('Error toggling repeat mode:', error);
    res.status(500).json({ message: '반복 설정을 변경하는 중 오류가 발생했습니다.' });
  }
});

setInterval(async () => {
  if (timers.size === 0) {
    return;
  }

  const now = Date.now();
  let hasChanged = false;
  const updateTasks = [];

  for (const timer of timers.values()) {
    if (!timer.isRunning || typeof timer.endTime !== 'number') {
      continue;
    }

    const remaining = timer.endTime - now;
    if (remaining > 0) {
      continue;
    }

    if (timer.repeatEnabled) {
      timer.remainingMs = timer.durationMs;
      timer.endTime = now + timer.durationMs;
      timer.updatedAt = now;
      updateTasks.push(persistTimer(timer));
    } else {
      timer.isRunning = false;
      timer.remainingMs = 0;
      timer.endTime = null;
      timer.updatedAt = now;
      updateTasks.push(persistTimer(timer));
    }
    hasChanged = true;
  }

  if (hasChanged) {
    if (updateTasks.length > 0) {
      await Promise.allSettled(updateTasks);
    }
    broadcastTimers(getTimersPayload(now));
  }
}, 250);

setInterval(() => {
  const keepAliveMessage = ':keep-alive\n\n';
  for (const client of timerClients) {
    try {
      client.write(keepAliveMessage);
    } catch (error) {
      timerClients.delete(client);
    }
  }
}, 20000);

initializeDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error('Database initialization failed:', error);
    process.exit(1);
  });
