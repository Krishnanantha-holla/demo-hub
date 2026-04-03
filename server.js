'use strict';

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');

// ─── Configuration ───────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://localhost:5432/res_hub';

if (!process.env.DATABASE_URL) {
  console.warn('[res_hub] ⚠️  DATABASE_URL not set — using local fallback: postgresql://localhost:5432/res_hub');
  console.warn('[res_hub]    For Railway: set DATABASE_URL via ${{Postgres.DATABASE_URL}} reference variable');
}

// ─── PostgreSQL Pool ─────────────────────────────────────────────────────────
const isSSL = DATABASE_URL.includes('railway') || DATABASE_URL.includes('neon') || process.env.NODE_ENV === 'production';

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: isSSL ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => {
  console.error('[res_hub] Unexpected pool error:', err.message);
});

// ─── Retry helper ────────────────────────────────────────────────────────────
async function connectWithRetry(maxRetries = 5) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const client = await pool.connect();
      console.log(`[res_hub] ✅ Connected to PostgreSQL (attempt ${attempt})`);
      client.release();
      return;
    } catch (err) {
      console.error(`[res_hub] ⏳ Connection attempt ${attempt}/${maxRetries} failed: ${err.message}`);
      if (attempt === maxRetries) {
        throw new Error('Could not connect to PostgreSQL after ' + maxRetries + ' attempts');
      }
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

// ─── Database Initialization ─────────────────────────────────────────────────
async function initDatabase() {
  const client = await pool.connect();
  try {
    // Check if tables already exist and have data
    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'departments'
      ) AS departments_exist
    `);

    if (tableCheck.rows[0].departments_exist) {
      const countCheck = await client.query('SELECT COUNT(*) AS cnt FROM departments');
      if (parseInt(countCheck.rows[0].cnt) > 0) {
        console.log('[res_hub] ✅ Database already initialized, skipping seed.');
        return;
      }
    }

    console.log('[res_hub] 🔧 Creating tables...');

    // Create tables
    await client.query(`
      CREATE TABLE IF NOT EXISTS departments (
        id BIGSERIAL PRIMARY KEY,
        name VARCHAR(150) NOT NULL,
        short_code VARCHAR(20) UNIQUE,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS semesters (
        id BIGSERIAL PRIMARY KEY,
        semester_number INTEGER NOT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS subjects (
        id BIGSERIAL PRIMARY KEY,
        department_id BIGINT NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
        semester_id BIGINT NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
        subject_code VARCHAR(20) NOT NULL,
        subject_name VARCHAR(150) NOT NULL,
        credits INTEGER DEFAULT 4,
        created_at TIMESTAMP DEFAULT NOW(),
        CONSTRAINT unique_subject_entry UNIQUE (department_id, semester_id, subject_code)
      );

      CREATE TABLE IF NOT EXISTS modules (
        id BIGSERIAL PRIMARY KEY,
        subject_id BIGINT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
        module_number INTEGER NOT NULL,
        module_title VARCHAR(150) NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        CONSTRAINT check_module_limit CHECK (module_number >= 1 AND module_number <= 5)
      );

      CREATE TABLE IF NOT EXISTS topics (
        id BIGSERIAL PRIMARY KEY,
        module_id BIGINT NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
        topic_name VARCHAR(200) NOT NULL,
        description TEXT,
        order_num INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_subject_lookup ON subjects(department_id, semester_id);
      CREATE INDEX IF NOT EXISTS idx_module_lookup ON modules(subject_id);
      CREATE INDEX IF NOT EXISTS idx_topic_lookup ON topics(module_id);
    `);

    console.log('[res_hub] ✅ Tables created.');

    // Load data.json
    const dataPath = path.join(__dirname, 'data.json');
    if (!fs.existsSync(dataPath)) {
      console.warn('[res_hub] ⚠️ data.json not found, skipping seed.');
      return;
    }

    console.log('[res_hub] 📦 Loading data.json...');
    const rawData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

    // ── Insert Departments (fields are correct) ──
    console.log(`[res_hub]   → Inserting ${rawData.departments.length} departments...`);
    for (const dept of rawData.departments) {
      await client.query(
        'INSERT INTO departments (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING',
        [dept.id, dept.name]
      );
    }

    // ── Insert Semesters (fields are correct) ──
    console.log(`[res_hub]   → Inserting ${rawData.semesters.length} semesters...`);
    for (const sem of rawData.semesters) {
      await client.query(
        'INSERT INTO semesters (id, semester_number) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING',
        [sem.id, sem.semester_number]
      );
    }

    // ── Insert Subjects (fields are REMAPPED) ──
    // data.json keys:  { id, subject_name,   department_id, semester_id   }
    // Actual meaning:  { id, department_id,  subject_code,  subject_name  }
    // Missing: semester_id — derive from subject position (8 subjects per semester per dept)
    console.log(`[res_hub]   → Inserting ${rawData.subjects.length} subjects...`);

    // Group subjects by department to derive semester_id
    const subjectsByDept = {};
    for (const s of rawData.subjects) {
      const deptId = s.subject_name; // Actually holds department_id
      if (!subjectsByDept[deptId]) subjectsByDept[deptId] = [];
      subjectsByDept[deptId].push(s);
    }

    for (const deptId of Object.keys(subjectsByDept)) {
      const deptSubjects = subjectsByDept[deptId];
      for (let i = 0; i < deptSubjects.length; i++) {
        const s = deptSubjects[i];
        const semesterId = Math.floor(i / 8) + 1; // 8 subjects per semester
        await client.query(
          `INSERT INTO subjects (id, department_id, semester_id, subject_code, subject_name)
           VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
          [
            s.id,
            s.subject_name,   // Actually department_id
            semesterId,        // Derived from position
            s.department_id,   // Actually subject_code
            s.semester_id      // Actually subject_name
          ]
        );
      }
    }

    // ── Insert Modules (fields are REMAPPED) ──
    // data.json keys:  { id, module_number, module_title, subject_id    }
    // Actual meaning:  { id, subject_id,    module_number, module_title }
    console.log(`[res_hub]   → Inserting ${rawData.modules.length} modules...`);
    for (const m of rawData.modules) {
      await client.query(
        `INSERT INTO modules (id, subject_id, module_number, module_title)
         VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
        [
          m.id,
          m.module_number,  // Actually subject_id
          m.module_title,   // Actually module_number
          m.subject_id      // Actually module_title
        ]
      );
    }

    // ── Insert Topics (fields are REMAPPED) ──
    // data.json keys:  { id, topic_name, module_id       }
    // Actual meaning:  { id, module_id,  topic_name      }
    console.log(`[res_hub]   → Inserting ${rawData.topics.length} topics...`);

    // Batch insert topics for performance (19200 rows)
    const BATCH_SIZE = 500;
    for (let i = 0; i < rawData.topics.length; i += BATCH_SIZE) {
      const batch = rawData.topics.slice(i, i + BATCH_SIZE);
      const values = [];
      const params = [];
      batch.forEach((t, idx) => {
        const offset = idx * 4;
        values.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4})`);
        params.push(
          t.id,
          t.topic_name,  // Actually module_id
          t.module_id,   // Actually topic_name
          1              // order_num default
        );
      });
      await client.query(
        `INSERT INTO topics (id, module_id, topic_name, order_num)
         VALUES ${values.join(', ')} ON CONFLICT (id) DO NOTHING`,
        params
      );
    }

    // Reset sequences to max id
    await client.query(`
      SELECT setval('departments_id_seq', COALESCE((SELECT MAX(id) FROM departments), 1));
      SELECT setval('semesters_id_seq', COALESCE((SELECT MAX(id) FROM semesters), 1));
      SELECT setval('subjects_id_seq', COALESCE((SELECT MAX(id) FROM subjects), 1));
      SELECT setval('modules_id_seq', COALESCE((SELECT MAX(id) FROM modules), 1));
      SELECT setval('topics_id_seq', COALESCE((SELECT MAX(id) FROM topics), 1));
    `);

    console.log('[res_hub] ✅ Database seeded successfully!');
  } catch (err) {
    console.error('[res_hub] ❌ Database initialization error:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

// ─── Express App ─────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());

// Serve static files — index.html at root, public/ for assets
app.use(express.static(path.join(__dirname)));
app.use('/public', express.static(path.join(__dirname, 'public')));

// ─── API: Health Check ───────────────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW() AS server_time, COUNT(*) AS dept_count FROM departments');
    res.json({
      status: 'ok',
      database: 'connected',
      serverTime: result.rows[0].server_time,
      departmentCount: parseInt(result.rows[0].dept_count),
    });
  } catch (err) {
    console.error('[res_hub] Health check failed:', err.message);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ─── API: Departments ────────────────────────────────────────────────────────
app.get('/api/departments', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name FROM departments ORDER BY id'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[res_hub] GET /api/departments error:', err.message);
    res.status(500).json({ error: 'Failed to fetch departments' });
  }
});

// ─── API: Semesters ──────────────────────────────────────────────────────────
app.get('/api/semesters', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, semester_number FROM semesters ORDER BY semester_number'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[res_hub] GET /api/semesters error:', err.message);
    res.status(500).json({ error: 'Failed to fetch semesters' });
  }
});

// ─── API: Subjects (by department + semester) ────────────────────────────────
app.get('/api/subjects/:deptId/:semId', async (req, res) => {
  try {
    const { deptId, semId } = req.params;
    const result = await pool.query(
      `SELECT id, subject_name, subject_code
       FROM subjects
       WHERE department_id = $1 AND semester_id = $2
       ORDER BY subject_code`,
      [deptId, semId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[res_hub] GET /api/subjects error:', err.message);
    res.status(500).json({ error: 'Failed to fetch subjects' });
  }
});

// ─── API: Modules (by subject) ───────────────────────────────────────────────
app.get('/api/modules/:subjectId', async (req, res) => {
  try {
    const { subjectId } = req.params;
    const result = await pool.query(
      `SELECT id, module_number, module_title
       FROM modules
       WHERE subject_id = $1
       ORDER BY module_number`,
      [subjectId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[res_hub] GET /api/modules error:', err.message);
    res.status(500).json({ error: 'Failed to fetch modules' });
  }
});

// ─── API: Topics (by module) ─────────────────────────────────────────────────
app.get('/api/topics/:moduleId', async (req, res) => {
  try {
    const { moduleId } = req.params;
    const result = await pool.query(
      `SELECT id, topic_name
       FROM topics
       WHERE module_id = $1
       ORDER BY order_num, id`,
      [moduleId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[res_hub] GET /api/topics error:', err.message);
    res.status(500).json({ error: 'Failed to fetch topics' });
  }
});

// ─── API: Search (placeholder for n8n integration) ───────────────────────────
app.post('/api/search', async (req, res) => {
  try {
    const { topicId, topicName } = req.body;
    console.log(`[res_hub] 🔍 Search requested — topic: "${topicName}" (id: ${topicId})`);
    res.json({
      message: `Search triggered for "${topicName}"`,
      topicId,
      topicName,
      results: [],
    });
  } catch (err) {
    console.error('[res_hub] POST /api/search error:', err.message);
    res.status(500).json({ error: 'Search failed' });
  }
});

// ─── Fallback: serve index.html for SPA ──────────────────────────────────────
// Using app.use() instead of app.get('*') because Express 5 (path-to-regexp v8)
// no longer supports unnamed wildcard '*'. app.use() catches all unmatched
// requests regardless of HTTP method, which is the correct SPA fallback pattern.
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ─── Start Server ────────────────────────────────────────────────────────────
async function start() {
  try {
    await connectWithRetry(5);
    await initDatabase();

    app.listen(PORT, () => {
      console.log(`[res_hub] 🚀 Server running on port ${PORT}`);
      console.log(`[res_hub]    Local: http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('[res_hub] ❌ Failed to start:', err.message);
    process.exit(1);
  }
}

start();