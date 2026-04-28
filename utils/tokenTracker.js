// =========================================
// JiraToPR — Token Usage Tracker Utility
// =========================================
// Extracts Gemini response token metadata, calculates totals,
// and estimates USD cost using config/pricing.js.
// Isolated from generation logic — safe to import anywhere.

const PRICING = require('../config/pricing');

/**
 * Extracts token usage from a Gemini API result object and estimates cost.
 *
 * @param {object} geminiResult  - Raw result from model.generateContent()
 * @param {string} modelName     - Model name (e.g. 'gemini-2.5-flash')
 * @returns {{inputTokens: number, outputTokens: number, totalTokens: number, estimatedCostUsd: number}}
 */
function extractTokenUsage(geminiResult, modelName = 'default') {
    // Safely navigate metadata — Gemini may omit fields on some responses
    const meta = geminiResult?.response?.usageMetadata || {};

    const inputTokens  = Number(meta.promptTokenCount     ?? 0);
    const outputTokens = Number(meta.candidatesTokenCount  ?? 0);
    const totalTokens  = Number(meta.totalTokenCount       ?? (inputTokens + outputTokens));

    const pricing = PRICING[modelName] || PRICING['default'];

    const inputCost  = (inputTokens  / 1_000_000) * pricing.inputPer1M;
    const outputCost = (outputTokens / 1_000_000) * pricing.outputPer1M;
    const estimatedCostUsd = parseFloat((inputCost + outputCost).toFixed(8));

    return { inputTokens, outputTokens, totalTokens, estimatedCostUsd };
}

/**
 * Formats a token usage object into a compact CLI-friendly string block.
 *
 * @param {{inputTokens, outputTokens, totalTokens, estimatedCostUsd}} usage
 * @returns {string}
 */
function formatTokenUsage(usage) {
    const cost = `$${usage.estimatedCostUsd.toFixed(5)}`;
    return [
        '--------------------------------',
        '📊 Token Usage',
        `   Input Tokens : ${usage.inputTokens}`,
        `   Output Tokens: ${usage.outputTokens}`,
        `   Total Tokens : ${usage.totalTokens}`,
        `   Est. Cost    : ${cost}`,
        '--------------------------------'
    ].join('\n');
}

/**
 * Formats a token usage object as a compact single-line log entry.
 * Intended for github-agent.js and other server-side contexts.
 *
 * @param {{inputTokens, outputTokens, totalTokens, estimatedCostUsd}} usage
 * @returns {string}
 */
function formatTokenLog(usage) {
    return `[Token Usage] Input=${usage.inputTokens} Output=${usage.outputTokens} Total=${usage.totalTokens} Cost=$${usage.estimatedCostUsd.toFixed(5)}`;
}

module.exports = { extractTokenUsage, formatTokenUsage, formatTokenLog };
