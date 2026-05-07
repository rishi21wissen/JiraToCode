// =========================================
// JiraToPR AI — Multi-Agent Orchestrator
// =========================================
// Coordinates the Manager + Specialist Persona pipeline.
//
// Flow:
//   1. Manager Persona reads the ticket → produces a delegation plan
//   2. Specialist Personas run IN PARALLEL for each activated domain
//   3. Results are merged into a single unified file list
//   4. cli.js writes the files to disk and hands off to gitAgent

const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs   = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { extractTokenUsage } = require('../utils/tokenTracker');

// ---------- Load Persona Contracts ----------
const PERSONAS_DIR = path.join(__dirname, '..', 'config', 'agent', 'personas');

const MANAGER_PROMPT      = fs.readFileSync(path.join(PERSONAS_DIR, 'MANAGER.md'),      'utf8');
const JAVA_DEV_PROMPT     = fs.readFileSync(path.join(PERSONAS_DIR, 'JAVA_DEV.md'),     'utf8');
const DBA_PROMPT          = fs.readFileSync(path.join(PERSONAS_DIR, 'DBA.md'),          'utf8');
const FRONTEND_DEV_PROMPT = fs.readFileSync(path.join(PERSONAS_DIR, 'FRONTEND_DEV.md'), 'utf8');

const PERSONA_PROMPTS = {
    JAVA_DEV:     JAVA_DEV_PROMPT,
    DBA:          DBA_PROMPT,
    FRONTEND_DEV: FRONTEND_DEV_PROMPT
};

// ---------- Gemini Client ----------
let aiModel = null;
let currentModelName = null;

function initModel(apiKey) {
    if (!apiKey) throw new Error('GEMINI_API_KEY is not set.');
    const genAI = new GoogleGenerativeAI(apiKey);
    currentModelName = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
    aiModel = genAI.getGenerativeModel({ model: currentModelName });
    console.log(`[orchestrator] Gemini model: ${currentModelName}`);
}

// ---------- Helpers ----------
const GUIDELINES_PATH = path.join(__dirname, '..', 'guidelines.yaml');

function loadGuidelines() {
    try {
        return yaml.load(fs.readFileSync(GUIDELINES_PATH, 'utf8')) || {};
    } catch {
        return {};
    }
}

/**
 * Robustly extracts the first valid JSON object from a potentially
 * noisy LLM response (thinking tokens, markdown fences, etc.)
 */
function extractJSON(raw) {
    const start = raw.indexOf('{');
    const end   = raw.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error(`No JSON object found in response:\n${raw}`);
    return JSON.parse(raw.slice(start, end + 1));
}

// ---------- Step 1: Manager Persona ----------
/**
 * Calls the Manager Persona to analyse the ticket and produce a delegation plan.
 *
 * @param {string} ticketText       - Raw Jira ticket content.
 * @param {string} workspaceIndex   - File tree string from cli.js.
 * @returns {Promise<object>}       - Parsed Manager delegation plan.
 */
async function runManager(ticketText, workspaceIndex) {
    console.log(`\n📋 [Manager] Analysing ticket and creating delegation plan...`);

    const userMessage =
        `## Jira Ticket\n${ticketText}\n\n` +
        `## Workspace File Index\n\`\`\`\n${workspaceIndex || '(empty)'}\n\`\`\``;

    const result = await aiModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: userMessage }] }],
        systemInstruction: { parts: [{ text: MANAGER_PROMPT }] },
        generationConfig: {
            temperature: 0.0,
            responseMimeType: 'application/json',
            maxOutputTokens: 1024
        }
    });

    const plan = extractJSON(result.response.text());
    const tokenUsage = extractTokenUsage(result, currentModelName);

    console.log(`   ✅ Activated personas : ${plan.activated_personas.join(', ')}`);
    console.log(`   📌 Ticket summary     : ${plan.ticket_summary}`);
    if (plan.warnings && plan.warnings.length > 0) {
        plan.warnings.forEach(w => console.log(`   ⚠️  Warning: ${w}`));
    }

    return { plan, tokenUsage };
}

// ---------- Step 2: Specialist Personas (parallel) ----------
/**
 * Runs a single specialist persona for its assigned sub-task.
 *
 * @param {string} personaKey   - e.g. "JAVA_DEV", "DBA", "FRONTEND_DEV"
 * @param {object} task         - The task object from the Manager plan.
 * @param {object} contract     - The shared_contract from the Manager plan.
 * @param {object} guidelines   - Loaded guidelines.yaml content.
 * @returns {Promise<object>}   - { files, warnings, tokenUsage }
 */
async function runSpecialist(personaKey, task, contract, guidelines) {
    const systemPrompt = PERSONA_PROMPTS[personaKey];
    if (!systemPrompt) throw new Error(`Unknown persona: ${personaKey}`);

    console.log(`   🔧 [${personaKey}] Starting: ${task.objective}`);

    const hasRules = Object.keys(guidelines.universal_guidelines || {}).length > 0 ||
                     Object.keys(guidelines.project_guidelines   || {}).length > 0;

    const userMessage =
        `## Your Sub-Task\n${task.objective}\n\n` +
        `## Shared Contract (Use these names exactly)\n\`\`\`json\n${JSON.stringify(contract, null, 2)}\n\`\`\`\n\n` +
        `## Files You Must Create\n${task.files_to_create.map(f => `- ${f}`).join('\n')}\n\n` +
        (task.dependencies && task.dependencies.length > 0
            ? `## Dependencies (assume these exist)\n${task.dependencies.map(d => `- ${d}`).join('\n')}\n\n`
            : '') +
        (hasRules
            ? `## Team Guidelines (follow strictly)\n\`\`\`json\n${JSON.stringify(guidelines, null, 2)}\n\`\`\``
            : '');

    const result = await aiModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: userMessage }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
            temperature: 0.1,
            responseMimeType: 'application/json',
            maxOutputTokens: 8192
        }
    });

    const parsed   = extractJSON(result.response.text());
    const tokenUsage = extractTokenUsage(result, currentModelName);

    console.log(`   ✅ [${personaKey}] Generated ${parsed.files?.length || 0} file(s).`);
    if (parsed.warnings && parsed.warnings.length > 0) {
        parsed.warnings.forEach(w => console.log(`      ⚠️  [${personaKey}] ${w}`));
    }

    return {
        files:      parsed.files     || [],
        warnings:   parsed.warnings  || [],
        tokenUsage
    };
}

// ---------- Step 3: Token Usage Aggregator ----------
function aggregateTokenUsage(usages) {
    return usages.reduce((acc, u) => {
        if (!u) return acc;
        acc.inputTokens  += u.inputTokens  || 0;
        acc.outputTokens += u.outputTokens || 0;
        acc.totalTokens  += u.totalTokens  || 0;
        acc.estimatedCost = (acc.estimatedCost || 0) + (u.estimatedCost || 0);
        return acc;
    }, { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCost: 0 });
}

// ---------- Main Orchestration Entry Point ----------
/**
 * Runs the full multi-agent pipeline for a single Jira ticket.
 *
 * @param {string} ticketText      - Raw Jira ticket content.
 * @param {string} workspaceIndex  - File tree string from cli.js.
 * @returns {Promise<object>}      - { files, thoughts, tokenUsage, warnings }
 */
async function run(ticketText, workspaceIndex = '') {
    if (!aiModel) throw new Error('Orchestrator not initialized. Call initModel() first.');

    const guidelines = loadGuidelines();
    const allTokenUsages = [];
    const allWarnings    = [];

    // ── Phase 1: Manager analyses the ticket ──
    const { plan, tokenUsage: managerUsage } = await runManager(ticketText, workspaceIndex);
    allTokenUsages.push(managerUsage);

    const { activated_personas, shared_contract, tasks } = plan;

    if (!activated_personas || activated_personas.length === 0) {
        throw new Error('Manager returned no activated personas. Cannot proceed.');
    }

    // ── Phase 2: Specialist personas run IN PARALLEL ──
    console.log(`\n🚀 [Orchestrator] Dispatching ${activated_personas.length} specialist persona(s) in parallel...`);

    const specialistResults = await Promise.all(
        activated_personas.map(personaKey => {
            const task = tasks[personaKey];
            if (!task) {
                console.warn(`   ⚠️  No task defined for persona "${personaKey}". Skipping.`);
                return Promise.resolve({ files: [], warnings: [`No task defined for ${personaKey}`], tokenUsage: null });
            }
            return runSpecialist(personaKey, task, shared_contract, guidelines);
        })
    );

    // ── Phase 3: Merge all specialist outputs ──
    const allFiles = [];
    for (let i = 0; i < activated_personas.length; i++) {
        const persona = activated_personas[i];
        const result  = specialistResults[i];
        allTokenUsages.push(result.tokenUsage);
        allWarnings.push(...result.warnings);

        for (const file of result.files) {
            // Deduplicate by path — last writer wins
            const existing = allFiles.findIndex(f => f.path === file.path);
            if (existing !== -1) {
                console.warn(`   ⚠️  [Merger] File conflict on "${file.path}". ${persona} overwrites previous.`);
                allFiles[existing] = file;
            } else {
                allFiles.push(file);
            }
        }
    }

    const aggregated = aggregateTokenUsage(allTokenUsages);

    const thoughts =
        `Manager activated: [${activated_personas.join(', ')}]. ` +
        `Shared contract: entity="${shared_contract?.entity_name || 'N/A'}", ` +
        `api="${shared_contract?.api_path || 'N/A'}", ` +
        `table="${shared_contract?.db_table || 'N/A'}". ` +
        `Total files generated: ${allFiles.length}.`;

    console.log(`\n✅ [Orchestrator] Merge complete. Total files: ${allFiles.length}`);

    return {
        files:      allFiles,
        tests:      [],             // Tests are embedded in files[] per persona output
        thoughts,
        warnings:   allWarnings,
        tokenUsage: aggregated
    };
}

module.exports = { initModel, run };
