// JiraToPR AI — Centralized AI Service
// =========================================

const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { SYSTEM_PROMPT, PR_REVIEW_PROMPT, CLI_GENERATOR_PROMPT, CONTEXT_SELECTOR_PROMPT } = require('../config/prompts');

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
let currentModelName = null;

function initModel(apiKey) {
    if (!apiKey) throw new Error('GEMINI_API_KEY is not set in environment.');
    const genAI = new GoogleGenerativeAI(apiKey);
    currentModelName = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
    aiModel = genAI.getGenerativeModel({ model: currentModelName });
    console.log(`[aiService] Gemini model initialized using ${currentModelName}`);
}

// ---------- Context Selection (pre-generation pruning) ----------
/**
 * Calls Gemini with the Context Selector prompt to pick the minimum
 * files and rule packs needed before code generation.
 *
 * @param {string} ticketText - Raw Jira ticket content.
 * @param {string} fileIndex  - Newline-separated list of repo file paths.
 * @returns {Promise<object>} Parsed JSON matching the CONTEXT_SELECTOR schema.
 */
async function selectContext(ticketText, fileIndex = '') {
    if (!aiModel) throw new Error('AI model not initialized. Check your GEMINI_API_KEY.');

    const guidelines = loadGuidelines();
    const ruleCategories = [
        ...Object.keys(guidelines.universal_guidelines || {}),
        ...Object.keys(guidelines.project_guidelines || {})
    ].join(', ');

    const userMessage =
        `## Jira Ticket\n${ticketText}\n\n` +
        `## Repository File Index\n\`\`\`\n${fileIndex}\n\`\`\`\n\n` +
        `## Available Rule Categories\n${ruleCategories}`;

    const result = await aiModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: userMessage }] }],
        systemInstruction: { parts: [{ text: CONTEXT_SELECTOR_PROMPT }] },
        generationConfig: {
            temperature: 0.0,
            responseMimeType: 'application/json',
            maxOutputTokens: 1024
        }
    });

    const raw = result.response.text();
    const start = raw.indexOf('{');
    const end   = raw.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('Context Selector returned no valid JSON.\nRAW: ' + raw);
    return JSON.parse(raw.slice(start, end + 1));
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

// ---------- Local CLI Code Generation ----------
async function generateLocalCode(ticketText, codebaseContext = "") {
    if (!aiModel) throw new Error('AI model not initialized. Check your GEMINI_API_KEY.');

    const guidelines = loadGuidelines();
    let userMessage = `## Jira Ticket Request\n\n${ticketText}\n`;

    if (codebaseContext) {
        userMessage += `\n## Codebase Context (Existing Files)\n\`\`\`\n${codebaseContext}\n\`\`\`\n`;
    }

    const hasRules = Object.keys(guidelines.universal_guidelines || {}).length > 0 ||
                     Object.keys(guidelines.project_guidelines || {}).length > 0;
    if (hasRules) {
        userMessage += `\n## Current Team Memory (guidelines.yaml)\nEnsure you follow these rules strictly:\n\`\`\`json\n${JSON.stringify(guidelines, null, 2)}\n\`\`\``;
    }

    const result = await aiModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: userMessage }] }],
        systemInstruction: { parts: [{ text: CLI_GENERATOR_PROMPT }] },
        generationConfig: { 
            temperature: 0.1,
            responseMimeType: "application/json",
            maxOutputTokens: 8192
        }
    });

    let responseText = result.response.text();

    // gemini-2.5-flash thinking mode leaks reasoning tokens BEFORE the JSON.
    // Slice from the first '{' to the last '}' to isolate the JSON payload.
    const start = responseText.indexOf('{');
    const end = responseText.lastIndexOf('}');

    if (start === -1 || end === -1 || end < start) {
        throw new Error("AI returned no valid JSON object.\nRAW OUTPUT:\n" + responseText);
    }

    const jsonStr = responseText.slice(start, end + 1);

    try {
        return JSON.parse(jsonStr);
    } catch (err) {
        throw new Error("AI JSON Parsing Failed: " + err.message + "\nRAW OUTPUT:\n" + jsonStr);
    }
}

module.exports = {
    initModel,
    generateCode,
    generateLocalCode,
    analyzePR,
    selectContext,
    loadGuidelines,
    appendRules
};
