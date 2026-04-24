// =========================================
// JiraToCode AI — Centralized AI Service
// =========================================

const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { SYSTEM_PROMPT, PR_REVIEW_PROMPT } = require('../config/prompts');

const GUIDELINES_PATH = path.join(__dirname, '..', 'guidelines.yaml');

// ---------- Guidelines Helper ----------
function loadGuidelines() {
    try {
        const raw = fs.readFileSync(GUIDELINES_PATH, 'utf8');
        return yaml.load(raw) || {};
    } catch (e) {
        console.warn('[aiService] Could not load guidelines.yaml, using empty context.');
        return {};
    }
}

function saveGuidelines(updatedData) {
    const yamlStr = yaml.dump(updatedData, { noRefs: true });
    fs.writeFileSync(GUIDELINES_PATH, yamlStr, 'utf8');
}

function appendRules(rulesArray) {
    const data = loadGuidelines();
    let addedCount = 0;

    rulesArray.forEach(rule => {
        const section = rule.type === 'universal' ? 'universal_guidelines' : 'project_guidelines';
        const category = rule.category || 'general';
        if (!data[section]) data[section] = {};
        if (!data[section][category]) data[section][category] = [];

        // Deduplicate by ID
        const exists = data[section][category].some(r => r.id === rule.id);
        if (!exists) {
            data[section][category].push({
                id: rule.id,
                description: rule.description,
                severity: rule.severity || 'medium'
            });
            addedCount++;
        }
    });

    if (addedCount > 0) {
        saveGuidelines(data);
    }
    return addedCount;
}

// ---------- Gemini Client ----------
let aiModel = null;

function initModel(apiKey) {
    if (!apiKey) throw new Error('GEMINI_API_KEY is not set in environment.');
    const genAI = new GoogleGenerativeAI(apiKey);
    aiModel = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    console.log('[aiService] Gemini model initialized.');
}

// ---------- Code Generation ----------
async function generateCode({ summary, description, criteria }) {
    if (!aiModel) throw new Error('AI model not initialized. Check your GEMINI_API_KEY.');

    const guidelines = loadGuidelines();

    let userMessage = `## Jira Ticket\n\n**Summary:** ${summary}\n\n`;
    if (description) userMessage += `**Description:** ${description}\n\n`;
    userMessage += `**Acceptance Criteria:**\n${criteria}\n`;

    // Inject team memory
    const hasRules = Object.keys(guidelines.universal_guidelines || {}).length > 0 ||
                     Object.keys(guidelines.project_guidelines || {}).length > 0;
    if (hasRules) {
        userMessage += `\n## Team Memory (guidelines.yaml)\n\`\`\`json\n${JSON.stringify(guidelines, null, 2)}\n\`\`\``;
    }

    const result = await aiModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: userMessage }] }],
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        generationConfig: { temperature: 0.2 }
    });

    return result.response.text();
}

// ---------- PR Review Analysis ----------
async function analyzePR(comments) {
    if (!aiModel) throw new Error('AI model not initialized. Check your GEMINI_API_KEY.');

    const guidelines = loadGuidelines();

    let userMessage = `## Review Comments\n\n${comments}\n`;
    const hasRules = Object.keys(guidelines.universal_guidelines || {}).length > 0 ||
                     Object.keys(guidelines.project_guidelines || {}).length > 0;
    if (hasRules) {
        userMessage += `\n## Current Guidelines Context\n\`\`\`json\n${JSON.stringify(guidelines, null, 2)}\n\`\`\``;
    }

    const result = await aiModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: userMessage }] }],
        systemInstruction: { parts: [{ text: PR_REVIEW_PROMPT }] },
        generationConfig: { temperature: 0.3 }
    });

    const responseText = result.response.text();

    // Extract and save new rules if present
    const jsonMatch = responseText.match(/```json\s+rules\s+([\s\S]*?)```/);
    let addedCount = 0;
    if (jsonMatch) {
        try {
            const newRules = JSON.parse(jsonMatch[1]);
            if (Array.isArray(newRules) && newRules.length > 0) {
                addedCount = appendRules(newRules);
            }
        } catch (e) {
            console.error('[aiService] Failed to parse AI rule JSON block:', e.message);
        }
    }

    return { responseText, addedCount };
}

module.exports = {
    initModel,
    generateCode,
    analyzePR,
    loadGuidelines,
    appendRules
};
