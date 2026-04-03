'use strict';

var express = require('express');
var cors = require('cors');
var path = require('path');
var fs = require('fs');
var pg = require('pg');
var Pool = pg.Pool;

// ─── Configuration ───────────────────────────────────────────────────────────
var PORT = process.env.PORT || 3000;
var DATABASE_URL = process.env.DATABASE_URL || '';

console.log('[res_hub] Starting with PORT=' + PORT);
console.log('[res_hub] DATABASE_URL present:', !!process.env.DATABASE_URL);

// ─── Database readiness flag ─────────────────────────────────────────────────
var dbReady = false;
var dbError = null;
var pool = null;

// ─── Create pool (only if DATABASE_URL exists) ───────────────────────────────
function createPool() {
  if (!DATABASE_URL) {
    console.warn('[res_hub] ⚠️  No DATABASE_URL — running without database');
    return null;
  }

  var isLocal = DATABASE_URL.includes('localhost') || DATABASE_URL.includes('127.0.0.1');

  var p = new Pool({
    connectionString: DATABASE_URL,
    ssl: isLocal ? false : { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    statement_timeout: 10000,
    query_timeout: 10000,
  });

  p.on('error', function (err) {
    console.error('[res_hub] Pool error:', err.message);
  });

  return p;
}

// ─── DB readiness check middleware ───────────────────────────────────────────
function requireDB(req, res, next) {
  if (!dbReady || !pool) {
    return res.status(503).json({
      error: 'Database not available',
      status: dbError ? 'error' : 'initializing',
      message: dbError || 'Database is still connecting, please retry shortly',
    });
  }
  next();
}

// ─── Connect with retry (non-fatal) ─────────────────────────────────────────
async function connectWithRetry(maxRetries) {
  maxRetries = maxRetries || 5;
  for (var attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      var client = await pool.connect();
      console.log('[res_hub] ✅ Connected to PostgreSQL (attempt ' + attempt + ')');
      client.release();
      return true;
    } catch (err) {
      console.error('[res_hub] ⏳ Connection attempt ' + attempt + '/' + maxRetries + ': ' + err.message);
      if (attempt === maxRetries) {
        return false;
      }
      var delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
      await new Promise(function (r) { setTimeout(r, delay); });
    }
  }
  return false;
}

// ─── Database Initialization ─────────────────────────────────────────────────
async function initDatabase() {
  var client = await pool.connect();
  try {
    var tableCheck = await client.query(
      "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'departments') AS departments_exist"
    );

    if (tableCheck.rows[0].departments_exist) {
      var countCheck = await client.query('SELECT COUNT(*) AS cnt FROM departments');
      if (parseInt(countCheck.rows[0].cnt) > 0) {
        console.log('[res_hub] ✅ Database already initialized (' + countCheck.rows[0].cnt + ' departments)');
        return true;
      }
    }

    console.log('[res_hub] 🔧 Creating tables...');

    await client.query('CREATE TABLE IF NOT EXISTS departments (id BIGSERIAL PRIMARY KEY, name VARCHAR(150) NOT NULL, short_code VARCHAR(20) UNIQUE, created_at TIMESTAMP DEFAULT NOW())');
    await client.query('CREATE TABLE IF NOT EXISTS semesters (id BIGSERIAL PRIMARY KEY, semester_number INTEGER NOT NULL UNIQUE, created_at TIMESTAMP DEFAULT NOW())');
    await client.query('CREATE TABLE IF NOT EXISTS subjects (id BIGSERIAL PRIMARY KEY, department_id BIGINT NOT NULL REFERENCES departments(id) ON DELETE CASCADE, semester_id BIGINT NOT NULL REFERENCES semesters(id) ON DELETE CASCADE, subject_code VARCHAR(20) NOT NULL, subject_name VARCHAR(150) NOT NULL, credits INTEGER DEFAULT 4, created_at TIMESTAMP DEFAULT NOW(), CONSTRAINT unique_subject_entry UNIQUE (department_id, semester_id, subject_code))');
    await client.query('CREATE TABLE IF NOT EXISTS modules (id BIGSERIAL PRIMARY KEY, subject_id BIGINT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE, module_number INTEGER NOT NULL, module_title VARCHAR(150) NOT NULL, description TEXT, created_at TIMESTAMP DEFAULT NOW(), CONSTRAINT check_module_limit CHECK (module_number >= 1 AND module_number <= 5))');
    await client.query('CREATE TABLE IF NOT EXISTS topics (id BIGSERIAL PRIMARY KEY, module_id BIGINT NOT NULL REFERENCES modules(id) ON DELETE CASCADE, topic_name VARCHAR(200) NOT NULL, description TEXT, order_num INTEGER DEFAULT 1, created_at TIMESTAMP DEFAULT NOW())');
    await client.query('CREATE INDEX IF NOT EXISTS idx_subject_lookup ON subjects(department_id, semester_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_module_lookup ON modules(subject_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_topic_lookup ON topics(module_id)');

    console.log('[res_hub] ✅ Tables created.');

    // Load data.json
    var dataPath = path.join(__dirname, 'data.json');
    if (!fs.existsSync(dataPath)) {
      console.warn('[res_hub] ⚠️ data.json not found, skipping seed.');
      return true;
    }

    console.log('[res_hub] 📦 Loading data.json...');
    var rawData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

    // Insert Departments (fields correct)
    console.log('[res_hub]   → ' + rawData.departments.length + ' departments');
    for (var di = 0; di < rawData.departments.length; di++) {
      var dept = rawData.departments[di];
      await client.query('INSERT INTO departments (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING', [dept.id, dept.name]);
    }

    // Insert Semesters (fields correct)
    console.log('[res_hub]   → ' + rawData.semesters.length + ' semesters');
    for (var si = 0; si < rawData.semesters.length; si++) {
      var sem = rawData.semesters[si];
      await client.query('INSERT INTO semesters (id, semester_number) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING', [sem.id, sem.semester_number]);
    }

    // Insert Subjects (REMAPPED: subject_name=dept_id, department_id=code, semester_id=name)
    console.log('[res_hub]   → ' + rawData.subjects.length + ' subjects');
    var subjectsByDept = {};
    for (var sj = 0; sj < rawData.subjects.length; sj++) {
      var s = rawData.subjects[sj];
      var dId = s.subject_name;
      if (!subjectsByDept[dId]) subjectsByDept[dId] = [];
      subjectsByDept[dId].push(s);
    }
    var deptKeys = Object.keys(subjectsByDept);
    for (var dk = 0; dk < deptKeys.length; dk++) {
      var deptSubs = subjectsByDept[deptKeys[dk]];
      for (var ds = 0; ds < deptSubs.length; ds++) {
        var sub = deptSubs[ds];
        var semId = Math.floor(ds / 8) + 1;
        await client.query('INSERT INTO subjects (id, department_id, semester_id, subject_code, subject_name) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING', [sub.id, sub.subject_name, semId, sub.department_id, sub.semester_id]);
      }
    }

    // Insert Modules (REMAPPED: module_number=subject_id, module_title=mod_num, subject_id=title)
    console.log('[res_hub]   → ' + rawData.modules.length + ' modules');
    for (var mi = 0; mi < rawData.modules.length; mi++) {
      var m = rawData.modules[mi];
      await client.query('INSERT INTO modules (id, subject_id, module_number, module_title) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING', [m.id, m.module_number, m.module_title, m.subject_id]);
    }

    // Insert Topics (REMAPPED: topic_name=module_id, module_id=topic_name)
    console.log('[res_hub]   → ' + rawData.topics.length + ' topics');
    var BATCH = 500;
    for (var ti = 0; ti < rawData.topics.length; ti += BATCH) {
      var batch = rawData.topics.slice(ti, ti + BATCH);
      var vals = [];
      var params = [];
      for (var bi = 0; bi < batch.length; bi++) {
        var t = batch[bi];
        var o = bi * 4;
        vals.push('($' + (o+1) + ', $' + (o+2) + ', $' + (o+3) + ', $' + (o+4) + ')');
        params.push(t.id, t.topic_name, t.module_id, 1);
      }
      await client.query('INSERT INTO topics (id, module_id, topic_name, order_num) VALUES ' + vals.join(', ') + ' ON CONFLICT (id) DO NOTHING', params);
    }

    // Reset sequences
    await client.query("SELECT setval('departments_id_seq', COALESCE((SELECT MAX(id) FROM departments), 1))");
    await client.query("SELECT setval('semesters_id_seq', COALESCE((SELECT MAX(id) FROM semesters), 1))");
    await client.query("SELECT setval('subjects_id_seq', COALESCE((SELECT MAX(id) FROM subjects), 1))");
    await client.query("SELECT setval('modules_id_seq', COALESCE((SELECT MAX(id) FROM modules), 1))");
    await client.query("SELECT setval('topics_id_seq', COALESCE((SELECT MAX(id) FROM topics), 1))");

    console.log('[res_hub] ✅ Database seeded!');
    return true;
  } catch (err) {
    console.error('[res_hub] ❌ DB init error:', err.message);
    console.error(err.stack);
    throw err;
  } finally {
    client.release();
  }
}

// ─── Express App ─────────────────────────────────────────────────────────────
var app = express();
app.use(cors());
app.use(express.json());

// Request logging
app.use(function (req, res, next) {
  var start = Date.now();
  res.on('finish', function () {
    console.log('[res_hub] ' + req.method + ' ' + req.url + ' → ' + res.statusCode + ' (' + (Date.now() - start) + 'ms)');
  });
  next();
});

// Static files from public/ only
app.use(express.static(path.join(__dirname, 'public')));

// ─── Health check for Railway (no DB required) ───────────────────────────────
app.get('/health', function (req, res) {
  res.json({ status: 'ok' });
});

// ─── API: Ping (instant, no DB) ──────────────────────────────────────────────
app.get('/api/ping', function (req, res) {
  res.json({ status: 'ok', dbReady: dbReady, timestamp: new Date().toISOString() });
});

// ─── API: DB Status ──────────────────────────────────────────────────────────
app.get('/api/db-status', async function (req, res) {
  if (!pool) {
    return res.status(503).json({ status: 'no_pool', message: 'DATABASE_URL not configured' });
  }
  try {
    var result = await pool.query('SELECT NOW() AS now');
    res.json({
      status: 'connected',
      dbReady: dbReady,
      timestamp: result.rows[0].now,
      pool: { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount },
    });
  } catch (err) {
    res.status(503).json({ status: 'disconnected', error: err.message });
  }
});

// ─── API: Health Check ───────────────────────────────────────────────────────
app.get('/api/health', requireDB, async function (req, res) {
  try {
    var result = await pool.query('SELECT NOW() AS server_time, COUNT(*) AS dept_count FROM departments');
    res.json({
      status: 'ok',
      database: 'connected',
      serverTime: result.rows[0].server_time,
      departmentCount: parseInt(result.rows[0].dept_count),
      pool: { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount },
    });
  } catch (err) {
    console.error('[res_hub] Health check FAILED:', err.message);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ─── API: Departments ────────────────────────────────────────────────────────
app.get('/api/departments', requireDB, async function (req, res) {
  try {
    var result = await pool.query('SELECT id, name FROM departments ORDER BY id');
    res.json(result.rows);
  } catch (err) {
    console.error('[res_hub] /api/departments error:', err.message);
    res.status(500).json({ error: 'Failed to fetch departments' });
  }
});

// ─── API: Semesters ──────────────────────────────────────────────────────────
app.get('/api/semesters', requireDB, async function (req, res) {
  try {
    var result = await pool.query('SELECT id, semester_number FROM semesters ORDER BY semester_number');
    res.json(result.rows);
  } catch (err) {
    console.error('[res_hub] /api/semesters error:', err.message);
    res.status(500).json({ error: 'Failed to fetch semesters' });
  }
});

// ─── API: Subjects ───────────────────────────────────────────────────────────
app.get('/api/subjects/:deptId/:semId', requireDB, async function (req, res) {
  try {
    var result = await pool.query(
      'SELECT id, subject_name, subject_code FROM subjects WHERE department_id = $1 AND semester_id = $2 ORDER BY subject_code',
      [req.params.deptId, req.params.semId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[res_hub] /api/subjects error:', err.message);
    res.status(500).json({ error: 'Failed to fetch subjects' });
  }
});

// ─── API: Modules ────────────────────────────────────────────────────────────
app.get('/api/modules/:subjectId', requireDB, async function (req, res) {
  try {
    var result = await pool.query(
      'SELECT id, module_number, module_title FROM modules WHERE subject_id = $1 ORDER BY module_number',
      [req.params.subjectId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[res_hub] /api/modules error:', err.message);
    res.status(500).json({ error: 'Failed to fetch modules' });
  }
});

// ─── API: Topics ─────────────────────────────────────────────────────────────
app.get('/api/topics/:moduleId', requireDB, async function (req, res) {
  try {
    var result = await pool.query(
      'SELECT id, topic_name FROM topics WHERE module_id = $1 ORDER BY order_num, id',
      [req.params.moduleId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[res_hub] /api/topics error:', err.message);
    res.status(500).json({ error: 'Failed to fetch topics' });
  }
});

// ─── API: Search ─────────────────────────────────────────────────────────────
app.post('/api/search', function (req, res) {
  var topicId = req.body.topicId;
  var topicName = req.body.topicName;
  console.log('[res_hub] 🔍 Search: "' + topicName + '" (id: ' + topicId + ')');
  res.json({ message: 'Search triggered for "' + topicName + '"', topicId: topicId, topicName: topicName, results: [] });
});

// ─── Serve index.html ────────────────────────────────────────────────────────
app.get('/', function (req, res) {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// SPA fallback
app.use(function (req, res) {
  if (req.method === 'GET' && !req.url.startsWith('/api/')) {
    res.sendFile(path.join(__dirname, 'index.html'));
  } else {
    res.status(404).json({ error: 'Not found', path: req.url });
  }
});

// Global error handler
app.use(function (err, req, res, next) {
  console.error('[res_hub] Unhandled:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Background DB initialization ────────────────────────────────────────────
async function initDBInBackground() {
  pool = createPool();

  if (!pool) {
    dbError = 'No DATABASE_URL configured';
    console.warn('[res_hub] ⚠️  Running without database');
    return;
  }

  try {
    var connected = await connectWithRetry(5);
    if (!connected) {
      dbError = 'Could not connect to PostgreSQL after 5 attempts';
      console.error('[res_hub] ❌ ' + dbError);
      console.error('[res_hub] App continues running — DB endpoints will return 503');
      return;
    }

    await initDatabase();
    dbReady = true;
    dbError = null;
    console.log('[res_hub] ✅ Database fully ready!');
  } catch (err) {
    dbError = err.message;
    console.error('[res_hub] ❌ DB init failed: ' + err.message);
    console.error('[res_hub] App continues running — DB endpoints will return 503');
  }
}

// ─── Start Server (LISTEN FIRST, DB SECOND) ──────────────────────────────────
app.listen(PORT, function () {
  console.log('[res_hub] 🚀 Server listening on port ' + PORT);
  console.log('[res_hub] 🔗 http://localhost:' + PORT);

  // Initialize DB in background AFTER port is open
  initDBInBackground().catch(function (err) {
    console.error('[res_hub] Background DB init error:', err.message);
  });
});