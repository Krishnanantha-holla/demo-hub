const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');

const app = express();

// ── Middleware (CORS must come first, before routes) ───────────────
app.use(cors());
app.use(express.json());

// Serve static files from the project root (where index.html lives)
app.use(express.static(path.join(__dirname)));

// ── Postgres Pool ──────────────────────────────────────────────────
const pool = new Pool({
    user: 'userr',
    password: 'user123',
    host: 'localhost',
    port: 5432,
    database: 'proto'
});

// Catch idle/background Postgres errors (wrong password, server stopped, etc.)
pool.on('error', (err) => {
    console.error('[res_hub] Unexpected Postgres pool error:', err.message);
    console.error('           Code:', err.code, '| Detail:', err.detail || 'n/a');
});

// Confirm Postgres is reachable on startup
pool.query('SELECT 1')
    .then(() => console.log('[res_hub] Postgres connection OK'))
    .catch(err => {
        console.error('[res_hub] Postgres connection FAILED:', err.message);
        console.error('  → Check: user, password, host, port, database in Pool config');
    });

// ── Home route: serve the frontend ────────────────────────────────
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ── API Routes ─────────────────────────────────────────────────────

// Departments
app.get('/api/departments', async (req, res) => {
    console.log('[res_hub] GET /api/departments hit');
    try {
        const result = await pool.query('SELECT id, name FROM departments ORDER BY name');
        console.log(`[res_hub]   → ${result.rows.length} department(s) returned`);
        res.json(result.rows);
    } catch (err) {
        console.error('[res_hub] /api/departments error:', err.message);
        res.status(500).json({ error: 'Failed to fetch departments', detail: err.message });
    }
});

// Semesters
app.get('/api/semesters', async (req, res) => {
    console.log('[res_hub] GET /api/semesters hit');
    try {
        const result = await pool.query('SELECT id, semester_number FROM semesters ORDER BY semester_number');
        console.log(`[res_hub]   → ${result.rows.length} semester(s) returned`);
        res.json(result.rows);
    } catch (err) {
        console.error('[res_hub] /api/semesters error:', err.message);
        res.status(500).json({ error: 'Failed to fetch semesters', detail: err.message });
    }
});

// Subjects (filtered by dept + semester)
app.get('/api/subjects/:deptId/:semId', async (req, res) => {
    console.log(`[res_hub] GET /api/subjects/${req.params.deptId}/${req.params.semId}`);
    try {
        const result = await pool.query(
            'SELECT id, subject_name FROM subjects WHERE department_id = $1 AND semester_id = $2',
            [req.params.deptId, req.params.semId]
        );
        console.log(`[res_hub]   → ${result.rows.length} subject(s) returned`);
        res.json(result.rows);
    } catch (err) {
        console.error('[res_hub] /api/subjects error:', err.message);
        res.status(500).json({ error: 'Failed to fetch subjects', detail: err.message });
    }
});

// Modules (filtered by subject)
app.get('/api/modules/:subjectId', async (req, res) => {
    console.log(`[res_hub] GET /api/modules/${req.params.subjectId}`);
    try {
        const result = await pool.query(
            'SELECT id, module_number, module_title FROM modules WHERE subject_id = $1 ORDER BY module_number',
            [req.params.subjectId]
        );
        console.log(`[res_hub]   → ${result.rows.length} module(s) returned`);
        res.json(result.rows);
    } catch (err) {
        console.error('[res_hub] /api/modules error:', err.message);
        res.status(500).json({ error: 'Failed to fetch modules', detail: err.message });
    }
});

// Topics (filtered by module)
app.get('/api/topics/:moduleId', async (req, res) => {
    console.log(`[res_hub] GET /api/topics/${req.params.moduleId}`);
    try {
        const result = await pool.query(
            'SELECT id, topic_name FROM topics WHERE module_id = $1 ORDER BY id',
            [req.params.moduleId]
        );
        console.log(`[res_hub]   → ${result.rows.length} topic(s) returned`);
        res.json(result.rows);
    } catch (err) {
        console.error('[res_hub] /api/topics error:', err.message);
        res.status(500).json({ error: 'Failed to fetch topics', detail: err.message });
    }
});

// Trigger n8n workflow
app.post('/api/search', async (req, res) => {
    const { topicId, topicName } = req.body;
    console.log(`[res_hub] POST /api/search → Topic: "${topicName}" (id: ${topicId})`);

    // TODO: fetch(process.env.N8N_WEBHOOK_URL, { method: 'POST', body: JSON.stringify({ topicId, topicName }) })

    res.json({ success: true, message: `n8n search started for ${topicName}` });
});

// ── Start ──────────────────────────────────────────────────────────
app.listen(3000, () => {
    console.log('');
    console.log('  ┌─────────────────────────────────────────────┐');
    console.log('  │  res_hub server online                      │');
    console.log('  │  http://localhost:3000                      │');
    console.log('  │  Open this URL in your browser ↑           │');
    console.log('  └─────────────────────────────────────────────┘');
    console.log('');
});
