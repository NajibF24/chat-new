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
  webSearch:       { type: Boolean, default: false },  // Browse internet
  codeInterpreter: { type: Boolean, default: false },  // Run Python code
  imageGeneration: { type: Boolean, default: false },  // DALL-E image gen
  canvas:          { type: Boolean, default: false },  // Canvas / document editing mode
  fileSearch:      { type: Boolean, default: false },  // Vector search over files
}, { _id: false });

// ── Main Bot Schema ───────────────────────────────────────────
const botSchema = new mongoose.Schema({
  name:        { type: String, required: true, unique: true },
  description: { type: String, default: '' },

  // Personality / tone / instructions
  persona:      { type: String, default: '' },   // Short persona tag line e.g. "Helpful HR expert"
  tone:         { type: String, enum: ['professional', 'friendly', 'formal', 'concise', 'detailed', 'custom'], default: 'professional' },

  prompt:       { type: String, default: '' },
  systemPrompt: { type: String, default: 'Anda adalah asisten AI profesional.' },

  starterQuestions: { type: [String], default: [] },

  // ── AI Provider ──────────────────────────────────────────
  aiProvider: { type: aiProviderSchema, default: () => ({}) },

  // ── Capabilities (ChatGPT-style toggles) ─────────────────
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
    apiKey:   { type: String,  default: '' },
    endpoint: { type: String,  default: '' },
    // Contoh endpoint lengkap:
    // https://ai-search-gys.search.windows.net/indexes/NAMA-INDEX/docs/search?api-version=2023-11-01
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
