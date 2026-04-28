// =========================================
// JiraToPR — Gemini Pricing Configuration
// =========================================
// Prices are per 1 million tokens (USD).
// Update these when Google changes pricing.
// Source: https://ai.google.dev/pricing

module.exports = {
    // gemini-2.5-flash
    'gemini-2.5-flash': {
        inputPer1M:  0.35,
        outputPer1M: 1.05
    },
    // gemini-2.0-flash
    'gemini-2.0-flash': {
        inputPer1M:  0.10,
        outputPer1M: 0.40
    },
    // gemini-1.5-flash (legacy fallback)
    'gemini-1.5-flash': {
        inputPer1M:  0.075,
        outputPer1M: 0.30
    },
    // default — applied when model name is not recognized
    default: {
        inputPer1M:  0.35,
        outputPer1M: 1.05
    }
};
