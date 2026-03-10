// server/routes/pptx.js
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

router.get('/styles', requireAuth, (req, res) => {
  res.json(PptxService.getStyleExamples());
});

router.post('/generate', requireAuth, async (req, res) => {
  try {
    const { prompt, style = 'professional corporate executive', botId, threadId } = req.body;
    const userId = req.session.userId;
    if (!prompt) return res.status(400).json({ error: 'Prompt is required' });

    let bot = botId ? await Bot.findById(botId).lean() : null;
    if (!bot) bot = await Bot.findOne({}).lean();
    if (!bot) return res.status(400).json({ error: 'No bot configured' });

    const title = prompt
      .replace(/^(buatkan|buat|create|generate|tolong|please)\s+/i, '')
      .replace(/\s+(presentasi|presentation|ppt|slide|powerpoint).*$/i, '')
      .replace(/\s+style\s+.*/i, '')
      .trim().substring(0, 60) || 'Presentation';

    // Step 1: Slide content
    const contentResult = await AIProviderService.generateCompletion({
      providerConfig: bot.aiProvider || { provider: 'openai', model: 'gpt-4o' },
      systemPrompt: `You are an expert presentation writer.
Generate slide content in markdown:
# [Title]\n[Subtitle]\n\n## [Slide Title]\n- bullet\n- bullet\n\n## [Slide Title]\n[paragraph]\n
- Generate 6-9 content slides
- Mix bullets and paragraphs
- Include realistic numbers/data where relevant for charts
- Match language to user request`,
      messages: [],
      userContent: `Create a professional presentation about: ${prompt}`,
    });

    const slideContent = contentResult.text;
    if (!slideContent?.trim()) return res.status(500).json({ error: 'AI returned empty content' });

    // Step 2: AI design code
    const designResult = await AIProviderService.generateCompletion({
      providerConfig: bot.aiProvider || { provider: 'openai', model: 'gpt-4o' },
      systemPrompt: 'You are a JavaScript developer. Return ONLY raw JavaScript. No markdown fences. No explanation.',
      messages: [],
      userContent: PptxService.buildDesignPrompt({ slideContent, styleRequest: style, title, topic: prompt }),
    });

    // Step 3: Execute → PPTX
    const outputDir = path.join(process.cwd(), 'data', 'files');
    const result = await PptxService.generateFromAICode({
      aiCode: designResult.text, fallbackContent: slideContent,
      title, outputDir, styleDesc: style,
    });

    const styleList = PptxService.getStyleExamples().slice(0,6).map(s => `• \`${s.example}\``).join('\n');

    const responseMarkdown = `✅ **Presentation created!**

📊 **${title}**
🎨 Style: **${style}**
📑 ~${result.slideCount} slides${result.usedFallback ? ' _(fallback renderer)_' : ' with charts, photos & infographics'}

---
### [⬇️ Download: ${result.filename}](${result.url})

---
💡 **Try other styles:**
${styleList}`;

    let targetThreadId = threadId;
    if (!targetThreadId) {
      const t = new Thread({ userId, botId: bot._id, title: `PPT: ${title.substring(0,30)}`, lastMessageAt: new Date() });
      await t.save();
      targetThreadId = t._id;
    }
    await new Chat({ userId, botId: bot._id, threadId: targetThreadId, role: 'user', content: prompt }).save();
    await new Chat({ userId, botId: bot._id, threadId: targetThreadId, role: 'assistant', content: responseMarkdown,
      attachedFiles: [{ name: result.filename, path: result.url, type: 'file', size: '0' }],
    }).save();
    await Thread.findByIdAndUpdate(targetThreadId, { lastMessageAt: new Date() });
    await AuditService.log({ req, category:'chat', action:'PPTX_GENERATE', targetId:bot._id, targetName:bot.name,
      detail:{ title, style, usedFallback:result.usedFallback }, username: req.session?.username }).catch(()=>{});

    res.json({ response: responseMarkdown, threadId: targetThreadId, pptx: result,
      attachedFiles: [{ name: result.filename, path: result.url, type: 'file', size: '0' }] });

  } catch (error) {
    console.error('❌ [PPTX Route]', error);
    res.status(500).json({ error: `Failed: ${error.message}` });
  }
});

export default router;