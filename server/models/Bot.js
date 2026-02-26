import mongoose from 'mongoose';

const botSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  description: String,

  // Prompt Utama (Prioritas)
  prompt: { type: String, default: "" },

  // Fallback Prompt (Backward Compatibility)
  systemPrompt: { type: String, default: "Anda adalah asisten AI profesional." },

  // Starter Questions
  starterQuestions: { type: [String], default: [] },

  // ✅ KONFIGURASI SMARTSHEET
  smartsheetConfig: {
    enabled: { type: Boolean, default: false },
    apiKey: { type: String, default: '' }, // Opsional (jika ingin override ENV)
    sheetId: { type: String, default: '' }, // ✅ INI FIELD KUNCI (Target Sheet ID)
    primarySheetId: { type: String, default: '' }, // Field cadangan
  },

  // ✅ KONFIGURASI KOUVENTA
  kouventaConfig: {
    enabled: { type: Boolean, default: false },
    apiKey: { type: String, default: '' },
    endpoint: { type: String, default: '' }
  },

  createdAt: { type: Date, default: Date.now }
});

export default mongoose.model('Bot', botSchema);
