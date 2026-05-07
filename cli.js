// =========================================
// JiraToPR AI — Local CLI Agent (Multi-Agent Orchestration)
// =========================================

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const orchestrator = require('./services/orchestrator');
const { pushAndOpenPR } = require('./services/gitAgent');
const { formatTokenUsage } = require('./utils/tokenTracker');

async function main() {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.error("❌ Usage: node cli.js <path-to-jira-ticket.txt>");
        process.exit(1);
    }

    const ticketPath = path.resolve(args[0]);
    if (!fs.existsSync(ticketPath)) {
        console.error(`❌ File not found: ${ticketPath}`);
        process.exit(1);
    }

    console.log(`\n🤖 JiraToPR Local Agent Initiated...`);
    console.log(`📄 Reading ticket: ${ticketPath}`);
    const ticketContent = fs.readFileSync(ticketPath, 'utf8');

    // Dynamically build a directory map so the AI doesn't hallucinate missing files
    const projectRoot = path.join(__dirname, 'BankingDemo');
    const existingStructure = buildDirectoryTree(projectRoot, projectRoot);
    console.log(`🔍 Scanned ${existingStructure.split('\\n').length} files for context...`);

    try {
        console.log(`🚀 Initializing Multi-Agent Orchestrator...`);
        orchestrator.initModel(process.env.GEMINI_API_KEY);

        console.log(`🧠 Running Manager + Specialist Personas (this may take up to 60 seconds)...`);

        // Manager analyses ticket → delegates to specialist personas in parallel
        const safeData = await orchestrator.run(ticketContent, existingStructure);

        // Print aggregated token usage across all personas
        if (safeData.tokenUsage && safeData.tokenUsage.totalTokens > 0) {
            console.log('\n' + formatTokenUsage(safeData.tokenUsage));
        }

        console.log(`\n✅ Multi-Agent Planning Complete:`);
        console.log(`\n💡 Orchestrator Summary: ${safeData.thoughts || 'No summary provided.'}\n`);

        const allFiles = [...safeData.files, ...safeData.tests];

        if (allFiles.length === 0) {
            console.log(`⚠️ No file changes were suggested by the AI.`);
            return;
        }

        console.log(`📂 Applying changes directly to your local workspace...`);
        
        for (const fileDef of allFiles) {
            const targetPath = path.resolve(fileDef.path);
            const dirPath = path.dirname(targetPath);
            
            if (fileDef.action === 'delete') {
                if (fs.existsSync(targetPath)) {
                    fs.unlinkSync(targetPath);
                    console.log(`   [DELETED] ${fileDef.path}`);
                }
                continue;
            }

            // Ensure directory exists
            if (!fs.existsSync(dirPath)) {
                fs.mkdirSync(dirPath, { recursive: true });
            }

            // Write or overwrite the file locally
            fs.writeFileSync(targetPath, fileDef.content, 'utf8');
            console.log(`   [WRITTEN] ${fileDef.path}`);
        }

        console.log(`\n🎉 Success! All code and tests have been written directly to your workspace.`);

        // 🌿 Hand off to the Git Manager Persona — branch, commit, push, and open/amend PR automatically
        await pushAndOpenPR(ticketPath, safeData.thoughts || '');

    } catch (err) {
        console.error(`\n❌ Fatal Agent Error:`, err.message);
    }
}

// Simple recursive directory tree builder for AI Context
function buildDirectoryTree(dirPath, rootPath, indent = '') {
    let result = '';
    if (!fs.existsSync(dirPath)) return result;
    
    const items = fs.readdirSync(dirPath);
    for (const item of items) {
        if (item === 'node_modules' || item === '.git' || item === 'target') continue;
        
        const fullPath = path.join(dirPath, item);
        const stat = fs.statSync(fullPath);
        
        if (stat.isDirectory()) {
            result += `${indent}📁 ${item}\n`;
            result += buildDirectoryTree(fullPath, rootPath, indent + '  ');
        } else {
            result += `${indent}📄 ${item}\n`;
        }
    }
    return result;
}

main();
