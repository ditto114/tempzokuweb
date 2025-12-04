const express = require('express');
const path = require('path');
const mysql = require('mysql2/promise');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 47984;

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'dito1121!',
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
};

const databaseName = process.env.DB_NAME || 'raid_distribution';

let pool;

const SESSION_COOKIE_NAME = 'sessionToken';
const SESSION_DURATION_MS = 24 * 60 * 60 * 1000;
const sessions = new Map();

const DEFAULT_TIMER_DURATION_MS = 15 * 60 * 1000;
const MIN_TIMER_DURATION_MS = 5 * 1000;
const MAX_TIMER_DURATION_MS = 3 * 60 * 60 * 1000;

const DEFAULT_CHANNEL_CODE = 'ca01';
const CHANNEL_CODE_MAX_LENGTH = 20;
const knownChannels = new Set([DEFAULT_CHANNEL_CODE]);
const timerClientsByChannel = new Map();
const timersByChannel = new Map([[DEFAULT_CHANNEL_CODE, new Map()]]);

const DEFAULT_GRID_SETTINGS = Object.freeze({ columns: 3, rows: 2 });
const GRID_SETTINGS_RANGE = Object.freeze({ min: 1, max: 6 });
const gridSettingsByChannel = new Map([
  [DEFAULT_CHANNEL_CODE, { ...DEFAULT_GRID_SETTINGS }],
]);
const LOGIN_PAGE_PATH = '/login.html';

function normalizeChannelCode(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.slice(0, CHANNEL_CODE_MAX_LENGTH);
}

function registerChannel(rawChannelCode) {
  const channelCode = normalizeChannelCode(rawChannelCode) || DEFAULT_CHANNEL_CODE;
  knownChannels.add(channelCode);
  if (!timersByChannel.has(channelCode)) {
    timersByChannel.set(channelCode, new Map());
  }
  if (!gridSettingsByChannel.has(channelCode)) {
    gridSettingsByChannel.set(channelCode, { ...DEFAULT_GRID_SETTINGS });
  }
  return channelCode;
}

function isChannelAvailable(channelCode) {
  return knownChannels.has(channelCode);
}

function getChannelTimers(channelCode, { createIfMissing = false } = {}) {
  if (!channelCode) {
    return null;
  }
  const existing = timersByChannel.get(channelCode);
  if (existing) {
    return existing;
  }
  if (!createIfMissing) {
    return null;
  }
  const created = new Map();
  timersByChannel.set(channelCode, created);
  return created;
}

function getChannelClients(channelCode) {
  let clients = timerClientsByChannel.get(channelCode);
  if (!clients) {
    clients = new Set();
    timerClientsByChannel.set(channelCode, clients);
  }
  return clients;
}

function getGridSettings(channelCode) {
  if (!channelCode || !gridSettingsByChannel.has(channelCode)) {
    return { ...DEFAULT_GRID_SETTINGS };
  }
  return normalizeGridSettings(gridSettingsByChannel.get(channelCode));
}

function hashPassword(password) {
  return crypto.createHash('sha256').update(String(password ?? '')).digest('hex');
}

function parseCookies(req) {
  const header = req.headers?.cookie;
  if (!header) {
    return {};
  }

  return header.split(';').reduce((acc, pair) => {
    const [name, ...rest] = pair.trim().split('=');
    if (!name) {
      return acc;
    }
    const value = rest.join('=');
    acc[name] = decodeURIComponent(value || '');
    return acc;
  }, {});
}

function setSessionCookie(res, token, expiresAt) {
  const maxAgeSeconds = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
  const cookie = `${SESSION_COOKIE_NAME}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
  res.setHeader('Set-Cookie', cookie);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
}

function getSessionInfo(req) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE_NAME];
  if (!token) {
    return null;
  }
  const session = sessions.get(token);
  if (!session) {
    return null;
  }
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  return { token, session };
}

function refreshSession(res, token, session) {
  session.expiresAt = Date.now() + SESSION_DURATION_MS;
  sessions.set(token, session);
  setSessionCookie(res, token, session.expiresAt);
}

function createSession(username) {
  const token = crypto.randomBytes(32).toString('hex');
  const session = {
    username,
    expiresAt: Date.now() + SESSION_DURATION_MS,
  };
  sessions.set(token, session);
  return { token, session };
}

function requireApiAuth(req, res, next) {
  const sessionInfo = getSessionInfo(req);
  if (!sessionInfo) {
    return res.status(401).json({ message: '로그인이 필요합니다.' });
  }
  refreshSession(res, sessionInfo.token, sessionInfo.session);
  req.session = { username: sessionInfo.session.username };
  return next();
}

function requireChannel(req, res, next) {
  const rawChannelCode = req.query?.channelCode ?? req.body?.channelCode;
  const channelCode = normalizeChannelCode(rawChannelCode);
  if (!channelCode) {
    return res.status(400).json({ message: '채널 코드를 입력해주세요.' });
  }
  if (!isChannelAvailable(channelCode)) {
    return res.status(404).json({ message: '존재하지 않는 채널 코드입니다.' });
  }
  registerChannel(channelCode);
  req.channelCode = channelCode;
  return next();
}

function clampTimerDuration(value) {
  if (!Number.isFinite(value)) {
    return DEFAULT_TIMER_DURATION_MS;
  }
  if (value === 0) {
    return 0;
  }
  if (value < 0) {
    return DEFAULT_TIMER_DURATION_MS;
  }
  return Math.min(Math.max(value, MIN_TIMER_DURATION_MS), MAX_TIMER_DURATION_MS);
}

function getTimerRemaining(timer, now = Date.now()) {
  if (!timer) {
    return 0;
  }
  if (timer.durationMs === 0) {
    if (timer.isRunning && typeof timer.endTime === 'number') {
      const elapsed = now - timer.endTime + Math.max(0, Number.isFinite(timer.remainingMs) ? timer.remainingMs : 0);
      return Math.max(0, elapsed);
    }
    return Math.max(0, Number.isFinite(timer.remainingMs) ? timer.remainingMs : 0);
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
    swipeToReset: Boolean(timer.swipeToReset),
    displayOrder: timer.displayOrder ?? timer.id,
    endTime: timer.isRunning ? timer.endTime : null,
    updatedAt: now,
  };
}

function clampGridValue(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(
    GRID_SETTINGS_RANGE.min,
    Math.min(GRID_SETTINGS_RANGE.max, Math.floor(numeric)),
  );
}

function normalizeGridSettings(raw = {}) {
  const columns = clampGridValue(
    raw.columns ?? DEFAULT_GRID_SETTINGS.columns,
    DEFAULT_GRID_SETTINGS.columns,
  );
  const rows = clampGridValue(
    raw.rows ?? DEFAULT_GRID_SETTINGS.rows,
    DEFAULT_GRID_SETTINGS.rows,
  );
  return { columns, rows };
}

function getTimersPayload(channelCode, now = Date.now()) {
  if (!isChannelAvailable(channelCode)) {
    return null;
  }
  const channelTimers = getChannelTimers(channelCode);
  if (!channelTimers) {
    return null;
  }
  return {
    timers: Array.from(channelTimers.values())
      .sort((a, b) => {
        const orderA = Number.isFinite(a.displayOrder) ? a.displayOrder : a.id;
        const orderB = Number.isFinite(b.displayOrder) ? b.displayOrder : b.id;
        if (orderA !== orderB) {
          return orderA - orderB;
        }
        return a.id - b.id;
      })
      .map((timer) => createTimerPayload(timer, now)),
    gridSettings: getGridSettings(channelCode),
  };
}

function broadcastTimers(channelCode, payload = getTimersPayload(channelCode)) {
  if (!payload) {
    return;
  }
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  const clients = timerClientsByChannel.get(channelCode);
  if (!clients) {
    return;
  }
  for (const client of clients) {
    try {
      client.write(data);
    } catch (error) {
      clients.delete(client);
    }
  }
}

function sendTimersState(response, channelCode, payload = getTimersPayload(channelCode)) {
  if (!payload) {
    return;
  }
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function generateTimerName(channelCode = DEFAULT_CHANNEL_CODE) {
  const timersInChannel = getChannelTimers(channelCode, { createIfMissing: true });
  const existingNames = new Set(
    Array.from(timersInChannel.values(), (timer) => timer.name),
  );
  let index = timersInChannel.size + 1;
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
    `UPDATE timers SET name = ?, duration_ms = ?, remaining_ms = ?, is_running = ?, repeat_enabled = ?, swipe_to_reset = ?, end_time = ?, display_order = ? WHERE id = ? AND channel_code = ?`,
    [
      timer.name,
      Math.floor(timer.durationMs),
      remainingMs,
      timer.isRunning ? 1 : 0,
      timer.repeatEnabled ? 1 : 0,
      timer.swipeToReset ? 1 : 0,
      endTime,
      timer.displayOrder ?? 0,
      timer.id,
      timer.channelCode,
    ],
  );
}

async function createTimerInDatabase({ name, durationMs, channelCode }) {
  if (!pool) {
    throw new Error('Database connection is not initialized.');
  }
  const [rows] = await pool.query(
    'SELECT COALESCE(MAX(display_order), -1) AS maxOrder FROM timers WHERE channel_code = ?',
    [channelCode],
  );
  const nextOrder = Number(rows?.[0]?.maxOrder ?? -1) + 1;
  const [result] = await pool.query(
    `INSERT INTO timers (name, duration_ms, remaining_ms, is_running, repeat_enabled, swipe_to_reset, end_time, display_order, channel_code) VALUES (?, ?, ?, 0, 0, 0, NULL, ?, ?)`,
    [name, Math.floor(durationMs), Math.floor(durationMs), nextOrder, channelCode],
  );
  return { id: result.insertId, displayOrder: nextOrder };
}

async function deleteTimerFromDatabase(id, channelCode) {
  if (!pool) {
    throw new Error('Database connection is not initialized.');
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      'SELECT display_order FROM timers WHERE id = ? AND channel_code = ?',
      [id, channelCode],
    );
    if (!Array.isArray(rows) || rows.length === 0) {
      await connection.rollback();
      return null;
    }

    const displayOrder = Number(rows[0].display_order ?? 0);
    await connection.query('DELETE FROM timers WHERE id = ? AND channel_code = ?', [id, channelCode]);
    await connection.commit();
    return displayOrder;
  } catch (error) {
    try {
      await connection.rollback();
    } catch (rollbackError) {
      console.error('Failed to rollback timer deletion:', rollbackError);
    }
    throw error;
  } finally {
    connection.release();
  }
}

async function loadTimersFromDatabase() {
  if (!pool) {
    return;
  }

  const [rows] = await pool.query(
    `SELECT id, name, duration_ms, remaining_ms, is_running, repeat_enabled, swipe_to_reset, end_time, display_order, channel_code FROM timers ORDER BY channel_code ASC, display_order ASC, id ASC`,
  );

  const now = Date.now();
  if (knownChannels.size === 0) {
    registerChannel(DEFAULT_CHANNEL_CODE);
  }
  timersByChannel.clear();
  for (const channelCode of knownChannels) {
    timersByChannel.set(channelCode, new Map());
  }
  const updates = [];

  for (const row of rows) {
    const rawChannelCode = row.channel_code || DEFAULT_CHANNEL_CODE;
    const channelCode = registerChannel(rawChannelCode);
    const duration = clampTimerDuration(Number(row.duration_ms));
    const endTime = row.end_time != null ? Number(row.end_time) : null;
    const timer = {
      id: row.id,
      name: row.name || generateTimerName(),
      durationMs: duration,
      remainingMs: Math.max(0, Number(row.remaining_ms) || duration),
      isRunning: Boolean(row.is_running),
      repeatEnabled: Boolean(row.repeat_enabled),
      swipeToReset: Boolean(row.swipe_to_reset),
      displayOrder: Number.isFinite(row.display_order) ? Number(row.display_order) : row.id,
      endTime: typeof endTime === 'number' && Number.isFinite(endTime) ? endTime : null,
      channelCode,
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

    const channelTimers = getChannelTimers(channelCode, { createIfMissing: true });
    channelTimers.set(timer.id, timer);
  }

  const defaultChannelTimers = getChannelTimers(DEFAULT_CHANNEL_CODE, { createIfMissing: true });
  if (defaultChannelTimers.size === 0) {
    const name = generateTimerName(DEFAULT_CHANNEL_CODE);
    const duration = DEFAULT_TIMER_DURATION_MS;
    const { id: insertId, displayOrder } = await createTimerInDatabase({
      name,
      durationMs: duration,
      channelCode: DEFAULT_CHANNEL_CODE,
    });
    defaultChannelTimers.set(insertId, {
      id: insertId,
      name,
      durationMs: duration,
      remainingMs: duration,
      isRunning: false,
      repeatEnabled: false,
      swipeToReset: false,
      displayOrder,
      endTime: null,
      channelCode: DEFAULT_CHANNEL_CODE,
      updatedAt: now,
    });
  }

  if (updates.length > 0) {
    await Promise.allSettled(updates);
  }
}

async function loadGridSettingsFromDatabase() {
  if (!pool) {
    return;
  }

  knownChannels.clear();
  registerChannel(DEFAULT_CHANNEL_CODE);
  gridSettingsByChannel.clear();
  const [rows] = await pool.query(
    'SELECT channel_code, value FROM timer_settings WHERE name = ?',
    ['grid'],
  );
  let hasDefaultChannelSettings = false;

  for (const row of rows) {
    const channelCode = registerChannel(row.channel_code || DEFAULT_CHANNEL_CODE);
    let parsedValue = row.value;
    if (typeof parsedValue === 'string') {
      try {
        parsedValue = JSON.parse(parsedValue);
      } catch (error) {
        parsedValue = DEFAULT_GRID_SETTINGS;
      }
    }
    gridSettingsByChannel.set(channelCode, normalizeGridSettings(parsedValue));
    if (channelCode === DEFAULT_CHANNEL_CODE) {
      hasDefaultChannelSettings = true;
    }
  }

  if (!hasDefaultChannelSettings) {
    gridSettingsByChannel.set(DEFAULT_CHANNEL_CODE, { ...DEFAULT_GRID_SETTINGS });
    try {
      await pool.query(
        'INSERT INTO timer_settings (channel_code, name, value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
        [DEFAULT_CHANNEL_CODE, 'grid', JSON.stringify(DEFAULT_GRID_SETTINGS)],
      );
    } catch (error) {
      console.error('Failed to persist default grid settings:', error);
    }
  }

  knownChannels.forEach((channelCode) => {
    if (!gridSettingsByChannel.has(channelCode)) {
      gridSettingsByChannel.set(channelCode, { ...DEFAULT_GRID_SETTINGS });
    }
  });
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
      included TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
  const [includedColumn] = await connection.query(
    "SHOW COLUMNS FROM members LIKE 'included'",
  );
  if (includedColumn.length === 0) {
    await connection.query(
      'ALTER TABLE members ADD COLUMN included TINYINT(1) NOT NULL DEFAULT 1 AFTER job',
    );
  }
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
    CREATE TABLE IF NOT EXISTS admins (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(100) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
  const [existingAdminRows] = await connection.query(
    'SELECT id FROM admins WHERE username = ? LIMIT 1',
    ['cass'],
  );
  if (!Array.isArray(existingAdminRows) || existingAdminRows.length === 0) {
    const passwordHash = hashPassword('9799');
    await connection.query(
      'INSERT INTO admins (username, password_hash) VALUES (?, ?)',
      ['cass', passwordHash],
    );
  }
  await connection.query(`
    CREATE TABLE IF NOT EXISTS timers (
      id INT AUTO_INCREMENT PRIMARY KEY,
      channel_code VARCHAR(20) NOT NULL DEFAULT '${DEFAULT_CHANNEL_CODE}',
      name VARCHAR(255) NOT NULL,
      duration_ms INT NOT NULL,
      remaining_ms INT NOT NULL,
      is_running TINYINT(1) NOT NULL DEFAULT 0,
      repeat_enabled TINYINT(1) NOT NULL DEFAULT 0,
      swipe_to_reset TINYINT(1) NOT NULL DEFAULT 0,
      display_order INT NOT NULL DEFAULT 0,
      end_time BIGINT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS timer_settings (
      channel_code VARCHAR(20) NOT NULL DEFAULT '${DEFAULT_CHANNEL_CODE}',
      name VARCHAR(100) NOT NULL,
      value JSON NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (channel_code, name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
  const [displayOrderColumn] = await connection.query(
    "SHOW COLUMNS FROM timers LIKE 'display_order'",
  );
  if (displayOrderColumn.length === 0) {
    await connection.query(
      'ALTER TABLE timers ADD COLUMN display_order INT NOT NULL DEFAULT 0',
    );
  }

  const [swipeColumn] = await connection.query(
    "SHOW COLUMNS FROM timers LIKE 'swipe_to_reset'",
  );
  if (swipeColumn.length === 0) {
    await connection.query(
      'ALTER TABLE timers ADD COLUMN swipe_to_reset TINYINT(1) NOT NULL DEFAULT 0 AFTER repeat_enabled',
    );
  }

  const [timerChannelColumn] = await connection.query(
    "SHOW COLUMNS FROM timers LIKE 'channel_code'",
  );
  if (timerChannelColumn.length === 0) {
    await connection.query(
      `ALTER TABLE timers ADD COLUMN channel_code VARCHAR(20) NOT NULL DEFAULT '${DEFAULT_CHANNEL_CODE}' AFTER id`,
    );
  }
  await connection.query(
    'UPDATE timers SET channel_code = ? WHERE channel_code IS NULL OR channel_code = ?',
    [DEFAULT_CHANNEL_CODE, ''],
  );

  const [settingsChannelColumn] = await connection.query(
    "SHOW COLUMNS FROM timer_settings LIKE 'channel_code'",
  );
  if (settingsChannelColumn.length === 0) {
    await connection.query(
      `ALTER TABLE timer_settings ADD COLUMN channel_code VARCHAR(20) NOT NULL DEFAULT '${DEFAULT_CHANNEL_CODE}' FIRST`,
    );
  }
  await connection.query(
    'UPDATE timer_settings SET channel_code = ? WHERE channel_code IS NULL OR channel_code = ?',
    [DEFAULT_CHANNEL_CODE, ''],
  );

  const [timerSettingsPrimaryKey] = await connection.query(
    "SHOW INDEX FROM timer_settings WHERE Key_name = 'PRIMARY'",
  );
  const primaryColumns = new Set(timerSettingsPrimaryKey.map((row) => row.Column_name));
  const hasChannelPrimaryKey =
    primaryColumns.has('channel_code') && primaryColumns.has('name') && primaryColumns.size === 2;
  if (!hasChannelPrimaryKey && timerSettingsPrimaryKey.length > 0) {
    await connection.query('ALTER TABLE timer_settings DROP PRIMARY KEY');
    await connection.query('ALTER TABLE timer_settings ADD PRIMARY KEY (channel_code, name)');
  }
  await connection.end();

  pool = mysql.createPool({
    ...dbConfig,
    database: databaseName,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  });

  await loadGridSettingsFromDatabase();
  await loadTimersFromDatabase();
}

app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

app.get(['/login', '/login.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get(['/distribution', '/distribution.html'], (req, res) => {
  const sessionInfo = getSessionInfo(req);
  if (!sessionInfo) {
    const redirectTarget = encodeURIComponent(req.originalUrl || '/distribution.html');
    return res.redirect(`${LOGIN_PAGE_PATH}?redirect=${redirectTarget}`);
  }
  refreshSession(res, sessionInfo.token, sessionInfo.session);
  return res.sendFile(path.join(__dirname, 'public', 'distribution.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body ?? {};

  if (!username || !password) {
    return res.status(400).json({ message: '아이디와 비밀번호를 입력해주세요.' });
  }

  try {
    const [rows] = await pool.query(
      'SELECT id, username, password_hash FROM admins WHERE username = ? LIMIT 1',
      [username],
    );

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(401).json({ message: '아이디 또는 비밀번호가 올바르지 않습니다.' });
    }

    const admin = rows[0];
    const hashedInput = hashPassword(password);

    if (admin.password_hash !== hashedInput) {
      return res.status(401).json({ message: '아이디 또는 비밀번호가 올바르지 않습니다.' });
    }

    const { token, session } = createSession(admin.username);
    setSessionCookie(res, token, session.expiresAt);
    return res.json({ authenticated: true, username: admin.username });
  } catch (error) {
    console.error('Error during login:', error);
    return res.status(500).json({ message: '로그인 처리 중 오류가 발생했습니다.' });
  }
});

app.post('/api/logout', (req, res) => {
  const sessionInfo = getSessionInfo(req);
  if (sessionInfo) {
    sessions.delete(sessionInfo.token);
  }
  clearSessionCookie(res);
  res.status(204).send();
});

app.get('/api/session', (req, res) => {
  const sessionInfo = getSessionInfo(req);
  if (!sessionInfo) {
    return res.status(401).json({ authenticated: false });
  }
  refreshSession(res, sessionInfo.token, sessionInfo.session);
  return res.json({ authenticated: true, username: sessionInfo.session.username });
});

app.get('/api/members', requireApiAuth, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, nickname, job, included FROM members ORDER BY id ASC');
    const [distributionRows] = await pool.query('SELECT data FROM distributions');

    const outstandingMap = new Map();
    const nicknameMap = new Map();

    rows.forEach((row) => {
      const nickname = typeof row.nickname === 'string' ? row.nickname.trim() : '';
      if (!nickname) {
        return;
      }
      const key = nickname.toLowerCase();
      if (!nicknameMap.has(key)) {
        nicknameMap.set(key, []);
      }
      nicknameMap.get(key).push(row.id);
    });

    if (Array.isArray(distributionRows)) {
      distributionRows.forEach((distribution) => {
        const rawData = distribution.data;
        let payload = rawData;
        if (Buffer.isBuffer(rawData)) {
          try {
            payload = JSON.parse(rawData.toString('utf8'));
          } catch (parseError) {
            payload = null;
          }
        } else if (typeof rawData === 'string') {
          try {
            payload = JSON.parse(rawData);
          } catch (parseError) {
            payload = null;
          }
        }
        if (!payload || !Array.isArray(payload.members)) {
          return;
        }
        payload.members.forEach((entry) => {
          const memberId = Number(entry.id);
          if (entry.paid === true) {
            return;
          }
          const finalAmount = Math.max(0, Number(entry.finalAmount ?? 0));
          if (!Number.isFinite(finalAmount) || finalAmount === 0) {
            return;
          }
          const nickname = typeof entry.nickname === 'string' ? entry.nickname.trim() : '';
          const targetIds = new Set();

          if (Number.isFinite(memberId)) {
            targetIds.add(memberId);
          }

          if (nickname) {
            const key = nickname.toLowerCase();
            const mappedIds = nicknameMap.get(key) || [];
            mappedIds.forEach((id) => targetIds.add(id));
          }

          targetIds.forEach((id) => {
            const current = outstandingMap.get(id) ?? 0;
            outstandingMap.set(id, current + finalAmount);
          });
        });
      });
    }

    const payload = rows.map((row) => ({
      id: row.id,
      nickname: row.nickname,
      job: row.job,
      included: row.included === 1 || row.included === true,
      outstandingAmount: Math.max(0, Math.floor(outstandingMap.get(row.id) ?? 0)),
    }));

    res.json(payload);
  } catch (error) {
    console.error('Error fetching members:', error);
    res.status(500).json({ message: '공대원 정보를 불러오는 중 오류가 발생했습니다.' });
  }
});

app.post('/api/members', requireApiAuth, async (req, res) => {
  const { nickname, job } = req.body;

  if (!nickname || !job) {
    return res.status(400).json({ message: '닉네임과 직업을 모두 입력해주세요.' });
  }

  try {
    const [result] = await pool.query('INSERT INTO members (nickname, job) VALUES (?, ?)', [nickname, job]);
    res.status(201).json({ id: result.insertId, nickname, job, included: true, outstandingAmount: 0 });
  } catch (error) {
    console.error('Error adding member:', error);
    res.status(500).json({ message: '공대원 정보를 저장하는 중 오류가 발생했습니다.' });
  }
});

app.patch('/api/members/:id', requireApiAuth, async (req, res) => {
  const { id } = req.params;
  const { included } = req.body || {};

  if (!id || typeof included !== 'boolean') {
    return res.status(400).json({ message: '분배 포함 여부를 올바르게 전달해주세요.' });
  }

  try {
    const [result] = await pool.query('UPDATE members SET included = ? WHERE id = ?', [included ? 1 : 0, id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: '해당 공대원을 찾을 수 없습니다.' });
    }
    res.json({ id: Number(id), included });
  } catch (error) {
    console.error('Error updating member inclusion:', error);
    res.status(500).json({ message: '공대원 정보를 수정하는 중 오류가 발생했습니다.' });
  }
});

app.delete('/api/members/:id', requireApiAuth, async (req, res) => {
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

function normalizeDistributionData(raw = {}) {
  if (!raw) {
    return {};
  }
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch (error) {
      console.error('Error parsing distribution payload:', error);
      return {};
    }
  }
  if (typeof raw === 'object') {
    return raw;
  }
  return {};
}

function summarizeDistributionMembers(payload = {}) {
  const members = Array.isArray(payload.members) ? payload.members : [];
  let paidTrueCount = 0;
  let paidFalseCount = 0;

  members.forEach((member) => {
    if (!member || typeof member !== 'object') {
      return;
    }
    const nickname = typeof member.nickname === 'string' ? member.nickname.trim() : '';
    const job = typeof member.job === 'string' ? member.job.trim() : '';
    if (!(nickname || job || (member.id !== undefined && member.id !== null))) {
      return;
    }

    if (member.paid === true) {
      paidTrueCount += 1;
    } else if (member.paid === false) {
      paidFalseCount += 1;
    }
  });

  return { paidTrueCount, paidFalseCount };
}

app.get('/api/distributions', requireApiAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, title, data, created_at, updated_at FROM distributions ORDER BY created_at DESC, id DESC',
    );
    const enhanced = rows.map((row) => {
      const payload = normalizeDistributionData(row.data);
      const { paidTrueCount, paidFalseCount } = summarizeDistributionMembers(payload);
      return {
        id: row.id,
        title: row.title,
        created_at: row.created_at,
        updated_at: row.updated_at,
        paid_true_count: paidTrueCount,
        paid_false_count: paidFalseCount,
      };
    });
    res.json(enhanced);
  } catch (error) {
    console.error('Error fetching distributions:', error);
    res.status(500).json({ message: '분배표 목록을 불러오는 중 오류가 발생했습니다.' });
  }
});

app.get('/api/distributions/:id', requireApiAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await pool.query('SELECT id, title, data, created_at, updated_at FROM distributions WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ message: '해당 분배표를 찾을 수 없습니다.' });
    }
    const distribution = rows[0];
    const payload = normalizeDistributionData(distribution.data);
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

app.post('/api/distributions', requireApiAuth, async (req, res) => {
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

app.put('/api/distributions/:id', requireApiAuth, async (req, res) => {
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

app.delete('/api/distributions/:id', requireApiAuth, async (req, res) => {
  const { id } = req.params;

  try {
    const [result] = await pool.query('DELETE FROM distributions WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: '해당 분배표를 찾을 수 없습니다.' });
    }
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting distribution:', error);
    res.status(500).json({ message: '분배표를 삭제하는 중 오류가 발생했습니다.' });
  }
});

function getTimerById(channelCode, id) {
  const numericId = Number(id);
  if (!Number.isInteger(numericId)) {
    return null;
  }
  const channelTimers = getChannelTimers(channelCode);
  if (!channelTimers) {
    return null;
  }
  return channelTimers.get(numericId) ?? null;
}

app.get('/api/timers', requireChannel, (req, res) => {
  const payload = getTimersPayload(req.channelCode);
  if (!payload) {
    return res.status(404).json({ message: '해당 채널의 타이머를 찾을 수 없습니다.' });
  }
  return res.json(payload);
});

app.get('/api/timers/stream', requireChannel, (req, res) => {
  const { channelCode } = req;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  } else {
    res.writeHead(200);
  }

  const clients = getChannelClients(channelCode);
  clients.add(res);
  res.write('retry: 5000\n\n');
  sendTimersState(res, channelCode);

  req.on('close', () => {
    clients.delete(res);
  });
});

app.post('/api/timers', requireChannel, async (req, res) => {
  const { channelCode } = req;
  try {
    const name = generateTimerName(channelCode);
    const duration = DEFAULT_TIMER_DURATION_MS;
    const { id: insertId, displayOrder } = await createTimerInDatabase({
      name,
      durationMs: duration,
      channelCode,
    });
    const now = Date.now();
    const timer = {
      id: insertId,
      name,
      durationMs: duration,
      remainingMs: duration,
      isRunning: false,
      repeatEnabled: false,
      swipeToReset: false,
      displayOrder,
      endTime: null,
      channelCode,
      updatedAt: now,
    };
    const channelTimers = getChannelTimers(channelCode, { createIfMissing: true });
    channelTimers.set(insertId, timer);
    const payload = createTimerPayload(timer, now);
    broadcastTimers(channelCode, getTimersPayload(channelCode, now));
    res.status(201).json(payload);
  } catch (error) {
    console.error('Error creating timer:', error);
    res.status(500).json({ message: '타이머를 추가하는 중 오류가 발생했습니다.' });
  }
});

app.put('/api/timers/:id', requireChannel, async (req, res) => {
  const { channelCode } = req;
  const timer = getTimerById(channelCode, req.params.id);
  if (!timer) {
    return res.status(404).json({ message: '해당 타이머를 찾을 수 없습니다.' });
  }

  const { name, duration, swipeToReset } = req.body ?? {};
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

  if (typeof swipeToReset === 'boolean') {
    timer.swipeToReset = swipeToReset;
  }

  timer.updatedAt = now;

  try {
    await persistTimer(timer);
    const payload = createTimerPayload(timer, now);
    broadcastTimers(channelCode, getTimersPayload(channelCode, now));
    res.json(payload);
  } catch (error) {
    console.error('Error updating timer:', error);
    res.status(500).json({ message: '타이머를 수정하는 중 오류가 발생했습니다.' });
  }
});

app.post('/api/timers/:id/start', requireChannel, async (req, res) => {
  const { channelCode } = req;
  const timer = getTimerById(channelCode, req.params.id);
  if (!timer) {
    return res.status(404).json({ message: '해당 타이머를 찾을 수 없습니다.' });
  }

  if (timer.isRunning) {
    return res.json(createTimerPayload(timer));
  }

  const { duration } = req.body ?? {};
  const now = Date.now();

  if (Number.isFinite(duration)) {
    const safeDuration = clampTimerDuration(duration);
    if (safeDuration !== timer.durationMs) {
      timer.durationMs = safeDuration;
      timer.remainingMs = safeDuration === 0 ? 0 : safeDuration;
      timer.isRunning = false;
      timer.endTime = null;
    }
  }

  const isStopwatch = timer.durationMs === 0;
  if (isStopwatch) {
    const elapsed = getTimerRemaining(timer, now);
    timer.remainingMs = elapsed;
    timer.isRunning = true;
    timer.endTime = now;
    timer.updatedAt = now;
  } else {
    const remaining = getTimerRemaining(timer, now) || timer.durationMs;
    timer.remainingMs = remaining <= 0 ? timer.durationMs : remaining;
    timer.isRunning = true;
    timer.endTime = now + timer.remainingMs;
    timer.updatedAt = now;
  }

  try {
    await persistTimer(timer);
    const payload = createTimerPayload(timer, now);
    broadcastTimers(channelCode, getTimersPayload(channelCode, now));
    res.json(payload);
  } catch (error) {
    console.error('Error starting timer:', error);
    res.status(500).json({ message: '타이머를 시작하는 중 오류가 발생했습니다.' });
  }
});

app.post('/api/timers/:id/pause', requireChannel, async (req, res) => {
  const { channelCode } = req;
  const timer = getTimerById(channelCode, req.params.id);
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
    broadcastTimers(channelCode, getTimersPayload(channelCode, now));
    res.json(payload);
  } catch (error) {
    console.error('Error pausing timer:', error);
    res.status(500).json({ message: '타이머를 일시정지하는 중 오류가 발생했습니다.' });
  }
});

app.post('/api/timers/:id/reset', requireChannel, async (req, res) => {
  const { channelCode } = req;
  const timer = getTimerById(channelCode, req.params.id);
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
    broadcastTimers(channelCode, getTimersPayload(channelCode, now));
    res.json(payload);
  } catch (error) {
    console.error('Error resetting timer:', error);
    res.status(500).json({ message: '타이머를 초기화하는 중 오류가 발생했습니다.' });
  }
});

app.post('/api/timers/:id/toggle-repeat', requireChannel, async (req, res) => {
  const { channelCode } = req;
  const timer = getTimerById(channelCode, req.params.id);
  if (!timer) {
    return res.status(404).json({ message: '해당 타이머를 찾을 수 없습니다.' });
  }

  timer.repeatEnabled = !timer.repeatEnabled;
  timer.updatedAt = Date.now();

  try {
    await persistTimer(timer);
    const payload = createTimerPayload(timer, timer.updatedAt);
    broadcastTimers(channelCode, getTimersPayload(channelCode, timer.updatedAt));
    res.json(payload);
  } catch (error) {
    console.error('Error toggling repeat mode:', error);
    res.status(500).json({ message: '반복 설정을 변경하는 중 오류가 발생했습니다.' });
  }
});

app.delete('/api/timers/:id', requireChannel, async (req, res) => {
  const { channelCode } = req;
  const timer = getTimerById(channelCode, req.params.id);
  if (!timer) {
    return res.status(404).json({ message: '해당 타이머를 찾을 수 없습니다.' });
  }

  try {
    const removedOrder = await deleteTimerFromDatabase(timer.id, channelCode);
    const channelTimers = getChannelTimers(channelCode);
    if (removedOrder != null && channelTimers) {
      channelTimers.delete(timer.id);
      channelTimers.forEach((other) => {
        if (other.displayOrder > removedOrder) {
          other.displayOrder -= 1;
        }
      });
      const payload = getTimersPayload(channelCode);
      broadcastTimers(channelCode, payload);
      res.json(payload);
      return;
    }
    res.status(404).json({ message: '해당 타이머를 찾을 수 없습니다.' });
  } catch (error) {
    console.error('Error deleting timer:', error);
    res.status(500).json({ message: '타이머를 삭제하는 중 오류가 발생했습니다.' });
  }
});

app.post('/api/timers/reorder', requireChannel, async (req, res) => {
  const { channelCode } = req;
  const channelTimers = getChannelTimers(channelCode);
  if (!channelTimers) {
    return res.status(404).json({ message: '해당 채널의 타이머가 없습니다.' });
  }

  const { order, slots } = req.body ?? {};
  let layout = [];

  const normalizeSlotValue = (value) => {
    if (value == null || value === '') {
      return null;
    }
    const numeric = Number(value);
    return Number.isInteger(numeric) ? numeric : null;
  };

  if (Array.isArray(slots)) {
    layout = slots.map((value) => normalizeSlotValue(value));
  } else if (Array.isArray(order)) {
    layout = order.map((value) => normalizeSlotValue(value));
  } else {
    return res.status(400).json({ message: '변경할 순서를 전달해주세요.' });
  }

  const assignments = new Map();
  for (let index = 0; index < layout.length; index += 1) {
    const value = layout[index];
    if (value == null) {
      continue;
    }
    const id = Number(value);
    if (!Number.isInteger(id) || !channelTimers.has(id)) {
      return res.status(400).json({ message: '잘못된 타이머 순서입니다.' });
    }
    if (assignments.has(id)) {
      return res.status(400).json({ message: '잘못된 타이머 순서입니다.' });
    }
    assignments.set(id, index);
  }

  for (const id of channelTimers.keys()) {
    if (!assignments.has(id)) {
      layout.push(id);
      assignments.set(id, layout.length - 1);
    }
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    for (const [id, position] of assignments.entries()) {
      await connection.query(
        'UPDATE timers SET display_order = ? WHERE id = ? AND channel_code = ?',
        [position, id, channelCode],
      );
    }
    await connection.commit();
  } catch (error) {
    try {
      await connection.rollback();
    } catch (rollbackError) {
      console.error('Failed to rollback timer reorder:', rollbackError);
    }
    console.error('Error reordering timers:', error);
    connection.release();
    return res.status(500).json({ message: '타이머 순서를 변경하는 중 오류가 발생했습니다.' });
  }

  connection.release();

  const now = Date.now();
  assignments.forEach((position, id) => {
    const timer = channelTimers.get(id);
    if (timer) {
      timer.displayOrder = position;
      timer.updatedAt = now;
    }
  });

  const payload = getTimersPayload(channelCode, now);
  broadcastTimers(channelCode, payload);
  res.json(payload);
});

app.get('/api/timers/grid-settings', requireChannel, (req, res) => {
  res.json({ gridSettings: getGridSettings(req.channelCode) });
});

app.post('/api/timers/grid-settings', requireChannel, async (req, res) => {
  const { channelCode } = req;
  const currentSettings = getGridSettings(channelCode);
  const nextSettings = normalizeGridSettings(req.body ?? {});
  const hasChanged =
    nextSettings.columns !== currentSettings.columns || nextSettings.rows !== currentSettings.rows;

  gridSettingsByChannel.set(channelCode, nextSettings);

  try {
    await pool.query(
      'INSERT INTO timer_settings (channel_code, name, value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
      [channelCode, 'grid', JSON.stringify(nextSettings)],
    );
  } catch (error) {
    console.error('Failed to persist timer grid settings:', error);
    return res.status(500).json({ message: '타이머 그리드 설정을 저장하는 중 오류가 발생했습니다.' });
  }

  if (hasChanged) {
    broadcastTimers(channelCode, getTimersPayload(channelCode));
  }

  res.json({ gridSettings: getGridSettings(channelCode) });
});

setInterval(async () => {
  const now = Date.now();
  const updateTasks = [];
  const changedChannels = new Set();

  timersByChannel.forEach((channelTimers, channelCode) => {
    if (!channelTimers || channelTimers.size === 0) {
      return;
    }

    for (const timer of channelTimers.values()) {
      if (timer.durationMs === 0) {
        continue;
      }

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
      changedChannels.add(channelCode);
    }
  });

  if (updateTasks.length > 0) {
    await Promise.allSettled(updateTasks);
  }

  changedChannels.forEach((channelCode) => {
    broadcastTimers(channelCode, getTimersPayload(channelCode, now));
  });
}, 250);

setInterval(() => {
  const keepAliveMessage = ':keep-alive\n\n';
  for (const clients of timerClientsByChannel.values()) {
    for (const client of clients) {
      try {
        client.write(keepAliveMessage);
      } catch (error) {
        clients.delete(client);
      }
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
