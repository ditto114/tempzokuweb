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

const timerState = {
  duration: DEFAULT_TIMER_DURATION_MS,
  remaining: DEFAULT_TIMER_DURATION_MS,
  isRunning: false,
  endTime: null,
  updatedAt: Date.now(),
};

const timerClients = new Set();

function clampTimerDuration(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return DEFAULT_TIMER_DURATION_MS;
  }
  return Math.min(Math.max(value, MIN_TIMER_DURATION_MS), MAX_TIMER_DURATION_MS);
}

function getRemainingTime(now = Date.now()) {
  if (timerState.isRunning && typeof timerState.endTime === 'number') {
    return Math.max(0, timerState.endTime - now);
  }
  return Math.max(0, timerState.remaining);
}

function getTimerPayload(now = Date.now()) {
  const remaining = getRemainingTime(now);
  return {
    duration: timerState.duration,
    remaining,
    isRunning: timerState.isRunning,
    endTime: timerState.isRunning ? timerState.endTime : null,
    updatedAt: now,
  };
}

function broadcastTimerState(payload = getTimerPayload()) {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const client of timerClients) {
    try {
      client.write(data);
    } catch (error) {
      timerClients.delete(client);
    }
  }
}

function sendTimerState(response, payload = getTimerPayload()) {
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
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
  await connection.end();

  pool = mysql.createPool({
    ...dbConfig,
    database: databaseName,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  });
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

app.get('/api/timer', (req, res) => {
  res.json(getTimerPayload());
});

app.get('/api/timer/stream', (req, res) => {
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
  sendTimerState(res);

  req.on('close', () => {
    timerClients.delete(res);
  });
});

app.post('/api/timer/start', (req, res) => {
  if (timerState.isRunning) {
    return res.json(getTimerPayload());
  }

  const { duration } = req.body ?? {};
  const now = Date.now();

  if (Number.isFinite(duration) && duration > 0) {
    const safeDuration = clampTimerDuration(duration);
    timerState.duration = safeDuration;
    timerState.remaining = safeDuration;
  } else if (getRemainingTime(now) <= 0) {
    timerState.remaining = timerState.duration;
  }

  timerState.isRunning = true;
  timerState.endTime = now + getRemainingTime(now);
  timerState.updatedAt = now;

  const payload = getTimerPayload(now);
  broadcastTimerState(payload);
  res.json(payload);
});

app.post('/api/timer/pause', (req, res) => {
  if (!timerState.isRunning || typeof timerState.endTime !== 'number') {
    return res.json(getTimerPayload());
  }

  const now = Date.now();
  timerState.remaining = getRemainingTime(now);
  timerState.isRunning = false;
  timerState.endTime = null;
  timerState.updatedAt = now;

  const payload = getTimerPayload(now);
  broadcastTimerState(payload);
  res.json(payload);
});

app.post('/api/timer/reset', (req, res) => {
  const { duration } = req.body ?? {};
  const now = Date.now();

  if (Number.isFinite(duration) && duration > 0) {
    timerState.duration = clampTimerDuration(duration);
  }

  timerState.remaining = timerState.duration;
  timerState.isRunning = false;
  timerState.endTime = null;
  timerState.updatedAt = now;

  const payload = getTimerPayload(now);
  broadcastTimerState(payload);
  res.json(payload);
});

app.post('/api/timer/duration', (req, res) => {
  const { duration } = req.body ?? {};
  if (!Number.isFinite(duration) || duration <= 0) {
    return res.status(400).json({ message: '유효한 시간을 1초 이상으로 입력해주세요.' });
  }

  const safeDuration = clampTimerDuration(duration);
  const now = Date.now();

  timerState.duration = safeDuration;
  timerState.remaining = safeDuration;
  timerState.updatedAt = now;

  if (timerState.isRunning) {
    timerState.endTime = now + safeDuration;
  } else {
    timerState.endTime = null;
  }

  const payload = getTimerPayload(now);
  broadcastTimerState(payload);
  res.json(payload);
});

setInterval(() => {
  if (!timerState.isRunning || typeof timerState.endTime !== 'number') {
    return;
  }

  const now = Date.now();
  if (now >= timerState.endTime) {
    timerState.isRunning = false;
    timerState.remaining = 0;
    timerState.endTime = null;
    timerState.updatedAt = now;
    broadcastTimerState(getTimerPayload(now));
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
