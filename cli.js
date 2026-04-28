// =========================================
// JiraToPR AI — Local CLI Agent
// =========================================

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const aiService = require('./services/aiService');
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
        console.log(`🚀 Initializing connected AI Model...`);
        aiService.initModel(process.env.GEMINI_API_KEY);

        console.log(`🧠 Analyzing ticket and generating local file operations (this may take up to 30 seconds)...`);
        
        // This leverages the new generation function tailored for local disk access
        const resultJSON = await aiService.generateLocalCode(ticketContent, existingStructure);
        
        console.log(`\n✅ AI Architecture & Planning Complete:`);
        console.log(`\n💡 AI Thoughts: ${resultJSON.thought_process}\n`);

        // Print token usage immediately after generation
        if (resultJSON.tokenUsage) {
            console.log('\n' + formatTokenUsage(resultJSON.tokenUsage));
        }

        if (!resultJSON.files || resultJSON.files.length === 0) {
            console.log(`⚠️ No file changes were suggested by the AI.`);
            return;
        }

        console.log(`📂 Applying changes directly to your local workspace...`);
        
        for (const fileDef of resultJSON.files) {
            const targetPath = path.resolve(fileDef.path);
            const dirPath = path.dirname(targetPath);
            
            // Ensure directory exists
            if (!fs.existsSync(dirPath)) {
                fs.mkdirSync(dirPath, { recursive: true });
            }

            // Write or overwrite the file locally
            fs.writeFileSync(targetPath, fileDef.content, 'utf8');
            console.log(`   [WRITTEN] ${fileDef.path}`);
        }

        console.log(`\n🎉 Success! All code and tests have been written directly to your workspace.`);
        console.log(`\n==============================================`);
        console.log(`🛠️  WHAT'S NEXT? (The Review Loop)`);
        console.log(`==============================================`);
        console.log(`Your local files are ready. To trigger the AI Reviewer:`);
        console.log(`  1. git checkout -b feature/${path.basename(ticketPath, '.txt').toLowerCase()}`);
        console.log(`  2. git add . && git commit -m "Implement ${path.basename(ticketPath, '.txt')}"`);
        console.log(`  3. git push origin HEAD`);
        console.log(`  4. Open a Pull Request on GitHub.`);
        console.log(`When your Senior Developer adds a review comment on that PR,`);
        console.log(`the github-agent.js Bot will automatically intercept it,`);
        console.log(`learn from the feedback, and update guidelines.yaml permanently.\n`);

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
