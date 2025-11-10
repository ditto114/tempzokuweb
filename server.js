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
