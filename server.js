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
  console.warn('[res_hub] ⚠️  DATABASE_URL not set — using local fallback');
}

console.log('[res_hub] Starting with PORT=' + PORT);
console.log('[res_hub] DATABASE_URL present:', !!process.env.DATABASE_URL);

// ─── PostgreSQL Pool ─────────────────────────────────────────────────────────
// Always use SSL if DATABASE_URL is from an external provider (not localhost)
const isLocal = DATABASE_URL.includes('localhost') || DATABASE_URL.includes('127.0.0.1');

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  statement_timeout: 10000,    // Kill queries that take > 10s
  query_timeout: 10000,        // Kill queries that take > 10s
});

pool.on('error', (err) => {
  console.error('[res_hub] Pool error:', err.message);
});

pool.on('connect', () => {
  console.log('[res_hub] Pool: new client connected');
});

// ─── Retry helper ────────────────────────────────────────────────────────────
async function connectWithRetry(maxRetries = 5) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const client = await pool.connect();
      console.log('[res_hub] ✅ Connected to PostgreSQL (attempt ' + attempt + ')');
      client.release();
      return;
    } catch (err) {
      console.error('[res_hub] ⏳ Connection attempt ' + attempt + '/' + maxRetries + ' failed: ' + err.message);
      if (attempt === maxRetries) {
        throw new Error('Could not connect to PostgreSQL after ' + maxRetries + ' attempts');
      }
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
      await new Promise(function (r) { setTimeout(r, delay); });
    }
  }
}

// ─── Database Initialization ─────────────────────────────────────────────────
async function initDatabase() {
  const client = await pool.connect();
  try {
    // Check if tables already exist and have data
    const tableCheck = await client.query(
      "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'departments') AS departments_exist"
    );

    if (tableCheck.rows[0].departments_exist) {
      const countCheck = await client.query('SELECT COUNT(*) AS cnt FROM departments');
      if (parseInt(countCheck.rows[0].cnt) > 0) {
        console.log('[res_hub] ✅ Database already initialized (' + countCheck.rows[0].cnt + ' departments)');
        return;
      }
    }

    console.log('[res_hub] 🔧 Creating tables...');

    await client.query(`
      CREATE TABLE IF NOT EXISTS departments (
        id BIGSERIAL PRIMARY KEY,
        name VARCHAR(150) NOT NULL,
        short_code VARCHAR(20) UNIQUE,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS semesters (
        id BIGSERIAL PRIMARY KEY,
        semester_number INTEGER NOT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS subjects (
        id BIGSERIAL PRIMARY KEY,
        department_id BIGINT NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
        semester_id BIGINT NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
        subject_code VARCHAR(20) NOT NULL,
        subject_name VARCHAR(150) NOT NULL,
        credits INTEGER DEFAULT 4,
        created_at TIMESTAMP DEFAULT NOW(),
        CONSTRAINT unique_subject_entry UNIQUE (department_id, semester_id, subject_code)
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS modules (
        id BIGSERIAL PRIMARY KEY,
        subject_id BIGINT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
        module_number INTEGER NOT NULL,
        module_title VARCHAR(150) NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        CONSTRAINT check_module_limit CHECK (module_number >= 1 AND module_number <= 5)
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS topics (
        id BIGSERIAL PRIMARY KEY,
        module_id BIGINT NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
        topic_name VARCHAR(200) NOT NULL,
        description TEXT,
        order_num INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_subject_lookup ON subjects(department_id, semester_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_module_lookup ON modules(subject_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_topic_lookup ON topics(module_id)');

    console.log('[res_hub] ✅ Tables created.');

    // Load data.json
    var dataPath = path.join(__dirname, 'data.json');
    if (!fs.existsSync(dataPath)) {
      console.warn('[res_hub] ⚠️ data.json not found, skipping seed.');
      return;
    }

    console.log('[res_hub] 📦 Loading data.json...');
    var rawData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

    // ── Insert Departments (fields are correct) ──
    console.log('[res_hub]   → Inserting ' + rawData.departments.length + ' departments...');
    for (var di = 0; di < rawData.departments.length; di++) {
      var dept = rawData.departments[di];
      await client.query(
        'INSERT INTO departments (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING',
        [dept.id, dept.name]
      );
    }

    // ── Insert Semesters (fields are correct) ──
    console.log('[res_hub]   → Inserting ' + rawData.semesters.length + ' semesters...');
    for (var si = 0; si < rawData.semesters.length; si++) {
      var sem = rawData.semesters[si];
      await client.query(
        'INSERT INTO semesters (id, semester_number) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING',
        [sem.id, sem.semester_number]
      );
    }

    // ── Insert Subjects (fields are REMAPPED) ──
    // data.json: { id, subject_name(=dept_id), department_id(=code), semester_id(=name) }
    console.log('[res_hub]   → Inserting ' + rawData.subjects.length + ' subjects...');
    var subjectsByDept = {};
    for (var sj = 0; sj < rawData.subjects.length; sj++) {
      var s = rawData.subjects[sj];
      var deptId = s.subject_name; // Actually department_id
      if (!subjectsByDept[deptId]) subjectsByDept[deptId] = [];
      subjectsByDept[deptId].push(s);
    }
    var deptKeys = Object.keys(subjectsByDept);
    for (var dk = 0; dk < deptKeys.length; dk++) {
      var deptSubjects = subjectsByDept[deptKeys[dk]];
      for (var ds = 0; ds < deptSubjects.length; ds++) {
        var sub = deptSubjects[ds];
        var semesterId = Math.floor(ds / 8) + 1;
        await client.query(
          'INSERT INTO subjects (id, department_id, semester_id, subject_code, subject_name) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING',
          [sub.id, sub.subject_name, semesterId, sub.department_id, sub.semester_id]
        );
      }
    }

    // ── Insert Modules (fields are REMAPPED) ──
    // data.json: { id, module_number(=subject_id), module_title(=mod_num), subject_id(=title) }
    console.log('[res_hub]   → Inserting ' + rawData.modules.length + ' modules...');
    for (var mi = 0; mi < rawData.modules.length; mi++) {
      var m = rawData.modules[mi];
      await client.query(
        'INSERT INTO modules (id, subject_id, module_number, module_title) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING',
        [m.id, m.module_number, m.module_title, m.subject_id]
      );
    }

    // ── Insert Topics (fields are REMAPPED) ──
    // data.json: { id, topic_name(=module_id), module_id(=topic_name) }
    console.log('[res_hub]   → Inserting ' + rawData.topics.length + ' topics...');
    var BATCH_SIZE = 500;
    for (var ti = 0; ti < rawData.topics.length; ti += BATCH_SIZE) {
      var batch = rawData.topics.slice(ti, ti + BATCH_SIZE);
      var values = [];
      var params = [];
      for (var bi = 0; bi < batch.length; bi++) {
        var t = batch[bi];
        var offset = bi * 4;
        values.push('($' + (offset + 1) + ', $' + (offset + 2) + ', $' + (offset + 3) + ', $' + (offset + 4) + ')');
        params.push(t.id, t.topic_name, t.module_id, 1);
      }
      await client.query(
        'INSERT INTO topics (id, module_id, topic_name, order_num) VALUES ' + values.join(', ') + ' ON CONFLICT (id) DO NOTHING',
        params
      );
    }

    // Reset sequences
    await client.query("SELECT setval('departments_id_seq', COALESCE((SELECT MAX(id) FROM departments), 1))");
    await client.query("SELECT setval('semesters_id_seq', COALESCE((SELECT MAX(id) FROM semesters), 1))");
    await client.query("SELECT setval('subjects_id_seq', COALESCE((SELECT MAX(id) FROM subjects), 1))");
    await client.query("SELECT setval('modules_id_seq', COALESCE((SELECT MAX(id) FROM modules), 1))");
    await client.query("SELECT setval('topics_id_seq', COALESCE((SELECT MAX(id) FROM topics), 1))");

    console.log('[res_hub] ✅ Database seeded successfully!');
  } catch (err) {
    console.error('[res_hub] ❌ Database init error:', err.message);
    console.error(err.stack);
    throw err;
  } finally {
    client.release();
  }
}

// ─── Express App ─────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());

// Request logging — see every request in Railway logs
app.use(function (req, res, next) {
  var start = Date.now();
  res.on('finish', function () {
    console.log('[res_hub] ' + req.method + ' ' + req.url + ' → ' + res.statusCode + ' (' + (Date.now() - start) + 'ms)');
  });
  next();
});

// Serve ONLY specific static files — NOT the entire project root
// This prevents exposing server.js, data.json, .env, etc.
app.use(express.static(path.join(__dirname, 'public')));

// ─── API: Ping (no DB, instant response) ─────────────────────────────────────
app.get('/api/ping', function (req, res) {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── API: Health Check ───────────────────────────────────────────────────────
app.get('/api/health', async function (req, res) {
  try {
    console.log('[res_hub] Health check: querying DB...');
    var result = await pool.query('SELECT NOW() AS server_time, COUNT(*) AS dept_count FROM departments');
    console.log('[res_hub] Health check: query succeeded');
    res.json({
      status: 'ok',
      database: 'connected',
      serverTime: result.rows[0].server_time,
      departmentCount: parseInt(result.rows[0].dept_count),
      poolTotal: pool.totalCount,
      poolIdle: pool.idleCount,
      poolWaiting: pool.waitingCount,
    });
  } catch (err) {
    console.error('[res_hub] Health check FAILED:', err.message);
    console.error(err.stack);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ─── API: Departments ────────────────────────────────────────────────────────
app.get('/api/departments', async function (req, res) {
  try {
    var result = await pool.query('SELECT id, name FROM departments ORDER BY id');
    res.json(result.rows);
  } catch (err) {
    console.error('[res_hub] GET /api/departments error:', err.message);
    res.status(500).json({ error: 'Failed to fetch departments' });
  }
});

// ─── API: Semesters ──────────────────────────────────────────────────────────
app.get('/api/semesters', async function (req, res) {
  try {
    var result = await pool.query('SELECT id, semester_number FROM semesters ORDER BY semester_number');
    res.json(result.rows);
  } catch (err) {
    console.error('[res_hub] GET /api/semesters error:', err.message);
    res.status(500).json({ error: 'Failed to fetch semesters' });
  }
});

// ─── API: Subjects (by department + semester) ────────────────────────────────
app.get('/api/subjects/:deptId/:semId', async function (req, res) {
  try {
    var deptId = req.params.deptId;
    var semId = req.params.semId;
    var result = await pool.query(
      'SELECT id, subject_name, subject_code FROM subjects WHERE department_id = $1 AND semester_id = $2 ORDER BY subject_code',
      [deptId, semId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[res_hub] GET /api/subjects error:', err.message);
    res.status(500).json({ error: 'Failed to fetch subjects' });
  }
});

// ─── API: Modules (by subject) ───────────────────────────────────────────────
app.get('/api/modules/:subjectId', async function (req, res) {
  try {
    var subjectId = req.params.subjectId;
    var result = await pool.query(
      'SELECT id, module_number, module_title FROM modules WHERE subject_id = $1 ORDER BY module_number',
      [subjectId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[res_hub] GET /api/modules error:', err.message);
    res.status(500).json({ error: 'Failed to fetch modules' });
  }
});

// ─── API: Topics (by module) ─────────────────────────────────────────────────
app.get('/api/topics/:moduleId', async function (req, res) {
  try {
    var moduleId = req.params.moduleId;
    var result = await pool.query(
      'SELECT id, topic_name FROM topics WHERE module_id = $1 ORDER BY order_num, id',
      [moduleId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[res_hub] GET /api/topics error:', err.message);
    res.status(500).json({ error: 'Failed to fetch topics' });
  }
});

// ─── API: Search (placeholder for n8n integration) ───────────────────────────
app.post('/api/search', async function (req, res) {
  try {
    var topicId = req.body.topicId;
    var topicName = req.body.topicName;
    console.log('[res_hub] 🔍 Search — topic: "' + topicName + '" (id: ' + topicId + ')');
    res.json({
      message: 'Search triggered for "' + topicName + '"',
      topicId: topicId,
      topicName: topicName,
      results: [],
    });
  } catch (err) {
    console.error('[res_hub] POST /api/search error:', err.message);
    res.status(500).json({ error: 'Search failed' });
  }
});

// ─── Serve index.html for root and SPA fallback ─────────────────────────────
app.get('/', function (req, res) {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// SPA fallback — catch any unmatched GET requests and serve index.html
app.use(function (req, res) {
  // Only serve index.html for non-API GET requests
  if (req.method === 'GET' && !req.url.startsWith('/api/')) {
    res.sendFile(path.join(__dirname, 'index.html'));
  } else {
    res.status(404).json({ error: 'Not found', path: req.url });
  }
});

// ─── Global error handler ────────────────────────────────────────────────────
app.use(function (err, req, res, next) {
  console.error('[res_hub] Unhandled error:', err.message);
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

// ─── Start Server ────────────────────────────────────────────────────────────
async function start() {
  try {
    await connectWithRetry(5);
    await initDatabase();

    app.listen(PORT, function () {
      console.log('[res_hub] 🚀 Server running on port ' + PORT);
      console.log('[res_hub] 🔗 http://localhost:' + PORT);
      console.log('[res_hub] Pool: total=' + pool.totalCount + ' idle=' + pool.idleCount + ' waiting=' + pool.waitingCount);
    });
  } catch (err) {
    console.error('[res_hub] ❌ Failed to start:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

start();