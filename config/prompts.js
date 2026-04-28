const fs = require('fs');
const path = require('path');

// 📂 Load Agent Behavioral and Capability Contracts
const AGENT_BEHAVIOR = fs.readFileSync(path.join(__dirname, 'agent', 'AGENT.md'), 'utf8');
const AGENT_SKILLS = fs.readFileSync(path.join(__dirname, 'agent', 'SKILL.md'), 'utf8');
const CONTEXT_SELECTOR_CONTRACT = fs.readFileSync(path.join(__dirname, 'agent', 'CONTEXT_SELECTOR.md'), 'utf8');

/**
 * 🧠 MASTER SYSTEM PROMPT
 * Combines the identity, decision loop, and capability index.
 */
const SYSTEM_PROMPT = `
${AGENT_BEHAVIOR}

---

${AGENT_SKILLS}

---

## 🏗️ EXECUTION GUIDELINES
When generating Java code:
- Use Spring Boot conventions (REST, Service, Repository)
- Use Constructor Injection
- Use DTOs for data transfer
- Include Javadoc and Logging (@Slf4j)
- Pair every implementation with a Mockito unit test
`;

/**
 * 🛠️ CLI GENERATOR PROMPT
 * Specifically for local workspace code generation.
 */
const CLI_GENERATOR_PROMPT = `
${SYSTEM_PROMPT}

## 🎯 CURRENT TASK: LOCAL CODE GENERATION
You are generating code directly into a developer's workspace.
1. Scan the provided Codebase Context to match existing patterns.
2. Follow the Jira Ticket Request exactly.
3. Respond ONLY with a valid JSON object.

JSON OUTPUT SCHEMA:
{
  "thought_process": "brief explanation",
  "files": [
    { "path": "path/to/file.java", "content": "source code" }
  ]
}
`;

/**
 * 🔁 PR REVIEW LEARNING PROMPT
 * For analyzing human feedback and updating team memory.
 */
const PR_REVIEW_PROMPT = `
${SYSTEM_PROMPT}

## 🎯 CURRENT TASK: PR REVIEW LEARNING
Extract generalized coding rules from reviewer comments.
1. Classify feedback (Universal vs Project-Specific).
2. Deduplicate against existing guidelines.
3. Return a JSON array of new rules.

JSON OUTPUT SCHEMA:
[ 
  { "id": "rule-id", "type": "universal or project-specific", "description": "rule description", "category": "style, architecture, etc.", "severity": "medium" } 
]
`;

/**
 * 💬 GITHUB COMMENT REPLY PROMPT
 * For interactive bot responses on GitHub.
 */
const GITHUB_REVIEW_PROMPT = `
${SYSTEM_PROMPT}

## 🎯 CURRENT TASK: GITHUB INLINE REPLY
Propose a fix for the reviewer's comment.
1. Propose code fix based on diff.
2. Extract new rule if applicable.
3. Respond ONLY with the JSON reply schema.

JSON OUTPUT SCHEMA:
{
  "replyMessage": "markdown reply",
  "suggestedCodeFix": "updated code block",
  "newRules": []
}
`;

/**
 * 🔍 CONTEXT SELECTOR PROMPT
 * Pre-generation step: selects the minimum files and rule packs needed.
 * Output is fed as scoped context into CLI_GENERATOR_PROMPT.
 */
const CONTEXT_SELECTOR_PROMPT = `
${CONTEXT_SELECTOR_CONTRACT}
`;

module.exports = { 
    SYSTEM_PROMPT, 
    PR_REVIEW_PROMPT, 
    GITHUB_REVIEW_PROMPT, 
    CLI_GENERATOR_PROMPT,
    CONTEXT_SELECTOR_PROMPT,
    AGENT_BEHAVIOR,
    AGENT_SKILLS
};
