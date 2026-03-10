// server/routes/pptx.js
// ─────────────────────────────────────────────────────────────
// PPT Generation Route
// POST /api/pptx/generate  — generate PPTX from prompt
// GET  /api/pptx/styles    — list available styles
// ─────────────────────────────────────────────────────────────

import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import Bot from '../models/Bot.js';
import Thread from '../models/Thread.js';
import Chat from '../models/Chat.js';
import AIProviderService from '../services/ai-provider.service.js';
import PptxService from '../services/pptx.service.js';
import AuditService from '../services/audit.service.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const router = express.Router();

// ── GET /api/pptx/styles ─────────────────────────────────────
router.get('/styles', requireAuth, (req, res) => {
  res.json(PptxService.getStyleList());
});

// ── POST /api/pptx/generate ──────────────────────────────────
router.post('/generate', requireAuth, async (req, res) => {
  try {
    const { prompt, style = 'corporate', botId, threadId } = req.body;
    const userId = req.session.userId;

    if (!prompt) return res.status(400).json({ error: 'Prompt is required' });

    // ── Find bot for AI config ────────────────────────────────
    let bot = null;
    if (botId) {
      bot = await Bot.findById(botId).lean();
    }
    // Fallback: use any available bot
    if (!bot) {
      bot = await Bot.findOne({}).lean();
    }
    if (!bot) return res.status(400).json({ error: 'No bot configured' });

    const presentationTitle = prompt
      .replace(/^(buatkan|buat|create|generate|make|tolong|please)\s+/i, '')
      .replace(/\s+(presentation|presentasi|ppt|slide|powerpoint).*$/i, '')
      .trim()
      .substring(0, 60) || 'Presentation';

    // ── Build system prompt for slide generation ──────────────
    const systemPrompt = `You are an expert presentation writer. 
Generate professional slide content in the following exact format:

# [Presentation Title / Overview]
[One sentence subtitle or key message]

## [Slide 2 Title]
- bullet point 1
- bullet point 2
- bullet point 3
- bullet point 4

## [Slide 3 Title]
- bullet point 1
- bullet point 2
- bullet point 3

## [Slide 4 Title]
[Write 2-3 sentences of paragraph content here]

## [Slide 5 Title]
- bullet point 1
- bullet point 2
- bullet point 3

[Continue for all slides...]

Rules:
- First slide (# heading) = Title slide with subtitle
- Use ## for content slide titles  
- Mix bullets and paragraph slides for variety
- Each slide: 1 title + 3-5 bullets OR 2-3 sentences
- Keep bullet text concise (under 15 words each)
- Generate 6-10 content slides total
- Language: match the user's request language (Indonesian or English)
- DO NOT add style instructions, just content`;

    const userMessage = `Create a professional presentation about: ${prompt}`;

    // ── Call AI to generate slide content ─────────────────────
    console.log(`📊 [PPTX] Generating slides for: "${presentationTitle}" | Style: ${style}`);
    const aiResult = await AIProviderService.generateCompletion({
      providerConfig: bot.aiProvider || { provider: 'openai', model: 'gpt-4o' },
      systemPrompt,
      messages: [],
      userContent: userMessage,
    });

    const slideContent = aiResult.text;
    if (!slideContent) throw new Error('AI returned empty content');

    // ── Generate PPTX file ────────────────────────────────────
    const outputDir = path.join(process.cwd(), 'data', 'files');
    const result = await PptxService.generate(slideContent, style, presentationTitle, outputDir);

    // ── Build chat response markdown ─────────────────────────
    const styleName = PptxService.STYLES[style]?.name || style;
    const responseMarkdown = `✅ **Presentasi berhasil dibuat!**

📊 **${presentationTitle}**
🎨 Style: **${styleName}**
📑 Jumlah Slide: **${result.slideCount} slides**

---
**[⬇️ Download ${result.filename}](${result.url})**

> *Klik link di atas untuk mengunduh file PowerPoint (.pptx)*

---

**Preview konten yang dibuat:**

${slideContent.substring(0, 800)}${slideContent.length > 800 ? '\n\n*...dan lanjutan slide lainnya*' : ''}`;

    // ── Save to thread ─────────────────────────────────────────
    let targetThreadId = threadId;
    if (!targetThreadId) {
      const newThread = new Thread({
        userId, botId: bot._id,
        title: `PPT: ${presentationTitle.substring(0, 30)}`,
        lastMessageAt: new Date(),
      });
      await newThread.save();
      targetThreadId = newThread._id;
    }

    const userPromptMsg = `/ppt ${style} ${prompt}`;
    await new Chat({ userId, botId: bot._id, threadId: targetThreadId, role: 'user', content: userPromptMsg }).save();
    await new Chat({
      userId, botId: bot._id, threadId: targetThreadId, role: 'assistant',
      content: responseMarkdown,
      attachedFiles: [{
        name: result.filename,
        path: result.url,
        type: 'file',
        size: '0',
      }],
    }).save();

    await Thread.findByIdAndUpdate(targetThreadId, { lastMessageAt: new Date() });

    // ── Audit log ─────────────────────────────────────────────
    await AuditService.log({
      req,
      category: 'chat',
      action: 'PPTX_GENERATE',
      targetId: bot._id,
      targetName: bot.name,
      detail: { title: presentationTitle, style, slideCount: result.slideCount },
      username: req.session?.username,
    }).catch(() => {});

    res.json({
      response: responseMarkdown,
      threadId: targetThreadId,
      pptx: result,
      attachedFiles: [{
        name: result.filename,
        path: result.url,
        type: 'file',
        size: '0',
      }],
    });

  } catch (error) {
    console.error('❌ [PPTX] Generation error:', error);
    res.status(500).json({ error: `Failed to generate presentation: ${error.message}` });
  }
});

export default router;
