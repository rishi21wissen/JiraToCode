// =========================================
// JiraToCode AI — Core Application Logic
// =========================================

// ---------- Configuration ----------
const CONFIG = {
    defaultApiKey: 'AIzaSyDK05Du4IUj7mHIBg8CAV24BrcxfuGb6B8',
    defaultModel: 'gemini-2.0-flash',
    apiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/models',
};

// ---------- System Prompt ----------
const SYSTEM_PROMPT = `You are an expert AI software developer tasked with implementing a Jira issue. The issue has a Summary, a Description, and detailed Acceptance Criteria. Your job is to **plan and write Java backend code** that satisfies these requirements.

Follow this structured process:

## 🎯 1. Clarify Objectives
- Restate what the ticket is asking (feature, bug fix, refactor).
- Identify the key deliverables.
- Note any ambiguities, missing info, or assumptions you are making.
- Identify constraints (tech stack, backward compatibility, etc.).

## 📋 2. Implementation Checklist
Break down the work into numbered implementation steps. For example:
- Locate or create relevant classes/packages
- Define new endpoints or modify existing ones
- Implement service logic
- Add validation rules
- Update data models if needed
- Write unit/integration tests
- Handle error cases and edge cases

## 🏗️ 3. Implementation (Java Code)

Write production-ready Java Spring Boot code. Follow these conventions:
- Use **Spring Boot** with \`@RestController\`, \`@Service\`, \`@Repository\` layers
- Use **Spring Data JPA** for data access
- Use **constructor injection** (no \`@Autowired\` on fields)
- Include proper **validation** (\`@Valid\`, \`@NotBlank\`, etc.)
- Include proper **error handling** (custom exceptions, \`@ControllerAdvice\`)
- Add JavaDoc comments and inline comments for key logic
- Use **DTOs** for request/response objects
- Follow Java naming conventions (camelCase methods, PascalCase classes)
- Include package declarations

Structure your code output clearly with separate sections for:
- Entity/Model classes
- Repository interfaces
- Service classes
- Controller classes
- DTOs (Request/Response)
- Exception classes (if needed)
- Test classes

## ✅ 4. Acceptance Verification
For each acceptance criterion, explain exactly how the code satisfies it.
Map each criterion to specific code elements (method, class, line).

## 📝 5. Documentation & Notes
- Summarize any API endpoints created (method, path, request/response format)
- Note any trade-offs or design decisions made
- List any follow-up items or recommendations

## ✅ 6. Reuse Rule & Team Memory
You will be provided with the current team memory via a \`guidelines.yaml\` JSON dump.
1. Read existing rules (both Universal and Project-Specific groups).
2. Match the ticket with past review feedback.
3. Avoid repeating past mistakes.
4. Apply checklist rules during implementation.
5. If a rule conflicts with the current ticket, follow the project-specific rule unless the ticket explicitly overrides it.

IMPORTANT RULES:
- Do NOT rush into code. First produce the checklist, then write code.
- Write COMPLETE, compilable Java code — not pseudocode.
- If a requirement is ambiguous, state the ambiguity and your assumption.
- If the ticket mentions a bug fix, show the fix clearly (before/after if helpful).
- Include ALL necessary imports in each class.
- Make the code production-quality: handle nulls, validation, errors.`;

// ---------- PR Review Prompt ----------
const PR_REVIEW_PROMPT = `You are an expert AI Code Reviewer analyzing pull request comments.
We maintain a living checklist grouped into Universal Rules (coding style, validation, testing, error handling, security) and Project-Specific Rules (package structure, naming conventions, architecture, forbidden patterns, team preferences).

## 🔁 Learn from PR Review Feedback
- Classify each comment as Universal (applies across projects) or Project-Specific (applies only to this codebase/team).
- Do not repeat the same mistake in future tasks.
- Convert useful feedback into reusable checklist rules.
- If feedback is unclear, mark it as "needs human confirmation".
- Never change project-specific architecture, libraries, or conventions without checking existing code patterns and stored rules.

Perform these steps:
1. **Summarize Feedback:** List each reviewer comment in brief bullet form.
2. **Classify Comments:** Label each as **Project-Specific** or **Universal**.
3. **Map to Checklist:** Identify which existing rule it relates to.
4. **Suggest Fixes:** For each comment, propose the code or documentation change needed. 
5. **Update Guidelines:** Add new rules ONLY when review feedback proves they are useful. Output them in a strict JSON array block at the very end of your response inside \`\`\`json rules ... \`\`\` tags. The format must be:
[ 
  { "id": "rule-id", "type": "universal or project-specific", "description": "rule description", "category": "style, architecture, validation, etc.", "severity": "low/medium/high" } 
]
6. **Ready for Review:** Present the updated checklist entries, proposed patches, and any summary notes clearly.`;


// ---------- Example Tickets ----------
const EXAMPLES = {
    'search-products': {
        summary: 'Search Products by Name',
        description: 'Add a search endpoint for products. The user should be able to search for products by name. This is needed for the product catalog page to support a search bar. The search should be case-insensitive and support partial matching.',
        criteria: `1. User can call GET /api/products/search?q={name} to search products
2. The system returns all products whose name contains the search term (case-insensitive)
3. If no product matches, return an empty list with HTTP 200 status
4. The response JSON includes product id, name, description, price, and category for each product
5. The search term must be at least 2 characters long, otherwise return 400 Bad Request
6. Results should be paginated with default page size of 20`
    },
    'sort-tasks': {
        summary: 'Sort Tasks by Due Date',
        description: 'Users should be able to view their tasks sorted by due date. This is for the task dashboard feature.',
        criteria: `1. The API GET /api/tasks returns tasks ordered by due date
2. If two tasks have the same due date, any order between them is acceptable
3. Tasks with no due date should appear at the end of the list`
    },
    'user-registration': {
        summary: 'User Registration Endpoint',
        description: 'Implement a user registration API endpoint. New users should be able to create an account by providing their details. The system should validate inputs, check for duplicate emails, hash passwords, and return a success response with the created user profile (excluding the password).',
        criteria: `1. POST /api/auth/register accepts JSON body with: firstName, lastName, email, password
2. All fields are required; return 400 with field-level errors if any are missing or invalid
3. Email must be a valid email format
4. Password must be at least 8 characters, contain at least one uppercase letter, one lowercase letter, and one digit
5. If email already exists in the system, return 409 Conflict with message "Email already registered"
6. Password must be hashed using BCrypt before storing
7. On success, return 201 Created with user profile (id, firstName, lastName, email, createdAt) — never return the password
8. Send a welcome email to the user after successful registration (async, non-blocking)`
    },
    'edit-profile': {
        summary: 'Edit User Profile',
        description: 'As a registered user, I want to edit my account information so I can keep my profile up to date. Users should be able to update their first name, last name, email, and phone number through a PUT endpoint.',
        criteria: `1. PUT /api/users/{userId}/profile accepts JSON body with: firstName, lastName, email, phone
2. Only authenticated users can update their own profile (return 403 if userId doesn't match authenticated user)
3. The system validates all required fields (firstName, lastName, email are required; phone is optional)
4. If the new email is different and already taken by another user, return 409 Conflict
5. On success, return 200 with the updated user profile
6. The updatedAt timestamp should be refreshed on every successful update`
    }
};

// ---------- DOM Elements ----------
const els = {
    settingsToggle: document.getElementById('settings-toggle'),
    settingsPanel: document.getElementById('settings-panel'),
    apiKeyInput: document.getElementById('api-key-input'),
    toggleKeyVisibility: document.getElementById('toggle-key-visibility'),
    saveKeyBtn: document.getElementById('save-key-btn'),
    modelSelect: document.getElementById('model-select'),
    apiStatus: document.getElementById('api-status'),
    statusText: document.querySelector('.status-text'),

    examplesBtn: document.getElementById('examples-btn'),
    examplesMenu: document.getElementById('examples-menu'),
    
    ticketForm: document.getElementById('ticket-form'),
    summaryInput: document.getElementById('ticket-summary'),
    descriptionInput: document.getElementById('ticket-description'),
    criteriaInput: document.getElementById('ticket-criteria'),
    clearBtn: document.getElementById('clear-btn'),
    generateBtn: document.getElementById('generate-btn'),

    outputTabs: document.getElementById('output-tabs'),
    copyAllBtn: document.getElementById('copy-all-btn'),
    emptyState: document.getElementById('empty-state'),
    loadingState: document.getElementById('loading-state'),
    errorState: document.getElementById('error-state'),
    errorMessage: document.getElementById('error-message'),
    retryBtn: document.getElementById('retry-btn'),
    resultFull: document.getElementById('result-full'),
    resultCode: document.getElementById('result-code'),
    loadingStep: document.getElementById('loading-step'),
    
    toast: document.getElementById('toast'),
    toastMessage: document.getElementById('toast-message'),

    // PR Review
    navTabs: document.querySelectorAll('.nav-tab'),
    viewContainers: document.querySelectorAll('.view-container'),
    prForm: document.getElementById('pr-form'),
    prComments: document.getElementById('pr-comments'),
    prAnalyzeBtn: document.getElementById('pr-analyze-btn'),
    prClearBtn: document.getElementById('pr-clear-btn'),
    prOutputContent: document.getElementById('pr-output-content'),
    prEmptyState: document.getElementById('pr-empty-state'),
    prResultFull: document.getElementById('pr-result-full'),
};

// ---------- State ----------
let state = {
    apiKey: '',
    model: CONFIG.defaultModel,
    isGenerating: false,
    currentResponse: '',
    currentCodeBlocks: [],
};

// ---------- Initialize ----------
function init() {
    loadSettings();
    setupEventListeners();
    configureMarked();
    updateApiStatus();
}

function loadSettings() {
    const savedKey = localStorage.getItem('jiratocode_apikey');
    const savedModel = localStorage.getItem('jiratocode_model');

    state.apiKey = savedKey || CONFIG.defaultApiKey;
    state.model = savedModel || CONFIG.defaultModel;

    els.apiKeyInput.value = state.apiKey;
    els.modelSelect.value = state.model;
}

function saveSettings() {
    state.apiKey = els.apiKeyInput.value.trim();
    state.model = els.modelSelect.value;

    localStorage.setItem('jiratocode_apikey', state.apiKey);
    localStorage.setItem('jiratocode_model', state.model);
    
    updateApiStatus();
    showToast('Settings saved successfully!');
}

function updateApiStatus() {
    if (state.apiKey) {
        els.apiStatus.classList.add('connected');
        els.statusText.textContent = 'API Ready';
    } else {
        els.apiStatus.classList.remove('connected');
        els.statusText.textContent = 'Not configured';
    }
}

// ---------- Configure Marked.js ----------
function configureMarked() {
    const renderer = new marked.Renderer();

    // Custom code block rendering with copy button
    renderer.code = function(codeObj) {
        const code = codeObj.text || codeObj;
        const lang = codeObj.lang || '';
        
        let highlighted;
        if (lang && hljs.getLanguage(lang)) {
            try {
                highlighted = hljs.highlight(code, { language: lang }).value;
            } catch (_) {
                highlighted = escapeHtml(code);
            }
        } else {
            highlighted = escapeHtml(code);
        }

        return `<pre><button class="copy-code-btn" onclick="copyCodeBlock(this)">Copy</button><code class="hljs language-${lang}">${highlighted}</code></pre>`;
    };

    marked.setOptions({
        renderer: renderer,
        gfm: true,
        breaks: false,
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ---------- Event Listeners ----------
function setupEventListeners() {
    // Settings toggle
    els.settingsToggle.addEventListener('click', () => {
        els.settingsPanel.classList.toggle('open');
    });

    // Save API key
    els.saveKeyBtn.addEventListener('click', saveSettings);
    els.apiKeyInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') saveSettings();
    });

    // Model select
    els.modelSelect.addEventListener('change', () => {
        state.model = els.modelSelect.value;
        localStorage.setItem('jiratocode_model', state.model);
        showToast(`Model changed to ${state.model}`);
    });

    // Toggle key visibility
    els.toggleKeyVisibility.addEventListener('click', () => {
        const input = els.apiKeyInput;
        input.type = input.type === 'password' ? 'text' : 'password';
    });

    // Examples dropdown
    els.examplesBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        els.examplesMenu.classList.toggle('open');
    });

    document.addEventListener('click', () => {
        els.examplesMenu.classList.remove('open');
    });

    // Example items
    document.querySelectorAll('.dropdown-item').forEach(item => {
        item.addEventListener('click', () => {
            const key = item.getAttribute('data-example');
            loadExample(key);
            els.examplesMenu.classList.remove('open');
        });
    });

    // Form submission
    els.ticketForm.addEventListener('submit', (e) => {
        e.preventDefault();
        generateCode();
    });

    // Clear form
    els.clearBtn.addEventListener('click', clearForm);

    // Retry
    els.retryBtn.addEventListener('click', generateCode);

    // Copy all
    els.copyAllBtn.addEventListener('click', copyAllOutput);

    // Tabs
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    // App Navigation Tabs
    if (els.navTabs) {
        els.navTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                els.navTabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                
                els.viewContainers.forEach(vc => vc.classList.remove('active'));
                
                const viewId = 'view-' + tab.getAttribute('data-view');
                const viewEl = document.getElementById(viewId);
                if(viewEl) viewEl.classList.add('active');
                
                if(tab.getAttribute('data-view') === 'prreview') {
                    if(els.outputTabs) els.outputTabs.style.display = 'none';
                    if(els.copyAllBtn) els.copyAllBtn.style.display = 'none';
                }
            });
        });
    }

    // PR Review Form
    if (els.prForm) {
        els.prForm.addEventListener('submit', (e) => {
            e.preventDefault();
            analyzeFeedback();
        });

        els.prClearBtn.addEventListener('click', () => {
            els.prComments.value = '';
            els.prComments.focus();
        });
    }
}

// ---------- Load Example ----------
function loadExample(key) {
    const example = EXAMPLES[key];
    if (!example) return;

    els.summaryInput.value = example.summary;
    els.descriptionInput.value = example.description;
    els.criteriaInput.value = example.criteria;

    // Animate inputs
    [els.summaryInput, els.descriptionInput, els.criteriaInput].forEach(el => {
        el.style.transition = 'background 0.5s ease';
        el.style.background = 'rgba(124,58,237,0.12)';
        setTimeout(() => {
            el.style.background = '';
        }, 600);
    });

    showToast(`Loaded example: ${example.summary}`);
}

// ---------- Clear Form ----------
function clearForm() {
    els.summaryInput.value = '';
    els.descriptionInput.value = '';
    els.criteriaInput.value = '';
    els.summaryInput.focus();
}

// ---------- Generate Code ----------
async function generateCode() {
    const summary = els.summaryInput.value.trim();
    const description = els.descriptionInput.value.trim();
    const criteria = els.criteriaInput.value.trim();

    // Validate inputs
    if (!summary) {
        showToast('Please enter a ticket summary');
        els.summaryInput.focus();
        return;
    }
    if (!criteria) {
        showToast('Please enter acceptance criteria');
        els.criteriaInput.focus();
        return;
    }
    if (!state.apiKey) {
        showToast('Please configure your API key first');
        els.settingsPanel.classList.add('open');
        els.apiKeyInput.focus();
        return;
    }

    // Build the user message
    const userMessage = buildUserMessage(summary, description, criteria);

    // Show loading state
    setLoadingState(true);

    try {
        const response = await callGeminiAPI(userMessage);
        state.currentResponse = response;
        
        // Parse and display result
        displayResult(response);
    } catch (error) {
        showError(error.message);
    } finally {
        setLoadingState(false);
    }
}

// ---------- Build User Message ----------
function buildUserMessage(summary, description, criteria) {
    return `## Jira Ticket

**Summary:** ${summary}

**Description:** ${description || '(No additional description provided)'}

**Acceptance Criteria:**
${criteria}

---

Please analyze this Jira ticket and generate the implementation following the structured process (Clarify → Checklist → Code → Verify → Document). Write production-ready Java Spring Boot code.`;
}

// ---------- Call Gemini API ----------
async function callGeminiAPI(userMessage) {
    const url = `${CONFIG.apiBaseUrl}/${state.model}:generateContent?key=${state.apiKey}`;

    const body = {
        contents: [
            {
                role: "user",
                parts: [{ text: userMessage }]
            }
        ],
        systemInstruction: {
            parts: [{ text: SYSTEM_PROMPT }]
        },
        generationConfig: {
            temperature: 0.4,
            topP: 0.95,
            topK: 40,
            maxOutputTokens: 8192,
        }
    };

    // Simulate loading steps
    simulateLoadingSteps();

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMsg = errorData?.error?.message || `API Error: ${response.status} ${response.statusText}`;
        
        if (response.status === 400) {
            throw new Error(`Invalid request: ${errorMsg}`);
        } else if (response.status === 401 || response.status === 403) {
            throw new Error('Invalid API key. Please check your Gemini API key in settings.');
        } else if (response.status === 429) {
            throw new Error('Rate limit exceeded. Please wait a moment and try again.');
        } else {
            throw new Error(errorMsg);
        }
    }

    const data = await response.json();

    // Extract text from response
    const candidates = data.candidates;
    if (!candidates || candidates.length === 0) {
        throw new Error('No response generated. The model may have refused the request.');
    }

    const parts = candidates[0].content?.parts;
    if (!parts || parts.length === 0) {
        throw new Error('Empty response from the model.');
    }

    return parts.map(p => p.text).join('\n');
}

// ---------- Simulate Loading Steps ----------
function simulateLoadingSteps() {
    const steps = [
        { id: 'ls-1', text: 'Parsing ticket fields', delay: 500 },
        { id: 'ls-2', text: 'Building implementation checklist', delay: 2000 },
        { id: 'ls-3', text: 'Generating Java code', delay: 5000 },
        { id: 'ls-4', text: 'Verifying acceptance criteria', delay: 8000 },
    ];

    // Reset all steps
    steps.forEach(s => {
        const el = document.getElementById(s.id);
        el.classList.remove('active', 'done');
        el.querySelector('.ls-check').textContent = '○';
    });

    steps.forEach((step, i) => {
        setTimeout(() => {
            if (!state.isGenerating) return;

            // Mark previous steps as done
            for (let j = 0; j < i; j++) {
                const prev = document.getElementById(steps[j].id);
                prev.classList.remove('active');
                prev.classList.add('done');
                prev.querySelector('.ls-check').textContent = '✓';
            }

            // Mark current as active
            const current = document.getElementById(step.id);
            current.classList.add('active');
            current.querySelector('.ls-check').textContent = '⏳';

            els.loadingStep.textContent = step.text;
        }, step.delay);
    });
}

// ---------- Display Result ----------
function displayResult(markdownText) {
    // Show tabs and actions
    els.outputTabs.style.display = 'flex';
    els.copyAllBtn.style.display = 'flex';

    // Render full response
    els.resultFull.innerHTML = marked.parse(markdownText);
    
    // Extract code blocks for "Code Only" tab
    extractCodeBlocks(markdownText);

    // Show full response tab
    switchTab('full');

    // Re-highlight code blocks
    els.resultFull.querySelectorAll('pre code').forEach(block => {
        hljs.highlightElement(block);
    });
}

// ---------- Extract Code Blocks ----------
function extractCodeBlocks(markdown) {
    const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
    const blocks = [];
    let match;

    while ((match = codeBlockRegex.exec(markdown)) !== null) {
        blocks.push({
            lang: match[1] || 'java',
            code: match[2].trim()
        });
    }

    state.currentCodeBlocks = blocks;

    if (blocks.length === 0) {
        els.resultCode.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 40px;">No code blocks found in the response.</p>';
        return;
    }

    let html = '';
    blocks.forEach((block, i) => {
        let highlighted;
        try {
            highlighted = hljs.highlight(block.code, { language: block.lang }).value;
        } catch (_) {
            highlighted = escapeHtml(block.code);
        }

        // Try to extract a label from the code (e.g., class name)
        let label = block.lang.toUpperCase();
        const classMatch = block.code.match(/(?:class|interface|enum)\s+(\w+)/);
        if (classMatch) {
            label = `${classMatch[1]}.java`;
        }

        html += `
            <div class="code-block-wrapper">
                <span class="code-label">${label}</span>
                <pre><button class="copy-code-btn" onclick="copyCodeBlock(this)">Copy</button><code class="hljs language-${block.lang}">${highlighted}</code></pre>
            </div>
        `;
    });

    els.resultCode.innerHTML = html;
}

// ---------- Tab Switching ----------
function switchTab(tabName) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelector(`.tab[data-tab="${tabName}"]`).classList.add('active');

    els.resultFull.style.display = tabName === 'full' ? 'block' : 'none';
    els.resultCode.style.display = tabName === 'code' ? 'block' : 'none';
}

// ---------- Loading State ----------
function setLoadingState(loading) {
    state.isGenerating = loading;

    const btnIcon = els.generateBtn.querySelector('.btn-icon');
    const btnText = els.generateBtn.querySelector('.btn-text');
    const btnLoader = els.generateBtn.querySelector('.btn-loader');

    if (loading) {
        // Hide results, show loading
        els.emptyState.style.display = 'none';
        els.errorState.style.display = 'none';
        els.resultFull.style.display = 'none';
        els.resultCode.style.display = 'none';
        els.outputTabs.style.display = 'none';
        els.copyAllBtn.style.display = 'none';
        els.loadingState.style.display = 'flex';

        // Button state
        btnIcon.style.display = 'none';
        btnText.style.display = 'none';
        btnLoader.style.display = 'flex';
        els.generateBtn.disabled = true;
    } else {
        els.loadingState.style.display = 'none';

        // Button state
        btnIcon.style.display = 'block';
        btnText.style.display = 'block';
        btnLoader.style.display = 'none';
        els.generateBtn.disabled = false;
    }
}

// ---------- Show Error ----------
function showError(message) {
    els.emptyState.style.display = 'none';
    els.loadingState.style.display = 'none';
    els.resultFull.style.display = 'none';
    els.resultCode.style.display = 'none';
    els.outputTabs.style.display = 'none';
    els.copyAllBtn.style.display = 'none';
    
    els.errorState.style.display = 'flex';
    els.errorMessage.textContent = message;
}

// ---------- Copy Functions ----------
function copyCodeBlock(btn) {
    const code = btn.nextElementSibling.textContent;
    navigator.clipboard.writeText(code).then(() => {
        btn.textContent = 'Copied!';
        btn.classList.add('copied');
        setTimeout(() => {
            btn.textContent = 'Copy';
            btn.classList.remove('copied');
        }, 2000);
    });
}

function copyAllOutput() {
    const text = state.currentResponse;
    navigator.clipboard.writeText(text).then(() => {
        els.copyAllBtn.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="20 6 9 17 4 12"/>
            </svg>
            Copied!
        `;
        els.copyAllBtn.classList.add('copied');
        setTimeout(() => {
            els.copyAllBtn.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="9" y="9" width="13" height="13" rx="2"/>
                    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
                </svg>
                Copy All
            `;
            els.copyAllBtn.classList.remove('copied');
        }, 2000);
    });
}

// Make copyCodeBlock available globally (used in onclick)
window.copyCodeBlock = copyCodeBlock;

// ---------- Toast ----------
function showToast(message) {
    els.toastMessage.textContent = message;
    els.toast.classList.add('show');
    setTimeout(() => {
        els.toast.classList.remove('show');
    }, 3000);
}

// ---------- PR Review Logic ----------
async function getLocalGuidelines() {
    try {
        const port = window.location.port || 3000;
        const res = await fetch(`http://localhost:${port}/api/guidelines`);
        if(res.ok) {
            return await res.json();
        }
    } catch(e) {
        console.warn('Could not load local guidelines, proceeding without them.');
    }
    return null;
}

async function uploadNewGuidelines(rulesArray) {
    try {
        const port = window.location.port || 3000;
        const res = await fetch(`http://localhost:${port}/api/guidelines`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ newRules: rulesArray })
        });
        const data = await res.json();
        if(data.success && data.addedCount > 0) {
            showToast(`Added ${data.addedCount} new rules to guidelines.yaml via Backend`);
        }
    } catch(e) {
        console.warn('Could not upload guidelines, backend might not be running.');
    }
}

async function analyzeFeedback() {
    const comments = els.prComments.value.trim();
    if(!comments) {
        showToast('Please enter review comments');
        return;
    }
    if (!state.apiKey) {
        showToast('Please configure your API key first');
        return;
    }

    // Start loading
    els.prAnalyzeBtn.disabled = true;
    els.prAnalyzeBtn.querySelector('.btn-text').style.display = 'none';
    els.prAnalyzeBtn.querySelector('.btn-loader').style.display = 'flex';
    els.prEmptyState.style.display = 'none';
    els.prResultFull.style.display = 'none';
    els.prResultFull.innerHTML = '<div class="loading-state" style="padding: 40px; text-align: center;"><div class="loading-ring" style="margin:0 auto 20px;"><div></div><div></div><div></div><div></div></div><p style="color:var(--text-muted);">Analyzing feedback & mapping to guidelines...</p></div>';
    els.prResultFull.style.display = 'block';

    try {
        const guidelines = await getLocalGuidelines();
        let userMsg = `## Review Comments\n\n${comments}\n`;
        if (guidelines && (Object.keys(guidelines.universal_guidelines || {}).length > 0 || Object.keys(guidelines.project_guidelines || {}).length > 0)) {
            userMsg += `\n## Current Guidelines Context\n\`\`\`json\n${JSON.stringify(guidelines, null, 2)}\n\`\`\``;
        }

        const url = `${CONFIG.apiBaseUrl}/${state.model}:generateContent?key=${state.apiKey}`;
        const body = {
            contents: [{ role: "user", parts: [{ text: userMsg }] }],
            systemInstruction: { parts: [{ text: PR_REVIEW_PROMPT }] },
            generationConfig: { temperature: 0.3 }
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!response.ok) throw new Error('API request failed');
        const data = await response.json();
        let aiMarkdown = data.candidates[0].content.parts[0].text;

        // Extract JSON rules if present
        const jsonMatch = aiMarkdown.match(/```json\s+rules\s+([\s\S]*?)```/);
        if (jsonMatch) {
            try {
                const newRules = JSON.parse(jsonMatch[1]);
                if (Array.isArray(newRules) && newRules.length > 0) {
                    await uploadNewGuidelines(newRules);
                }
            } catch(e) { console.error("Failed to parse AI JSON block", e); }
            // Clean up the markdown view
            aiMarkdown = aiMarkdown.replace(jsonMatch[0], '\n> [!NOTE]\n> *Guideline updates have been processed and saved to `guidelines.yaml`.*\n');
        }

        els.prResultFull.innerHTML = marked.parse(aiMarkdown);
        els.prResultFull.querySelectorAll('pre code').forEach(block => hljs.highlightElement(block));
    } catch (error) {
        els.prResultFull.innerHTML = `<div class="error-state"><div class="error-icon">⚠️</div><h3>Failed</h3><p>${error.message}</p></div>`;
    } finally {
        els.prAnalyzeBtn.disabled = false;
        els.prAnalyzeBtn.querySelector('.btn-text').style.display = 'block';
        els.prAnalyzeBtn.querySelector('.btn-loader').style.display = 'none';
    }
}

// ---------- Start the app ----------
document.addEventListener('DOMContentLoaded', init);
