import mongoose from 'mongoose';

const botSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true
  },
  description: String,

  // ✅ FIELD PENTING (Baru): Untuk menyimpan Custom Prompt dari Dashboard Admin
  // Ini yang akan diprioritaskan oleh AICoreService agar tidak "tabrakan"
  prompt: { 
    type: String, 
    default: "" 
  },

  // Field lama (tetap kita simpan untuk backward compatibility)
  systemPrompt: {
    type: String,
    default: "Anda adalah asisten AI profesional yang siap membantu."
  },

  // ✅ FITUR ANDA: Starter Questions (Tetap Ada)
  starterQuestions: {
    type: [String],
    default: [] 
  },

  // ✅ CONFIG SMARTSHEET (Disesuaikan agar kompatibel dengan Service)
  smartsheetConfig: {
    enabled: { type: Boolean, default: false },
    apiKey: { type: String, default: '' }, 
    sheetId: { type: String, default: '' }, // Service akan membaca ini
    primarySheetId: { type: String }, // Cadangan jika script lain pakai nama ini
  },

  // ✅ KOUVENTA CONFIG (Tetap Ada)
  kouventaConfig: {
    enabled: { type: Boolean, default: false },
    apiKey: { type: String, default: '' },
    endpoint: { type: String, default: '' }
  },

  createdAt: {
    type: Date,
    default: Date.now
  }
});

export default mongoose.model('Bot', botSchema);