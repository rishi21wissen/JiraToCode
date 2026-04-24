// =========================================
// JiraToCode AI — Frontend (BMAD Thin Client)
// =========================================
// All AI logic lives on the backend (server.js → services/aiService.js).
// This file is purely a presentation layer: form handling, UI state, and display.

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

    // API Status (simplified — now shows backend health)
    apiStatus: document.getElementById('api-status'),
    statusText: document.querySelector('.status-text'),
};

// ---------- State ----------
let state = {
    isGenerating: false,
    currentResponse: '',
    currentCodeBlocks: [],
};

// ---------- Initialize ----------
function init() {
    setupEventListeners();
    configureMarked();
    checkBackendHealth();
}

async function checkBackendHealth() {
    try {
        const res = await fetch('/api/guidelines');
        if (res.ok) {
            els.apiStatus.classList.add('connected');
            els.statusText.textContent = 'Backend Ready';
        } else {
            throw new Error('Backend unavailable');
        }
    } catch (e) {
        els.apiStatus.classList.remove('connected');
        els.statusText.textContent = 'Backend Offline';
    }
}

// ---------- Configure Marked.js ----------
function configureMarked() {
    const renderer = new marked.Renderer();

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

// =============================================
// CODE GENERATION — Calls Backend /api/generate-code
// =============================================
async function generateCode() {
    const summary = els.summaryInput.value.trim();
    const description = els.descriptionInput.value.trim();
    const criteria = els.criteriaInput.value.trim();

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

    setLoadingState(true);
    simulateLoadingSteps();

    try {
        const response = await fetch('/api/generate-code', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ summary, description, criteria })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || `Server error: ${response.status}`);
        }

        state.currentResponse = data.output;
        displayResult(data.output);
    } catch (error) {
        showError(error.message);
    } finally {
        setLoadingState(false);
    }
}

// =============================================
// PR REVIEW — Calls Backend /api/analyze-pr
// =============================================
async function analyzeFeedback() {
    const comments = els.prComments.value.trim();
    if (!comments) {
        showToast('Please enter review comments');
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
        const response = await fetch('/api/analyze-pr', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ comments })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || `Server error: ${response.status}`);
        }

        let aiMarkdown = data.output;

        // Clean up JSON rules block for display
        const jsonMatch = aiMarkdown.match(/```json\s+rules\s+([\s\S]*?)```/);
        if (jsonMatch) {
            aiMarkdown = aiMarkdown.replace(jsonMatch[0], '\n> **✅ Guideline updates have been processed and saved to `guidelines.yaml`.**\n');
        }

        if (data.addedCount > 0) {
            showToast(`Added ${data.addedCount} new rules to guidelines.yaml`);
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

// ---------- Simulate Loading Steps ----------
function simulateLoadingSteps() {
    const steps = [
        { id: 'ls-1', text: 'Parsing ticket fields', delay: 500 },
        { id: 'ls-2', text: 'Building implementation checklist', delay: 2000 },
        { id: 'ls-3', text: 'Generating Java code', delay: 5000 },
        { id: 'ls-4', text: 'Verifying acceptance criteria', delay: 8000 },
    ];

    steps.forEach(s => {
        const el = document.getElementById(s.id);
        el.classList.remove('active', 'done');
        el.querySelector('.ls-check').textContent = '○';
    });

    steps.forEach((step, i) => {
        setTimeout(() => {
            if (!state.isGenerating) return;

            for (let j = 0; j < i; j++) {
                const prev = document.getElementById(steps[j].id);
                prev.classList.remove('active');
                prev.classList.add('done');
                prev.querySelector('.ls-check').textContent = '✓';
            }

            const current = document.getElementById(step.id);
            current.classList.add('active');
            current.querySelector('.ls-check').textContent = '⏳';

            els.loadingStep.textContent = step.text;
        }, step.delay);
    });
}

// ---------- Display Result ----------
function displayResult(markdownText) {
    els.outputTabs.style.display = 'flex';
    els.copyAllBtn.style.display = 'flex';

    els.resultFull.innerHTML = marked.parse(markdownText);
    
    extractCodeBlocks(markdownText);
    switchTab('full');

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
        els.emptyState.style.display = 'none';
        els.errorState.style.display = 'none';
        els.resultFull.style.display = 'none';
        els.resultCode.style.display = 'none';
        els.outputTabs.style.display = 'none';
        els.copyAllBtn.style.display = 'none';
        els.loadingState.style.display = 'flex';

        btnIcon.style.display = 'none';
        btnText.style.display = 'none';
        btnLoader.style.display = 'flex';
        els.generateBtn.disabled = true;
    } else {
        els.loadingState.style.display = 'none';

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

// ---------- Start the app ----------
document.addEventListener('DOMContentLoaded', init);
