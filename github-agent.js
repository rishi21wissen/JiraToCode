require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const yaml = require('js-yaml');

// Initialize Gemini
const ai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
// We use gemini-1.5-pro for complex coding logic and instruction following
const model = ai.getGenerativeModel({ model: "gemini-1.5-pro" });

const SYSTEM_PROMPT = `You are an expert AI Code Review Agent responding to an inline GitHub review comment on a Pull Request.
We maintain a living checklist grouped into Universal Rules (coding style, validation, testing, error handling, security) and Project-Specific Rules (package structure, naming conventions, architecture, forbidden patterns, team preferences).

## 🔁 Learn from PR Review Feedback
- Classify each comment as Universal: applies across projects, or Project-Specific: applies only to this codebase/team.
- Convert useful feedback into reusable checklist rules.
- If feedback is unclear, mark the reply message as "needs human confirmation".
- Never change project-specific architecture, libraries, or conventions without checking existing code patterns and stored rules.

Perform these steps:
1. Classify the comment (Project-Specific vs Universal).
2. Propose a code fix that solves the reviewer's concern based on the provided diff.
3. Determine if the comment introduces a new rule not present in guidelines.yaml. Add new rules only when review feedback proves they are useful.
4. IMPORTANT: Always return your response strictly mapped inside this JSON schema without any markdown formatting wrappers around the JSON:
{
  "replyMessage": "Markdown string replying to the reviewer and explaining the fix.",
  "suggestedCodeFix": "The exact updated block of code replacing the old line(s) (leave empty if none)",
  "newRules": [ { "id": "rule-id", "type": "universal or project-specific", "description": "rule description", "category": "validation, architecture, style, etc", "severity": "medium" } ]
}`;

module.exports = (app) => {
  app.log.info("JiraToCode Probot App Loaded. Listening for PR review comments...");

  app.on("pull_request_review_comment.created", async (context) => {
    try {
      const payload = context.payload;
      const commentBody = payload.comment.body;
      const diffHunk = payload.comment.diff_hunk;
      const filePath = payload.comment.path;
      
      app.log.info(`Received inline comment on ${filePath}: ${commentBody}`);

      // Prevent infinite loops by ignoring bot comments
      if (payload.comment.user.type === 'Bot') {
        app.log.info("Comment from Bot ignored.");
        return;
      }

      // 1. Fetch current guidelines.yaml from the repo
      let guidelinesText = "";
      try {
        const { data } = await context.octokit.repos.getContent({
          owner: payload.repository.owner.login,
          repo: payload.repository.name,
          path: 'guidelines.yaml',
          ref: payload.pull_request.head.ref
        });
        guidelinesText = Buffer.from(data.content, 'base64').toString('utf8');
      } catch (err) {
        app.log.warn("No guidelines.yaml found in repo or error fetching. Running with empty context.");
      }

      // 2. Build the Gemini payload
      const prompt = `
      File: ${filePath}
      Code Diff Context:
      \`\`\`diff
      ${diffHunk}
      \`\`\`
      Reviewer Comment: "${commentBody}"

      Current repo guidelines.yaml:
      \`\`\`yaml
      ${guidelinesText}
      \`\`\`

      Analyze this and provide the JSON reply according to instructions.
      `;

      app.log.info("Calling Gemini API...");
      const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] }
      });

      const responseText = result.response.text();
      let aiResult;
      
      // Parse JSON safely
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        aiResult = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("Missing JSON structure in AI response");
      }

      // 3. Formulate and post inline reply
      let finalReplyMessage = aiResult.replyMessage;
      if(aiResult.suggestedCodeFix) {
        finalReplyMessage += \`\\n\\n**Suggested Fix:**\\n\`\`\`java\\n\${aiResult.suggestedCodeFix}\\n\`\`\`\`;
      }

      if (aiResult.newRules && aiResult.newRules.length > 0) {
        finalReplyMessage += '\\n\\n*Agent Note: Added new rules to guidelines.yaml.*';
      }

      app.log.info("Posting inline comment to GitHub...");
      await context.octokit.pulls.createReplyForReviewComment({
        owner: payload.repository.owner.login,
        repo: payload.repository.name,
        pull_number: payload.pull_request.number,
        comment_id: payload.comment.id,
        body: finalReplyMessage
      });

      // 4. Auto-update guidelines.yaml on the branch (if new rules exist)
      if (aiResult.newRules && aiResult.newRules.length > 0) {
        app.log.info("New rules detected, fetching guidelines.yaml SHA to update...");
        
        let fileSha;
        let currentYamlData = { universal_guidelines: {}, project_guidelines: {} };
        
        try {
          const { data: fileData } = await context.octokit.repos.getContent({
            owner: payload.repository.owner.login,
            repo: payload.repository.name,
            path: 'guidelines.yaml',
            ref: payload.pull_request.head.ref
          });
          fileSha = fileData.sha;
          const contentStr = Buffer.from(fileData.content, 'base64').toString('utf8');
          currentYamlData = yaml.load(contentStr) || currentYamlData;
        } catch(e) { /* File might not exist yet */ }

        // Append rules
        aiResult.newRules.forEach(rule => {
           let section = rule.type === 'universal' ? 'universal_guidelines' : 'project_guidelines';
           let category = rule.category || 'general';
           if (!currentYamlData[section]) currentYamlData[section] = {};
           if (!currentYamlData[section][category]) currentYamlData[section][category] = [];
           currentYamlData[section][category].push({
               id: rule.id,
               description: rule.description,
               severity: rule.severity || 'medium'
           });
        });

        const updatedYaml = yaml.dump(currentYamlData, { noRefs: true });

        app.log.info("Committing updated guidelines.yaml to branch...");
        await context.octokit.repos.createOrUpdateFileContents({
          owner: payload.repository.owner.login,
          repo: payload.repository.name,
          path: 'guidelines.yaml',
          message: '🤖 AI: Auto-update guidelines based on PR review',
          content: Buffer.from(updatedYaml).toString('base64'),
          sha: fileSha,
          branch: payload.pull_request.head.ref
        });
      }

      app.log.info("PR Review Cycle Completed Successully!");

    } catch (error) {
      app.log.error("Error running review agent:", error);
    }
  });
};
