// server/routes/pptx.js
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { requireAuth } from '../middleware/auth.js';
import Bot from '../models/Bot.js';
import Thread from '../models/Thread.js';
import Chat from '../models/Chat.js';
import AIProviderService from '../services/ai-provider.service.js';
// Pastikan HTML_SLIDE_SYSTEM_PROMPT di-import dari pptx.service.js
import PptxService, { HTML_SLIDE_SYSTEM_PROMPT } from '../services/pptx.service.js';
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

    // ════════════════════════════════════════════════════════════
    // TAHAP 1: AI SEBAGAI KONSULTAN BISNIS (Menyusun Materi PPT)
    // ════════════════════════════════════════════════════════════
    const contentResult = await AIProviderService.generateCompletion({
      providerConfig: bot.aiProvider || { provider: 'openai', model: 'gpt-4o' },
      systemPrompt: `You are an elite Management Consultant and Executive Presentation Writer.
Your task is to structure a high-level, professional presentation based on the user's prompt. 
DO NOT just copy the user's prompt. Analyze the intent, expand it into a cohesive business narrative, and create highly engaging slides.

Generate slide content in markdown:
# [Hero Title]\n[Compelling Subtitle]\n\n
## [Slide 1 Title]\n- [Impactful bullet point]\n- [Impactful bullet point]\n\n
## [Slide 2 Title]\n[Short executive paragraph]\n

Requirements:
- Generate 6-9 slides with a clear storyline (Problem, Impact, Solution, Use Cases, Value, Conclusion).
- Include realistic placeholder data/numbers where relevant.
- Match the language to the user's request (e.g., if Indonesian, use professional corporate Indonesian).`,
      messages: [],
      userContent: `Buatkan kerangka presentasi yang sangat profesional dan meyakinkan tentang: ${prompt}`,
    });

    const slideContent = contentResult.text;
    if (!slideContent?.trim()) return res.status(500).json({ error: 'AI returned empty content' });

    // ════════════════════════════════════════════════════════════
    // TAHAP 2: AI SEBAGAI DESAINER (Menerjemahkan materi ke Desain HTML dengan proses <thinking>)
    // ════════════════════════════════════════════════════════════
    const designResult = await AIProviderService.generateCompletion({
      providerConfig: bot.aiProvider || { provider: 'openai', model: 'gpt-4o' },
      systemPrompt: HTML_SLIDE_SYSTEM_PROMPT,
      messages: [],
      userContent: PptxService.buildDesignPrompt({ slideContent, styleRequest: style, title, topic: prompt }),
    });

    // ════════════════════════════════════════════════════════════
    // TAHAP 3: PEMBERSIHAN (Hapus tag <thinking>) & CONVERT KE PPTX
    // ════════════════════════════════════════════════════════════
    // Hapus blok <thinking> AI agar tidak merusak format visual saat dirender ke Powerpoint
    let rawHtml = designResult.text.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').trim();
    rawHtml = rawHtml.replace(/^```html/i, '').replace(/```$/i, '').trim();

    const outputDir = path.join(process.cwd(), 'data', 'files');
    
    // Fungsi ini akan merender HTML jadi gambar, lalu dimasukkan ke dalam file .PPTX yang bisa di-download
    const result = await PptxService.generateFromAICode({
      aiCode: rawHtml, 
      fallbackContent: slideContent,
      title, 
      outputDir, 
      styleDesc: style,
    });

    // ════════════════════════════════════════════════════════════
    // TAHAP 4: BERIKAN RESPON & LINK DOWNLOAD KE CHAT
    // ════════════════════════════════════════════════════════════
    const responseMarkdown = `✅ **Presentasi berhasil dibuat dengan gaya profesional!**

📊 **Topik:** ${title}
🎨 **Style Tema:** ${style}
📑 **Jumlah:** ~${result.slideCount} slides ${result.usedFallback ? ' _(mode fallback)_' : ' (dengan visual & layout khusus)'}

---
### [⬇️ Download File Presentasi (.pptx)](${result.url})
*(Silakan klik link di atas untuk mengunduh presentasinya ke komputer Anda)*

---
💡 _Tip: AI telah menganalisis permintaan Anda dan menyusun struktur materinya (Masalah, Solusi, Dampak) layaknya konsultan bisnis profesional._`;

    // Save history to Database
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
