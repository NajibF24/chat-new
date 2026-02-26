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

  // ✅ AVATAR CONFIG
  avatar: {
    type: {
      type: String,
      enum: ['image', 'emoji', 'icon'],
      default: 'emoji'
    },
    imageUrl:  { type: String, default: null },   // path gambar upload
    emoji:     { type: String, default: '🤖' },   // karakter emoji
    icon:      { type: String, default: null },    // SVG string
    bgColor:   { type: String, default: '#6366f1' },
    textColor: { type: String, default: '#ffffff' },
  },

  // ✅ KONFIGURASI SMARTSHEET
  smartsheetConfig: {
    enabled:       { type: Boolean, default: false },
    apiKey:        { type: String,  default: '' },
    sheetId:       { type: String,  default: '' },
    primarySheetId:{ type: String,  default: '' },
  },

  // ✅ KONFIGURASI KOUVENTA
  kouventaConfig: {
    enabled:  { type: Boolean, default: false },
    apiKey:   { type: String,  default: '' },
    endpoint: { type: String,  default: '' }
  },

  createdAt: { type: Date, default: Date.now }
});

export default mongoose.model('Bot', botSchema);