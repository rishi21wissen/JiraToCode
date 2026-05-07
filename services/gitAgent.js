// =========================================
// JiraToPR AI — Git Manager Persona
// =========================================
// Handles all Git + GitHub operations after local code is written.
// - Creates or switches to the feature branch
// - Commits and pushes all changes
// - Opens a new PR, or updates the description of an existing one

const { execSync } = require('child_process');
const https = require('https');

// ---------- Config ----------
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO  = process.env.GITHUB_REPO;

// ---------- Helpers ----------

/**
 * Runs a shell command synchronously and returns the trimmed output.
 * Throws on non-zero exit codes.
 */
function run(cmd, cwd = process.cwd()) {
    return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

/**
 * Makes an authenticated HTTPS request to the GitHub REST API.
 * Returns a Promise that resolves to the parsed JSON response body.
 */
function githubRequest(method, endpoint, body = null) {
    return new Promise((resolve, reject) => {
        if (!GITHUB_TOKEN) {
            return reject(new Error(
                'GITHUB_TOKEN is not set. Add it to your .env file.\n' +
                'Get one at: https://github.com/settings/tokens (needs repo scope)'
            ));
        }
        if (!GITHUB_OWNER || !GITHUB_REPO) {
            return reject(new Error(
                'GITHUB_OWNER and GITHUB_REPO must be set in your .env file.\n' +
                'Example: GITHUB_OWNER=your-username, GITHUB_REPO=JiraToCode'
            ));
        }

        const payload = body ? JSON.stringify(body) : null;
        const options = {
            hostname: 'api.github.com',
            path: `/repos/${GITHUB_OWNER}/${GITHUB_REPO}${endpoint}`,
            method,
            headers: {
                'Authorization': `Bearer ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github+json',
                'User-Agent': 'JiraToPR-GitAgent/1.0',
                'X-GitHub-Api-Version': '2022-11-28',
                ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {})
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => (data += chunk));
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, body: data ? JSON.parse(data) : {} });
                } catch {
                    resolve({ status: res.statusCode, body: data });
                }
            });
        });
        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
}

// ---------- Git Operations ----------

/**
 * Derives a safe branch name from the ticket filename.
 * e.g. "ACC-101.txt" -> "feature/acc-101"
 */
function getBranchName(ticketFilePath) {
    const base = require('path').basename(ticketFilePath, '.txt').toLowerCase();
    return `feature/${base}`;
}

/**
 * Returns the current local branch name.
 */
function getCurrentBranch() {
    return run('git rev-parse --abbrev-ref HEAD');
}

/**
 * Returns true if the given local branch already exists.
 */
function localBranchExists(branchName) {
    try {
        run(`git rev-parse --verify ${branchName}`);
        return true;
    } catch {
        return false;
    }
}

/**
 * Returns true if the given remote branch already exists on origin.
 */
function remoteBranchExists(branchName) {
    try {
        run(`git ls-remote --exit-code --heads origin ${branchName}`);
        return true;
    } catch {
        return false;
    }
}

// ---------- GitHub PR Operations ----------

/**
 * Fetches the first open PR for the given branch, or null if none exists.
 */
async function findExistingPR(branchName) {
    const res = await githubRequest('GET', `/pulls?state=open&head=${GITHUB_OWNER}:${branchName}&per_page=1`);
    if (res.status === 200 && Array.isArray(res.body) && res.body.length > 0) {
        return res.body[0];
    }
    return null;
}

/**
 * Opens a brand-new Pull Request.
 */
async function openPullRequest(branchName, ticketName, thoughts) {
    const body = [
        `## 🤖 AI-Generated Implementation`,
        `**Ticket:** \`${ticketName.toUpperCase()}\``,
        ``,
        `### 💡 Agent Reasoning`,
        thoughts || 'No reasoning provided.',
        ``,
        `---`,
        `*This PR was created automatically by the JiraToPR AI Agent.*`,
        `*Add an inline review comment on the Files Changed tab to trigger the learning loop.*`
    ].join('\n');

    const res = await githubRequest('POST', '/pulls', {
        title: `[AI] Implement ${ticketName.toUpperCase()}`,
        head: branchName,
        base: 'main',
        body
    });

    // Fallback to 'master' if 'main' does not exist
    if (res.status === 422 && JSON.stringify(res.body).includes('main')) {
        const fallback = await githubRequest('POST', '/pulls', {
            title: `[AI] Implement ${ticketName.toUpperCase()}`,
            head: branchName,
            base: 'master',
            body
        });
        return fallback.body;
    }

    return res.body;
}

/**
 * Amends the body of an existing PR to reflect the latest push.
 */
async function amendPullRequest(prNumber, ticketName, thoughts) {
    const body = [
        `## 🤖 AI-Generated Implementation (Updated)`,
        `**Ticket:** \`${ticketName.toUpperCase()}\``,
        ``,
        `### 💡 Agent Reasoning (Latest Run)`,
        thoughts || 'No reasoning provided.',
        ``,
        `---`,
        `*Updated automatically by the JiraToPR AI Agent on ${new Date().toISOString()}.*`
    ].join('\n');

    const res = await githubRequest('PATCH', `/pulls/${prNumber}`, { body });
    return res.body;
}

// ---------- Main Entry Point ----------

/**
 * Orchestrates the full Git → Push → PR flow.
 *
 * @param {string} ticketFilePath  - Path to the ticket .txt file (for branch naming)
 * @param {string} thoughts        - AI reasoning text to include in the PR description
 */
async function pushAndOpenPR(ticketFilePath, thoughts = '') {
    const branchName = getBranchName(ticketFilePath);
    const ticketName = require('path').basename(ticketFilePath, '.txt');
    const currentBranch = getCurrentBranch();

    console.log(`\n🌿 Git Manager Persona Activated`);
    console.log(`   Target Branch : ${branchName}`);

    // ── Step 1: Checkout or create the feature branch ──
    if (localBranchExists(branchName)) {
        if (currentBranch !== branchName) {
            console.log(`   Switching to existing local branch...`);
            run(`git checkout ${branchName}`);
        } else {
            console.log(`   Already on branch ${branchName}.`);
        }
    } else {
        console.log(`   Creating new branch: ${branchName}`);
        run(`git checkout -b ${branchName}`);
    }

    // ── Step 2: Stage and commit ──
    const status = run('git status --porcelain');
    if (!status) {
        console.log(`   ⚠️  No file changes detected. Nothing to commit.`);
    } else {
        run('git add .');
        const existingPRCheck = await findExistingPR(branchName).catch(() => null);
        const commitMsg = existingPRCheck
            ? `Update ${ticketName.toUpperCase()} — AI agent iteration`
            : `Implement ${ticketName.toUpperCase()} — AI agent`;
        run(`git commit -m "${commitMsg}"`);
        console.log(`   ✅ Committed: "${commitMsg}"`);
    }

    // ── Step 3: Push to origin ──
    if (remoteBranchExists(branchName)) {
        console.log(`   Pushing update to existing remote branch...`);
        run(`git push origin ${branchName}`);
    } else {
        console.log(`   Pushing new branch to origin...`);
        run(`git push -u origin ${branchName}`);
    }
    console.log(`   ✅ Pushed to origin/${branchName}`);

    // ── Step 4: Open or amend the PR ──
    if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
        console.log(`\n⚠️  GitHub API skipped (GITHUB_TOKEN / GITHUB_OWNER / GITHUB_REPO not set).`);
        console.log(`   Go to GitHub and open a PR from branch: ${branchName}`);
        return;
    }

    console.log(`\n🔗 Checking for an existing PR on GitHub...`);
    const existingPR = await findExistingPR(branchName);

    if (existingPR) {
        console.log(`   Found existing PR #${existingPR.number}. Amending description...`);
        const updated = await amendPullRequest(existingPR.number, ticketName, thoughts);
        console.log(`\n✅ PR Updated: ${updated.html_url}`);
    } else {
        console.log(`   No existing PR found. Opening a new PR...`);
        const newPR = await openPullRequest(branchName, ticketName, thoughts);
        if (newPR.html_url) {
            console.log(`\n✅ PR Opened: ${newPR.html_url}`);
        } else {
            console.error(`\n❌ PR creation failed:`, JSON.stringify(newPR, null, 2));
        }
    }

    console.log(`\n🎯 Learning Loop is ready!`);
    console.log(`   Go to the PR → "Files changed" tab → click the + icon on any line → add your review comment.`);
    console.log(`   The github-agent.js bot will intercept it and update guidelines.yaml automatically.\n`);
}

module.exports = { pushAndOpenPR, getBranchName };
