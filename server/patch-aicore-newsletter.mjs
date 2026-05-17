import fs from 'fs';

let code = fs.readFileSync('services/ai-core.service.js', 'utf8');

// Add import
if (!code.includes('import NewsletterService')) {
  code = code.replace(
    /import ExcelService\s+from '\.\/excel\.service\.js';/,
    `import ExcelService           from './excel.service.js';\nimport NewsletterService      from './newsletter.service.js';`
  );
}

// Add detector function
if (!code.includes('function isNewsletterCommand')) {
  const detector = `
export function isNewsletterCommand(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return lower.includes('/newsletter') || lower.includes('signal') || lower.includes('newsletter');
}
`;
  code = code.replace(
    /export function isExcelCommand\(text\) \{[\s\S]*?\}/,
    match => match + '\n' + detector
  );
}

// Add routing
if (!code.includes('if (isNewsletterCommand(message))')) {
  code = code.replace(
    /if \(isExcelCommand\(message\)\) \{\s*return this\._handleExcelCommand\(\{ userId, botId, bot, message, threadId, history, attachedFile \}\);\s*\}/,
    `if (isExcelCommand(message)) {
        return this._handleExcelCommand({ userId, botId, bot, message, threadId, history, attachedFile });
      }

      if (isNewsletterCommand(message)) {
        return this._handleNewsletterCommand({ userId, botId, bot, message, threadId, history, attachedFile });
      }`
  );
}

// Add handler
if (!code.includes('async _handleNewsletterCommand')) {
  const handler = `
  async _handleNewsletterCommand({ userId, botId, bot, message, threadId, history = [], attachedFile }) {
    try {
      await new Chat({ userId, botId, threadId, role: 'user', content: message }).save();
      console.log('[NEWSLETTER] Generating GYS Steel Signal Image...');

      let contentUserMsg = \`=== PERMINTAAN USER (Format GYS Steel Signal) ===\\n\${message}\\n\\n\`;
      contentUserMsg += \`Please generate a JSON object for the "GYS Steel Signal" newsletter based on the user's request and any provided news links. Your output MUST be ONLY a raw JSON object.
Structure:
{
  "headline": "String - Main news headline (max 80 chars)",
  "summaryParagraphs": ["String - Paragraph 1", "String - Paragraph 2"],
  "keyPoints": [
    { "title": "String - Point 1 Title", "description": "String - Point 1 Description" },
    { "title": "String - Point 2 Title", "description": "String - Point 2 Description" },
    { "title": "String - Point 3 Title", "description": "String - Point 3 Description" }
  ],
  "implicationIntro": "String - Short intro to implications",
  "implicationCustomer": "String - Customer behavior implication",
  "implicationSupplier": "String - Supplier behavior implication",
  "implicationMarket": "String - Market narrative implication",
  "actionSalesCheck": "String - Sales action check",
  "actionSalesRec": "String - Sales recommended action",
  "actionProcurementCheck": "String - Procurement action check",
  "actionProcurementRec": "String - Procurement recommended action",
  "managementTakeaway": "String - A strong management takeaway quote (italicized tone)",
  "sourceLinks": ["String - URL 1", "String - URL 2"]
}\`;

      const aiResponse = await AIProviderService.generateCompletion({
        providerConfig: bot.aiProvider || { provider: 'openai', model: 'gpt-4o' },
        systemPrompt: "You are an expert market intelligence analyst. You output ONLY valid raw JSON.",
        messages: history,
        userContent: contentUserMsg,
        timeout: 120000,
        maxTokens: 4000,
      });

      let rawJson = aiResponse.text.replace(/\`\`\`json\\s*/gi, '').replace(/\`\`\`\\s*/gi, '').trim();
      const jsonStart = rawJson.indexOf('{');
      const jsonEnd = rawJson.lastIndexOf('}');
      if (jsonStart !== -1 && jsonEnd !== -1) {
        rawJson = rawJson.substring(jsonStart, jsonEnd + 1);
      }
      
      const newsletterData = JSON.parse(rawJson);

      const outputDir = require('path').join(process.cwd(), 'data', 'files');
      const result = await NewsletterService.generateNewsletterImage({ data: newsletterData, outputDir });

      let linksMarkdown = '';
      if (newsletterData.sourceLinks && newsletterData.sourceLinks.length > 0) {
        linksMarkdown = \`\\n\\n🔗 **Sumber Referensi:**\\n\` + newsletterData.sourceLinks.map(l => \`- [\${l}](\${l})\`).join('\\n');
      }

      // To render an image in Markdown, we use ![alt](url)
      // Since it's a chat, we can just send the image markdown + source links.
      const responseMarkdown = \`![GYS Steel Signal](\${result.fileUrl})\${linksMarkdown}\`;

      await new Chat({
        userId, botId, threadId, role: 'assistant', content: responseMarkdown,
        attachedFiles: [{ name: result.fileName, path: result.fileUrl, type: 'image' }],
      }).save();
      await Thread.findByIdAndUpdate(threadId, { lastMessageAt: new Date() });

      return {
        response: responseMarkdown, threadId,
        attachedFiles: [{ name: result.fileName, path: result.fileUrl, type: 'image' }],
      };
    } catch (error) {
      console.error('❌ [NEWSLETTER Command]', error);
      throw new Error(\`Gagal membuat newsletter: \${error.message}\`);
    }
  }
`;
  code = code.replace(
    /async _handleExcelCommand\(\{ userId, botId, bot, message, threadId, history = \[\], attachedFile \}\) \{/,
    match => handler + '\n' + match
  );
}

fs.writeFileSync('services/ai-core.service.js', code);
console.log('Newsletter patch complete.');
