const aiService = require('../services/aiService');
const fs = require('fs');
const path = require('path');

// Mock the Gemini API module to test logic predictably without tokens
const mockGenerateContent = jest.fn();
jest.mock('@google/generative-ai', () => {
    return {
        GoogleGenerativeAI: jest.fn().mockImplementation(() => {
            return {
                getGenerativeModel: jest.fn().mockReturnValue({
                    generateContent: mockGenerateContent
                })
            };
        })
    };
});

describe('JiraToPR AI Architecture Tests', () => {
    const backupPath = path.join(__dirname, '..', 'guidelines.yaml.backup');
    const guidelinesPath = path.join(__dirname, '..', 'guidelines.yaml');

    beforeAll(() => {
        // Backup guidelines.yaml and provide a fresh one to test against
        if (fs.existsSync(guidelinesPath)) {
            fs.copyFileSync(guidelinesPath, backupPath);
        }
        fs.writeFileSync(guidelinesPath, "universal_guidelines:\n  general:\n    - id: test-rule\n      description: original rule\n      severity: medium\n");
    });

    afterAll(() => {
        // Restore actual guidelines
        if (fs.existsSync(backupPath)) {
            fs.copyFileSync(backupPath, guidelinesPath);
            fs.unlinkSync(backupPath);
        } else {
            fs.unlinkSync(guidelinesPath);
        }
    });

    // 1: Ensure JSON slicing works on "Thinking" models like gemini-2.5-flash
    test('generateLocalCode correctly parses clean json out of thinking-preamble chaos', async () => {
        // 1a. Mock the response explicitly passing dirty thinking text wrapping JSON
        aiService.initModel('dummy-key');
        mockGenerateContent.mockResolvedValue({
            response: {
                text: () => `thought_process
I am analyzing the requirement. The user wants to create a dummy class.
{
  "thought_process": "Writing a class",
  "files": [{"path": "dummy.java", "content": "public class Dummy {}"}]
}
Some hallucinated suffix code \`\`\``
            }
        });

        // 1b. Call function
        const result = await aiService.generateLocalCode("Some ticket");

        // 1c. Ensure it sliced out exactly the structured JSON Object
        expect(result).toHaveProperty('thought_process', 'Writing a class');
        expect(result.files).toHaveLength(1);
        expect(result.files[0].path).toBe('dummy.java');
    });

    // 2: Ensure GitHub auto-learning rules are deduplicated properly
    test('appendRules deduplicates incoming PR rules to maintain clean guidelines', async () => {
        const dummyNewRules = [
            { id: 'test-rule', type: 'universal', description: 'repeated rule', category: 'general', severity: 'low' }, // Exists in setup
            { id: 'new-security-rule', type: 'project-specific', description: 'hash passwords', category: 'security', severity: 'high' }
        ];

        const addedCount = aiService.appendRules(dummyNewRules);

        // Deduplication assert: should only add the new-security-rule
        expect(addedCount).toBe(1);

        const loadedGuidelines = aiService.loadGuidelines();
        expect(loadedGuidelines.project_guidelines.security).toHaveLength(1);
        expect(loadedGuidelines.project_guidelines.security[0].id).toBe('new-security-rule');
    });

    // 3: Codebase Context injection verification
    test('generateLocalCode injects Codebase Context properly to prevent hallucinations', async () => {
        aiService.initModel('dummy-key');
        mockGenerateContent.mockResolvedValue({
            response: { text: () => `{ "thought_process": "success", "files": [] }` }
        });

        const ctxTree = "📁 BankingDemo\\n📄 README.md";
        await aiService.generateLocalCode("Do work", ctxTree);

        // Verify the prompt array has the provided context tree attached
        const callArgs = mockGenerateContent.mock.calls[1][0].contents[0].parts[0].text;
        expect(callArgs).toContain("Codebase Context (Existing Files)");
        expect(callArgs).toContain("📁 BankingDemo");
        expect(callArgs).toContain("📄 README.md");
    });

    // 4: Context Selector — schema validation
    test('selectContext returns correctly shaped JSON with ticket_summary and selected_files', async () => {
        aiService.initModel('dummy-key');
        mockGenerateContent.mockResolvedValue({
            response: {
                text: () => JSON.stringify({
                    ticket_summary: "Add interest calculation to LoanService",
                    selected_rule_packs: ["architecture", "style"],
                    selected_files: [
                        { path: "BankingDemo/src/main/java/com/banking/LoanService.java", why: "Target class", content_type: "snippet" }
                    ],
                    missing_info: []
                })
            }
        });

        const result = await aiService.selectContext("BANKING-105: Add interest calculation", "LoanService.java\nAccountRepository.java");

        expect(result).toHaveProperty('ticket_summary');
        expect(result).toHaveProperty('selected_rule_packs');
        expect(result).toHaveProperty('selected_files');
        expect(Array.isArray(result.selected_files)).toBe(true);
        expect(result.selected_files[0]).toHaveProperty('content_type');
    });

    // 5: Context Selector — degenerate response (no JSON) should throw
    test('selectContext throws a clear error when AI returns no valid JSON', async () => {
        aiService.initModel('dummy-key');
        mockGenerateContent.mockResolvedValue({
            response: { text: () => "I cannot determine the context from the provided information." }
        });

        await expect(aiService.selectContext("vague ticket", "")).rejects.toThrow('Context Selector returned no valid JSON.');
    });
});
