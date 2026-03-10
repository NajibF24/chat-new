// server/routes/pptx.js
// POST /api/pptx/generate  — AI designs + generates PPTX
// GET  /api/pptx/styles    — list style inspirations

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { requireAuth } from '../middleware/auth.js';
import Bot from '../models/Bot.js';
import Thread from '../models/Thread.js';
import Chat from '../models/Chat.js';
import AIProviderService from '../services/ai-provider.service.js';
import PptxService from '../services/pptx.service.js';
import AuditService from '../services/audit.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// ── GET /api/pptx/styles ─────────────────────────────────────
router.get('/styles', requireAuth, (req, res) => {
  res.json(PptxService.getStyleExamples());
});

// ── POST /api/pptx/generate ──────────────────────────────────
router.post('/generate', requireAuth, async (req, res) => {
  try {
    const { prompt, style = 'professional corporate', botId, threadId } = req.body;
    const userId = req.session.userId;

    if (!prompt) return res.status(400).json({ error: 'Prompt is required' });

    // Find bot for AI config
    let bot = botId ? await Bot.findById(botId).lean() : null;
    if (!bot) bot = await Bot.findOne({}).lean();
    if (!bot) return res.status(400).json({ error: 'No bot configured' });

    const title = prompt
      .replace(/^(buatkan|buat|create|generate|tolong|please)\s+/i, '')
      .replace(/\s+(presentasi|presentation|ppt|slide|powerpoint).*$/i, '')
      .replace(/\s+style\s+.*/i, '')
      .trim()
      .substring(0, 60) || 'Presentation';

    // ── STEP 1: Generate slide content via AI ────────────────
    console.log(`📊 [PPTX Route] Generating content for: "${title}" | Style: ${style}`);

    const contentResult = await AIProviderService.generateCompletion({
      providerConfig: bot.aiProvider || { provider: 'openai', model: 'gpt-4o' },
      systemPrompt: `You are an expert presentation writer.
Generate professional slide content in this exact format (markdown):

# [Presentation Title]
[One powerful subtitle sentence]

## [Slide Title]
- bullet point (max 12 words)
- bullet point
- bullet point
- bullet point

## [Slide Title]
[2-3 sentences of paragraph content for this slide]

## [Slide Title]
- bullet 1
- bullet 2
- bullet 3

Rules:
- First # heading = title slide (with subtitle below it)
- Use ## for content slides
- Mix bullet slides and paragraph slides for variety
- Generate 6-9 content slides total
- Write in the same language as the user's request
- Keep content professional and concise`,
      messages: [],
      userContent: `Create a professional presentation about: ${prompt}`,
    });

    const slideContent = contentResult.text;
    if (!slideContent?.trim()) {
      return res.status(500).json({ error: 'AI returned empty slide content' });
    }

    // ── STEP 2: AI designs the full PptxGenJS code ───────────
    console.log(`🎨 [PPTX Route] Requesting AI design code...`);

    const designPrompt = PptxService.buildDesignPrompt({
      slideContent,
      styleRequest: style,
      title,
    });

    const designResult = await AIProviderService.generateCompletion({
      providerConfig: bot.aiProvider || { provider: 'openai', model: 'gpt-4o' },
      systemPrompt: 'You are a JavaScript developer. Return ONLY raw JavaScript code. No markdown, no explanation.',
      messages: [],
      userContent: designPrompt,
    });

    const aiCode = designResult.text;

    // ── STEP 3: Execute code → write PPTX file ───────────────
    const outputDir = path.join(process.cwd(), 'data', 'files');
    const result = await PptxService.generateFromAICode({
      aiCode,
      fallbackContent: slideContent,
      title,
      outputDir,
      styleDesc: style,
    });

    // ── Build chat response ───────────────────────────────────
    const styleExamples = PptxService.getStyleExamples()
      .slice(0, 6)
      .map(s => `• ${s.example}`)
      .join('\n');

    const responseMarkdown = `✅ **Presentation created successfully!**

📊 **${title}**
🎨 Style: **${style}**
📑 ~${result.slideCount} slides${result.usedFallback ? ' *(used safe fallback renderer)*' : ''}

---
### [⬇️ Download: ${result.filename}](${result.url})
*Click the link above to download your PowerPoint (.pptx) file*

---
💡 **Try these style prompts next time:**
${styleExamples}

You can describe any style freely — the AI will design accordingly.`;

    // ── Save to thread ─────────────────────────────────────────
    let targetThreadId = threadId;
    if (!targetThreadId) {
      const t = new Thread({ userId, botId: bot._id, title: `PPT: ${title.substring(0, 30)}`, lastMessageAt: new Date() });
      await t.save();
      targetThreadId = t._id;
    }

    await new Chat({ userId, botId: bot._id, threadId: targetThreadId, role: 'user', content: req.body.rawMessage || prompt }).save();
    await new Chat({
      userId, botId: bot._id, threadId: targetThreadId, role: 'assistant',
      content: responseMarkdown,
      attachedFiles: [{ name: result.filename, path: result.url, type: 'file', size: '0' }],
    }).save();
    await Thread.findByIdAndUpdate(targetThreadId, { lastMessageAt: new Date() });

    await AuditService.log({
      req,
      category: 'chat',
      action: 'PPTX_GENERATE',
      targetId: bot._id,
      targetName: bot.name,
      detail: { title, style, usedFallback: result.usedFallback },
      username: req.session?.username,
    }).catch(() => {});

    res.json({
      response: responseMarkdown,
      threadId: targetThreadId,
      pptx: result,
      attachedFiles: [{ name: result.filename, path: result.url, type: 'file', size: '0' }],
    });

  } catch (error) {
    console.error('❌ [PPTX Route] Error:', error);
    res.status(500).json({ error: `Failed to generate presentation: ${error.message}` });
  }
});

export default router;