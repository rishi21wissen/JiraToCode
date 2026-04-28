// =========================================
// JiraToPR — Token Tracker Unit Tests
// =========================================

const { extractTokenUsage, formatTokenUsage, formatTokenLog } = require('../utils/tokenTracker');

describe('TokenTracker', () => {

    // 1: Correct extraction from a full usageMetadata response
    test('extractTokenUsage returns correct values from complete Gemini metadata', () => {
        const mockResult = {
            response: {
                usageMetadata: {
                    promptTokenCount: 1420,
                    candidatesTokenCount: 890,
                    totalTokenCount: 2310
                }
            }
        };

        const usage = extractTokenUsage(mockResult, 'gemini-2.5-flash');

        expect(usage.inputTokens).toBe(1420);
        expect(usage.outputTokens).toBe(890);
        expect(usage.totalTokens).toBe(2310);
        // (1420 / 1_000_000) * 0.35 + (890 / 1_000_000) * 1.05 = 0.000497 + 0.0009345 = 0.0014315
        expect(usage.estimatedCostUsd).toBeGreaterThan(0);
        expect(typeof usage.estimatedCostUsd).toBe('number');
    });

    // 2: Safe defaults when usageMetadata is absent (Gemini sometimes omits it)
    test('extractTokenUsage defaults to 0 when usageMetadata is missing', () => {
        const mockResult = { response: {} };
        const usage = extractTokenUsage(mockResult, 'gemini-2.5-flash');

        expect(usage.inputTokens).toBe(0);
        expect(usage.outputTokens).toBe(0);
        expect(usage.totalTokens).toBe(0);
        expect(usage.estimatedCostUsd).toBe(0);
    });

    // 3: Falls back to 'default' pricing for unknown model names
    test('extractTokenUsage uses default pricing for unrecognized model', () => {
        const mockResult = {
            response: {
                usageMetadata: {
                    promptTokenCount: 1000000,
                    candidatesTokenCount: 1000000,
                    totalTokenCount: 2000000
                }
            }
        };

        const usage = extractTokenUsage(mockResult, 'gemini-unknown-model-xyz');

        // default pricing: 0.35 input + 1.05 output = $1.40 per 1M each
        expect(usage.estimatedCostUsd).toBeCloseTo(1.40, 2);
    });

    // 4: formatTokenUsage returns a block containing all expected labels
    test('formatTokenUsage includes all required output labels', () => {
        const usage = { inputTokens: 1420, outputTokens: 890, totalTokens: 2310, estimatedCostUsd: 0.00143 };
        const output = formatTokenUsage(usage);

        expect(output).toContain('📊 Token Usage');
        expect(output).toContain('Input Tokens');
        expect(output).toContain('Output Tokens');
        expect(output).toContain('Total Tokens');
        expect(output).toContain('Est. Cost');
        expect(output).toContain('1420');
        expect(output).toContain('890');
        expect(output).toContain('2310');
    });

    // 5: formatTokenLog returns a compact single-line string
    test('formatTokenLog returns a single-line log-style string', () => {
        const usage = { inputTokens: 1420, outputTokens: 890, totalTokens: 2310, estimatedCostUsd: 0.00143 };
        const log = formatTokenLog(usage);

        expect(log).toContain('[Token Usage]');
        expect(log).toContain('Input=1420');
        expect(log).toContain('Output=890');
        expect(log).toContain('Total=2310');
        expect(log).toMatch(/Cost=\$[\d.]+/);
        expect(log.split('\n').length).toBe(1); // must be single line
    });

    // 6: totalTokens is computed correctly when omitted from response
    test('extractTokenUsage computes totalTokens from input + output when totalTokenCount is missing', () => {
        const mockResult = {
            response: {
                usageMetadata: {
                    promptTokenCount: 500,
                    candidatesTokenCount: 300
                    // totalTokenCount intentionally omitted
                }
            }
        };

        const usage = extractTokenUsage(mockResult, 'gemini-2.0-flash');
        expect(usage.totalTokens).toBe(800);
    });
});
