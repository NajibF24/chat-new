import mongoose from 'mongoose';

// ── Knowledge File Sub-Schema ─────────────────────────────────
const knowledgeFileSchema = new mongoose.Schema({
  filename:     { type: String, required: true },
  originalName: { type: String, required: true },
  mimetype:     { type: String, required: true },
  size:         { type: Number, default: 0 },
  path:         { type: String, required: true },
  uploadedAt:   { type: Date, default: Date.now },
  content:      { type: String, default: '' },
  summary:      { type: String, default: '' },
}, { _id: true });

// ── AI Provider Config Sub-Schema ────────────────────────────
const aiProviderSchema = new mongoose.Schema({
  provider:    { type: String, enum: ['openai', 'anthropic', 'google', 'custom'], default: 'openai' },
  model:       { type: String, default: 'gpt-4.1' },
  apiKey:      { type: String, default: '' },
  endpoint:    { type: String, default: '' },
  temperature: { type: Number, default: 0.1 },
  maxTokens:   { type: Number, default: 2000 },
}, { _id: false });

// ── Bot Capabilities Sub-Schema ───────────────────────────────
const capabilitiesSchema = new mongoose.Schema({
  webSearch:       { type: Boolean, default: false },
  codeInterpreter: { type: Boolean, default: false },
  imageGeneration: { type: Boolean, default: false },
  canvas:          { type: Boolean, default: false },
  fileSearch:      { type: Boolean, default: false },
}, { _id: false });

// ── Main Bot Schema ───────────────────────────────────────────
const botSchema = new mongoose.Schema({
  name:        { type: String, required: true, unique: true },
  description: { type: String, default: '' },

  // ✅ BARU: Siapa yang membuat bot ini
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },

  // Personality / tone / instructions
  persona:      { type: String, default: '' },
  tone:         { type: String, enum: ['professional', 'friendly', 'formal', 'concise', 'detailed', 'custom'], default: 'professional' },

  prompt:       { type: String, default: '' },
  systemPrompt: { type: String, default: 'Anda adalah asisten AI profesional.' },

  starterQuestions: { type: [String], default: [] },

  // ✅ API KEY — default kosong, tidak auto-generate
  botApiKey: { type: String, default: '' },

  // ── AI Provider ──────────────────────────────────────────
  aiProvider: { type: aiProviderSchema, default: () => ({}) },

  // ── Capabilities ─────────────────────────────────────────
  capabilities: { type: capabilitiesSchema, default: () => ({}) },

  // ── Knowledge Base (RAG) ─────────────────────────────────
  knowledgeFiles: { type: [knowledgeFileSchema], default: [] },
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
  wahaConfig: {
    enabled:  { type: Boolean, default: false },
    endpoint: { type: String, default: '' },
    chatId:   { type: String, default: '' },
    session:  { type: String, default: 'default' },
    apiKey:   { type: String, default: '' },
    dailySchedule: {
      enabled: { type: Boolean, default: false },
      time:    { type: String, default: '08:00' },
      prompt:  { type: String, default: 'Sapa user dengan selamat pagi dan berikan satu pertanyaan acak tentang kabar mereka hari ini.' },
    },
  },
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
  azureSearchConfig: {
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
