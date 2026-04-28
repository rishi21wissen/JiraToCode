// =========================================
// JiraToPR — AI Response Validator
// =========================================
// Validates and sanitizes JSON responses from Gemini to prevent
// malformed data from crashing the application or writing bad files.

/**
 * Validates and sanitizes the response from the CLI code generation AI.
 * 
 * @param {object} response - The raw JSON response parsed from Gemini
 * @returns {{valid: boolean, errors: string[], sanitized: object}}
 */
function validateGenerationResponse(response) {
    const errors = [];
    const sanitized = {
        thoughts: '',
        files: [],
        tests: [],
        tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0 }
    };

    if (!response || typeof response !== 'object') {
        return { valid: false, errors: ['Response is null or not an object'], sanitized };
    }

    // Token usage sanitization
    if (response.tokenUsage && typeof response.tokenUsage === 'object') {
        sanitized.tokenUsage = {
            inputTokens: Number(response.tokenUsage.inputTokens) || 0,
            outputTokens: Number(response.tokenUsage.outputTokens) || 0,
            totalTokens: Number(response.tokenUsage.totalTokens) || 0,
            estimatedCostUsd: Number(response.tokenUsage.estimatedCostUsd) || 0
        };
    }

    // Thoughts sanitization
    if (typeof response.thoughts === 'string') {
        sanitized.thoughts = response.thoughts.trim();
    } else if (typeof response.thought_process === 'string') {
        // Fallback for older schema
        sanitized.thoughts = response.thought_process.trim();
    } else if (typeof response.summary === 'string') {
        // Fallback for new AGENT.md schema
        sanitized.thoughts = response.summary.trim();
    }

    // Files validation
    const filesArray = response.files;
    if (!filesArray) {
        // Not necessarily an error if no files are changed, but usually expected.
    } else if (!Array.isArray(filesArray)) {
        errors.push('"files" must be an array');
    } else {
        filesArray.forEach((file, index) => {
            if (!file || typeof file !== 'object') {
                errors.push(\`File at index \${index} is not an object\`);
                return;
            }

            if (!file.path || typeof file.path !== 'string' || file.path.trim() === '') {
                errors.push(\`File at index \${index} is missing a valid "path"\`);
                return;
            }

            const action = file.action ? file.action.toLowerCase() : 'update'; // Default
            if (!['create', 'update', 'delete'].includes(action)) {
                errors.push(\`File at index \${index} (\${file.path}) has invalid action: \${action}\`);
                return;
            }

            // Handle content or changes
            let finalContent = null;
            let validContent = false;

            if (typeof file.content === 'string') {
                finalContent = file.content;
                validContent = true;
            } else if (Array.isArray(file.changes) && file.changes.length > 0) {
                // If using the changes array, we'll try to extract the content
                // For now, if it has changes, we'll just join them or take the first full one.
                // Since cli.js expects `content`, we map `changes` to `content` if needed.
                const validChanges = file.changes.filter(c => typeof c.content === 'string');
                if (validChanges.length > 0) {
                    finalContent = validChanges.map(c => c.content).join('\\n');
                    validContent = true;
                } else {
                    errors.push(\`File at index \${index} (\${file.path}) has invalid changes array\`);
                }
            }

            if (action !== 'delete' && !validContent) {
                errors.push(\`File at index \${index} (\${file.path}) is missing string "content" or "changes"\`);
                return;
            }

            sanitized.files.push({
                path: file.path.trim(),
                action: action,
                content: action === 'delete' ? '' : finalContent
            });
        });
    }

    // Tests validation (similar to files)
    const testsArray = response.tests;
    if (testsArray) {
        if (!Array.isArray(testsArray)) {
            errors.push('"tests" must be an array');
        } else {
            testsArray.forEach((test, index) => {
                if (!test || typeof test !== 'object') return;
                if (!test.path || typeof test.path !== 'string') return;
                
                let finalContent = typeof test.content === 'string' ? test.content : '';
                if (!finalContent && Array.isArray(test.changes)) {
                    finalContent = test.changes.filter(c => typeof c.content === 'string').map(c => c.content).join('\\n');
                }

                sanitized.tests.push({
                    path: test.path.trim(),
                    action: test.action || 'update',
                    content: finalContent
                });
            });
        }
    }

    return {
        valid: errors.length === 0,
        errors,
        sanitized
    };
}

/**
 * Validates the response from the GitHub PR Review AI.
 */
function validateReviewResponse(response) {
    const errors = [];
    const sanitized = {
        replyMessage: '',
        suggestedCodeFix: null,
        newRules: [],
        tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0 }
    };

    if (!response || typeof response !== 'object') {
        return { valid: false, errors: ['Response is null or not an object'], sanitized };
    }

    if (response.tokenUsage && typeof response.tokenUsage === 'object') {
        sanitized.tokenUsage = {
            inputTokens: Number(response.tokenUsage.inputTokens) || 0,
            outputTokens: Number(response.tokenUsage.outputTokens) || 0,
            totalTokens: Number(response.tokenUsage.totalTokens) || 0,
            estimatedCostUsd: Number(response.tokenUsage.estimatedCostUsd) || 0
        };
    }

    if (typeof response.replyMessage === 'string') {
        sanitized.replyMessage = response.replyMessage.trim();
    } else {
        errors.push('"replyMessage" is missing or not a string');
    }

    if (typeof response.suggestedCodeFix === 'string') {
        sanitized.suggestedCodeFix = response.suggestedCodeFix.trim();
    }

    if (response.newRules) {
        if (!Array.isArray(response.newRules)) {
            errors.push('"newRules" must be an array');
        } else {
            response.newRules.forEach((rule, index) => {
                if (!rule || typeof rule !== 'object') {
                    errors.push(\`Rule at index \${index} is not an object\`);
                    return;
                }
                if (!rule.id || typeof rule.id !== 'string') {
                    errors.push(\`Rule at index \${index} is missing string "id"\`);
                    return;
                }
                if (!rule.description || typeof rule.description !== 'string') {
                    errors.push(\`Rule at index \${index} is missing string "description"\`);
                    return;
                }
                
                sanitized.newRules.push({
                    id: rule.id.trim(),
                    type: typeof rule.type === 'string' ? rule.type.trim() : 'project-specific',
                    description: rule.description.trim(),
                    category: typeof rule.category === 'string' ? rule.category.trim() : 'general',
                    severity: typeof rule.severity === 'string' ? rule.severity.trim() : 'medium'
                });
            });
        }
    }

    return {
        valid: errors.length === 0,
        errors,
        sanitized
    };
}

module.exports = { validateGenerationResponse, validateReviewResponse };
