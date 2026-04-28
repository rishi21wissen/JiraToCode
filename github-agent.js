// JiraToPR AI — GitHub Probot PR Agent (BMAD SOA)
// =========================================
// Imports prompts from config/prompts.js (single source of truth).

require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const yaml = require('js-yaml');
const { GITHUB_REVIEW_PROMPT } = require('./config/prompts');
const { extractTokenUsage, formatTokenLog } = require('./utils/tokenTracker');

// Initialize Gemini
const ai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const currentModelName = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const model = ai.getGenerativeModel({ model: currentModelName });

/**
 * Helper to retry AI calls on 503 / Service Unavailable errors.
 */
async function withRetry(fn, retries = 3, delay = 2000) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            const isRetryable =
                error.message?.includes("503") ||
                error.message?.includes("Service Unavailable") ||
                error.message?.includes("high demand");

            if (!isRetryable || attempt === retries) throw error;

            console.log(`⚠️ Gemini busy (attempt ${attempt}/${retries}), retrying in ${delay / 1000}s...`);
            await new Promise((resolve) => setTimeout(resolve, delay));
            delay *= 2;
        }
    }
}

module.exports = (app) => {
  app.log.info("JiraToPR Probot App Loaded. Listening for PR review comments...");

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
      const result = await withRetry(() => model.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        systemInstruction: { parts: [{ text: GITHUB_REVIEW_PROMPT }] }
      }));

      const responseText = result.response.text();

      // Log token usage for every review-learning request
      const tokenUsage = extractTokenUsage(result, currentModelName);
      app.log.info(formatTokenLog(tokenUsage));

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
        finalReplyMessage += `\n\n**Suggested Fix:**\n\`\`\`java\n${aiResult.suggestedCodeFix}\n\`\`\``;
      }

      if (aiResult.newRules && aiResult.newRules.length > 0) {
        finalReplyMessage += '\n\n*Agent Note: Added new rules to guidelines.yaml.*';
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
           // Deduplicate
           const exists = currentYamlData[section][category].some(r => r.id === rule.id);
           if (!exists) {
               currentYamlData[section][category].push({
                   id: rule.id,
                   description: rule.description,
                   severity: rule.severity || 'medium'
               });
           }
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

      app.log.info("PR Review Cycle Completed Successfully!");

    } catch (error) {
      app.log.error("Error running review agent:", error);
    }
  });
};
