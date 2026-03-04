import mongoose from 'mongoose';

// ── Knowledge File Sub-Schema ─────────────────────────────────
const knowledgeFileSchema = new mongoose.Schema({
  filename:     { type: String, required: true },
  originalName: { type: String, required: true },
  mimetype:     { type: String, required: true },
  size:         { type: Number, default: 0 },
  path:         { type: String, required: true },
  uploadedAt:   { type: Date, default: Date.now },
  // Extracted text content for RAG
  content:      { type: String, default: '' },
  // Summary for quick reference
  summary:      { type: String, default: '' },
}, { _id: true });

// ── AI Provider Config Sub-Schema ────────────────────────────
const aiProviderSchema = new mongoose.Schema({
  // Provider: 'openai' | 'anthropic' | 'google' | 'custom'
  provider:   { type: String, enum: ['openai', 'anthropic', 'google', 'custom'], default: 'openai' },
  // Model ID (e.g. 'gpt-4o', 'claude-opus-4-6', 'gemini-1.5-pro')
  model:      { type: String, default: 'gpt-4o' },
  // API Key override (leave empty to use server .env key)
  apiKey:     { type: String, default: '' },
  // Custom endpoint (for 'custom' provider or Azure OpenAI)
  endpoint:   { type: String, default: '' },
  // Generation parameters
  temperature:  { type: Number, default: 0.1 },
  maxTokens:    { type: Number, default: 2000 },
}, { _id: false });

// ── Main Bot Schema ───────────────────────────────────────────
const botSchema = new mongoose.Schema({
  name:        { type: String, required: true, unique: true },
  description: { type: String, default: '' },

  // ── Prompts ──────────────────────────────────────────────
  prompt:       { type: String, default: '' },        // Main/primary prompt
  systemPrompt: { type: String, default: 'Anda adalah asisten AI profesional.' }, // Fallback

  // ── Starter Questions ────────────────────────────────────
  starterQuestions: { type: [String], default: [] },

  // ── AI Provider Configuration ────────────────────────────
  aiProvider: { type: aiProviderSchema, default: () => ({}) },

  // ── Knowledge Base (RAG) ─────────────────────────────────
  knowledgeFiles: { type: [knowledgeFileSchema], default: [] },
  // How to use knowledge: 'always' | 'relevant' | 'disabled'
  knowledgeMode: {
    type: String,
    enum: ['always', 'relevant', 'disabled'],
    default: 'relevant'
  },

  // ── Avatar ───────────────────────────────────────────────
  avatar: {
    type:      { type: String, enum: ['image', 'emoji', 'icon'], default: 'emoji' },
    imageUrl:  { type: String, default: null },
    emoji:     { type: String, default: '🤖' },
    icon:      { type: String, default: null },
    bgColor:   { type: String, default: '#6366f1' },
    textColor: { type: String, default: '#ffffff' },
  },

  // ── Integrations ─────────────────────────────────────────
  smartsheetConfig: {
    enabled:        { type: Boolean, default: false },
    apiKey:         { type: String, default: '' },
    sheetId:        { type: String, default: '' },
    primarySheetId: { type: String, default: '' },
  },
  kouventaConfig: {
    enabled:  { type: Boolean, default: false },
    apiKey:   { type: String, default: '' },
    endpoint: { type: String, default: '' },
  },
  onedriveConfig: {
    enabled:      { type: Boolean, default: false },
    folderUrl:    { type: String, default: '' },
    tenantId:     { type: String, default: '' },
    clientId:     { type: String, default: '' },
    clientSecret: { type: String, default: '' },
  },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

botSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

export default mongoose.model('Bot', botSchema);