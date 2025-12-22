import mongoose from 'mongoose';

const botSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true
  },
  description: String,
  
  // Prompt default (dipakai jika Kouventa OFF)
  systemPrompt: {
    type: String,
    default: "Anda adalah asisten AI profesional yang siap membantu."
  },

// ✅ NEW: Daftar pertanyaan pemicu (Starter Chips)
  starterQuestions: {
    type: [String],
    default: [] 
  },

  smartsheetConfig: {
    enabled: { type: Boolean, default: false },
    apiKey: { type: String, default: '' }, 
    sheetId: { type: String, default: '' } 
  },

  // ✅ KOUVENTA CONFIG (API KEY ONLY)
  kouventaConfig: {
    enabled: { type: Boolean, default: false },
    apiKey: { type: String, default: '' }, // Simpan API Key disini
    endpoint: { type: String, default: '' } // Endpoint Runner Kouventa
  },

  createdAt: {
    type: Date,
    default: Date.now
  }
});

export default mongoose.model('Bot', botSchema);
