import axios from 'axios';
import Bot from '../models/Bot.js';
import AIProviderService from './ai-provider.service.js';

export const startWahaScheduler = () => {
  console.log('⏳ WAHA Daily Scheduler started...');

  setInterval(async () => {
    try {
      const now = new Date();
      const currentHHMM = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');

      const bots = await Bot.find({
        'wahaConfig.enabled': true,
        'wahaConfig.dailySchedule.enabled': true,
        'wahaConfig.dailySchedule.time': currentHHMM
      });

      for (const bot of bots) {
        console.log(`⏰ Waktunya bot [${bot.name}] mengirim pesan harian ke WA!`);
        const config = bot.wahaConfig;
        const triggerMessage = config.dailySchedule.prompt || 'Give me what you got!';

        // 1. Generate AI Response
        // ✅ PERBAIKAN: Gunakan bot.prompt karena di situ instruksi "DAILY SNACK" Mas Najib berada
        const aiResponse = await AIProviderService.generateCompletion({
          providerConfig: bot.aiProvider,
          systemPrompt: bot.prompt || bot.systemPrompt,
          messages: [],
          userContent: triggerMessage,
          capabilities: bot.capabilities
        });

        const aiText = aiResponse.text || 'Maaf, AI tidak memberikan respon.';

        // 2. Format Pesan Sesuai Template Mas Najib
        // ✅ PERBAIKAN: Menambahkan header agar tampilan di WA rapi
        const formattedMessage =
          `🤖 *LOG CHAT BOT:* ${bot.name}\n` +
          `👤 *User:* system.scheduler\n\n` +
          `💬 *Pertanyaan:*\n${triggerMessage}\n\n` +
          `🤖 *Jawaban:*\n${aiText}`;

        const payload = {
          session: config.session || 'default',
          chatId: config.chatId,
          text: formattedMessage
        };

        const wahaHeaders = {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        };
        if (config.apiKey) wahaHeaders['X-Api-Key'] = config.apiKey;

        await axios.post(config.endpoint, payload, { headers: wahaHeaders });
        console.log(`✅ Pesan harian bot [${bot.name}] berhasil dikirim ke WA!`);
      }
    } catch (error) {
      console.error('❌ WAHA Scheduler Error:', error.message);
    }
  }, 60000);
};

