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
