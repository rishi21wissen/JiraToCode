// =========================================
// JiraToCode AI — Backend Server (BMAD SOA)
// =========================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const aiService = require('./services/aiService');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
// Serve frontend static files
app.use(express.static(path.join(__dirname)));

// ---------- Initialize AI on startup ----------
try {
    aiService.initModel(process.env.GEMINI_API_KEY);
} catch (err) {
    console.error('[server] WARNING:', err.message);
    console.error('[server] The server will start, but AI features will fail. Set GEMINI_API_KEY in .env');
}

// ---------- Guidelines API (keep backward compat) ----------
app.get('/api/guidelines', (req, res) => {
    res.json(aiService.loadGuidelines());
});

app.post('/api/guidelines', (req, res) => {
    const newRules = req.body.newRules || [];
    if (newRules.length === 0) {
        return res.json({ success: true, message: 'No new rules to add.', addedCount: 0 });
    }
    const addedCount = aiService.appendRules(newRules);
    res.json({ success: true, addedCount });
});

// ---------- Code Generation API ----------
app.post('/api/generate-code', async (req, res) => {
    try {
        const { summary, description, criteria } = req.body;
        if (!summary || !criteria) {
            return res.status(400).json({ error: 'Summary and Acceptance Criteria are required.' });
        }
        const result = await aiService.generateCode({ summary, description, criteria });
        res.json({ success: true, output: result });
    } catch (err) {
        console.error('[server] /api/generate-code error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ---------- PR Review Analysis API ----------
app.post('/api/analyze-pr', async (req, res) => {
    try {
        const { comments } = req.body;
        if (!comments || comments.trim().length === 0) {
            return res.status(400).json({ error: 'Review comments are required.' });
        }
        const { responseText, addedCount } = await aiService.analyzePR(comments);
        res.json({ success: true, output: responseText, addedCount });
    } catch (err) {
        console.error('[server] /api/analyze-pr error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ---------- Start ----------
app.listen(PORT, () => {
    console.log(`\n  ✨ JiraToCode AI Backend running at http://localhost:${PORT}`);
    console.log(`  📂 Serving static files and APIs...`);
    console.log(`  🧠 AI Service: ${process.env.GEMINI_API_KEY ? 'READY' : 'NOT CONFIGURED (set GEMINI_API_KEY in .env)'}\n`);
});
