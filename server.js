const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
// Serve static files from the current directory
app.use(express.static(path.join(__dirname)));

const GUIDELINES_FILE = path.join(__dirname, 'guidelines.yaml');

// Helper to read guidelines safely
function readGuidelines() {
    try {
        if (!fs.existsSync(GUIDELINES_FILE)) {
            // Default if it doesn't exist
            return { universal_guidelines: {}, project_guidelines: {} };
        }
        const fileContents = fs.readFileSync(GUIDELINES_FILE, 'utf8');
        const data = yaml.load(fileContents) || {};
        return data;
    } catch (e) {
        console.error("Error reading guidelines.yaml", e);
        return { universal_guidelines: {}, project_guidelines: {} };
    }
}

// Get guidelines
app.get('/api/guidelines', (req, res) => {
    res.json(readGuidelines());
});

// Update guidelines with new rules
app.post('/api/guidelines', (req, res) => {
    const newRules = req.body.newRules || [];
    
    if (newRules.length === 0) {
        return res.json({ success: true, message: 'No new rules to add.' });
    }

    const currentData = readGuidelines();
    
    // Ensure structure exists
    if (!currentData.universal_guidelines) currentData.universal_guidelines = {};
    if (!currentData.project_guidelines) currentData.project_guidelines = {};

    let addedCount = 0;

    newRules.forEach(rule => {
        if (!rule.id || !rule.description || !rule.type) return;

        // Categorize into universal or project
        const targetSection = rule.type.toLowerCase() === 'universal' 
            ? 'universal_guidelines' 
            : 'project_guidelines';
        
        // Use a generic category group like "general" if category is not provided
        const category = rule.category || 'general';

        if (!currentData[targetSection][category]) {
            currentData[targetSection][category] = [];
        }

        // Check if rule ID already exists to prevent duplicates
        const exists = currentData[targetSection][category].find(r => r.id === rule.id);
        
        if (!exists) {
            currentData[targetSection][category].push({
                id: rule.id,
                description: rule.description,
                severity: rule.severity || 'medium'
            });
            addedCount++;
        }
    });

    if (addedCount > 0) {
        // Write back to file
        const newYaml = yaml.dump(currentData, { noRefs: true });
        fs.writeFileSync(GUIDELINES_FILE, newYaml, 'utf8');
    }

    res.json({ success: true, addedCount, currentData });
});

app.listen(PORT, () => {
    console.log(`Backend server running at http://localhost:${PORT}`);
    console.log(`Serving static files and APIs...`);
});
