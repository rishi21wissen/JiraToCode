---
name: jiratoPR-skill
description: >
  Core capability definitions for the JiraToPR AI agent. This file defines
  what the agent knows, what it can do, and the boundaries of each skill domain.
  Load this alongside AGENT.md for full agentic behavior.
version: 1.0.0
---

# JiraToPR SKILL.md
## Capability Index for the Autonomous Code Generation Agent

---

## SKILL 1 — Ticket Comprehension

**Trigger**: A `.txt` file is passed as input.

**What the agent must do:**
- Parse the ticket for: feature description, acceptance criteria, affected classes, edge cases
- Detect ambiguity. If the ticket is vague, incomplete, or contradictory — DO NOT generate code. Instead output a structured list of clarifying questions.
- Extract the domain context (e.g., "BankingDemo", "PaymentService") to scope the workspace scan

**Ambiguity Detection Rules:**
- If no acceptance criteria exist → flag it
- If the ticket references a class that doesn't exist in the workspace → flag it
- If two requirements contradict each other → flag both with an explanation
- Confidence threshold: if overall ticket clarity < 70% → ask before acting

**Output Format (when ambiguous):**
```json
{
  "status": "NEEDS_CLARIFICATION",
  "missing": ["acceptance criteria", "target class name"],
  "questions": [
    "Should this method throw an exception or return Optional.empty() on not found?",
    "Is this feature part of an existing service or a new one?"
  ]
}
```

---

## SKILL 2 — Workspace Context Injection

**Trigger**: Ticket is clear. Agent proceeds to scan the workspace.

**What the agent must do:**
- Scan the target workspace directory (e.g., `BankingDemo/`)
- Extract: class names, method signatures, annotations, interfaces implemented
- Identify patterns: naming conventions, exception handling style, return types used
- Build a **Workspace Fingerprint** — a compact summary injected into every generation prompt

**Workspace Fingerprint Format:**
```
WORKSPACE CONTEXT:
- Package: com.banking.demo
- Naming convention: camelCase methods, PascalCase classes
- Exception style: throws custom RuntimeException subclasses
- Return types: Primarily Optional<T> for nullable returns
- Test style: JUnit 5, Mockito, @BeforeEach setup pattern
- Existing classes: [AccountService, TransactionRepository, LoanValidator...]
```

**Rules:**
- Never inject more than 2000 tokens of workspace context
- Prioritize classes that share the same package as the target feature
- If workspace is empty or unreadable → warn and proceed without context

---

## SKILL 3 — Code Generation

**Trigger**: Ticket is clear + workspace context is ready.

**What the agent must do:**
- Generate production-grade Java code that matches the workspace fingerprint
- Always generate TWO artifacts: the implementation file + the JUnit test file
- Respect all active rules in `guidelines.yaml` (confidence ≥ 0.5 only)
- Apply the top 5 most relevant guidelines — not all of them

**Hard Rules for Generated Code:**
- No `null` returns — use `Optional<T>`
- No raw types — always use generics
- No `System.out.println` — use proper logging (`@Slf4j`)
- Methods > 20 lines must be refactored into private helpers
- Every public method must have a Javadoc comment
- Tests must cover: happy path, null input, boundary values, exception case

**Output Format (JSON Mode enforced):**
```json
{
  "status": "SUCCESS",
  "files": [
    {
      "path": "BankingDemo/src/main/java/com/banking/FeatureName.java",
      "content": "..."
    },
    {
      "path": "BankingDemo/src/test/java/com/banking/FeatureNameTest.java",
      "content": "..."
    }
  ],
  "rules_applied": ["rule_003", "rule_007"],
  "warnings": []
}
```

---

## SKILL 4 — TDD Pre-Flight (Optional but Recommended)

**Trigger**: Ticket has clear acceptance criteria with measurable outcomes.

**What the agent must do:**
- Generate JUnit tests FIRST based purely on acceptance criteria
- Each acceptance criterion → at least one test method
- Then generate implementation code that passes those tests
- Report which tests pass/fail conceptually before writing to disk

**Why this matters:**
Tests generated from acceptance criteria are the ground truth. Code generated afterward is forced to be honest about what it's actually solving.

---

## SKILL 5 — Guidelines Memory Management

**What the agent must know about `guidelines.yaml`:**

Each rule has this structure:
```yaml
rules:
  - id: rule_001
    text: "Always use Optional<> instead of null returns"
    hits: 12
    confidence: 0.87
    added: 2025-01-10
    last_validated: 2025-04-20
    source: "PR #44 - reviewer: @senior-dev"
```

**Read Rules:**
- Only inject rules with `confidence >= 0.5`
- Only inject the top 5 rules by relevance to current ticket domain
- Never inject more than 800 tokens of guidelines into any single prompt

**Write Rules (after PR review):**
- Extract rule from reviewer comment using structured extraction prompt
- Check for semantic duplicates before appending (similarity > 0.85 → merge, don't append)
- New rules start at `confidence: 0.5`, `hits: 0`

**Update Rules (after each generation cycle):**
- If generated code using rule_X passed review without flagging rule_X → `hits++`, recalculate confidence
- If reviewer flagged something that rule_X should have caught → `confidence -= 0.1`
- If `confidence < 0.2` for 3 consecutive cycles → mark rule as `status: DEPRECATED`

---

## SKILL 6 — GitHub PR Learning Extraction

**Trigger**: `github-agent.js` intercepts a new PR review comment.

**What the agent must do:**
- Classify the comment: `[STYLE | LOGIC | SECURITY | PERFORMANCE | TEST | NAMING | OTHER]`
- Extract a generalized rule (not ticket-specific, but team-wide applicable)
- Validate: Is this rule already in `guidelines.yaml`? (semantic check)
- If new → append with `confidence: 0.5`
- If duplicate → increment `hits` on existing rule
- If contradicts existing rule → flag for human review, do not auto-apply

**Extraction Prompt Template:**
```
Given this PR reviewer comment:
"{reviewer_comment}"

Extract a single, generalizable coding rule that a Java developer should follow.
Format: {"rule": "...", "category": "...", "reason": "..."}
Return ONLY valid JSON. No explanation.
```

---

## SKILL 7 — Dry Run & Diff Preview

**Trigger**: `--dry-run` flag passed to `cli.js`

**What the agent must do:**
- Run the full pipeline (ticket parse → context → generate)
- Instead of writing files to disk → output a diff-style preview
- Show: files that would be created, files that would be modified, lines added/removed
- Ask for confirmation before writing

**Output:**
```
DRY RUN PREVIEW
───────────────────────────────────────
[NEW] BankingDemo/src/main/.../LoanService.java       (+187 lines)
[NEW] BankingDemo/src/test/.../LoanServiceTest.java   (+94 lines)
[MOD] guidelines.yaml                                  (+1 rule)

Rules applied: rule_003, rule_007, rule_012
Warnings: None

Proceed? (y/n):
```
