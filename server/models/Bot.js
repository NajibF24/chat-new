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
  // ── NEW: store extracted images from Word/PPT documents ──
  extractedImages: [{ 
    filename: String,   // saved image filename
    path:     String,   // server path
    url:      String,   // /api/files/... URL
    mimeType: String,   // image/png, image/jpeg etc
    index:    Number,   // position in document
    caption:  String,   // AI-generated caption
  }],
}, { _id: true });

// ── AI Provider Config Sub-Schema ────────────────────────────
const aiProviderSchema = new mongoose.Schema({
  provider:    { type: String, enum: ['openai', 'anthropic', 'google', 'custom'], default: 'openai' },
  model:       { type: String, default: 'gpt-4.1' },
  apiKey:      { type: String, default: '' },
  endpoint:    { type: String, default: '' },
  temperature: { type: Number, default: 0.1 },
  maxTokens:   { type: Number, default: 8000 }, // ✅ UPDATED: default 8000
}, { _id: false });

// ── Bot Capabilities Sub-Schema ───────────────────────────────
const capabilitiesSchema = new mongoose.Schema({
  webSearch:       { type: Boolean, default: false },
  codeInterpreter: { type: Boolean, default: false },
  imageGeneration: { type: Boolean, default: false },
  canvas:          { type: Boolean, default: false },
  fileSearch:      { type: Boolean, default: false },
}, { _id: false });

// ── WAHA Target Sub-Schema (NEW: multiple targets) ────────────
const wahaTargetSchema = new mongoose.Schema({
  chatId:   { type: String, required: true },  // 628xxxx@c.us or 12036xxxx@g.us
  label:    { type: String, default: '' },     // user-friendly label e.g. "HR Group"
  type:     { type: String, enum: ['private', 'group'], default: 'private' },
  tagOnly:  { type: Boolean, default: false }, // group only: only reply when tagged
  active:   { type: Boolean, default: true },
}, { _id: true });

// ── WAHA Schedule Item Sub-Schema (NEW: flexible scheduling) ──
const wahaScheduleSchema = new mongoose.Schema({
  label:     { type: String, default: '' },         // e.g. "Morning Report"
  prompt:    { type: String, default: '' },         // trigger prompt for AI
  active:    { type: Boolean, default: true },
  
  // Schedule type: 'daily' | 'interval' | 'multiple'
  scheduleType: { 
    type: String, 
    enum: ['daily', 'interval', 'multiple'], 
    default: 'daily' 
  },

  // For 'daily': single time e.g. "08:00"
  time:      { type: String, default: '08:00' },

  // For 'multiple': array of times e.g. ["08:00", "12:00", "17:00"]
  times:     { type: [String], default: [] },

  // For 'interval': repeat every N minutes
  intervalMinutes: { type: Number, default: 60 },
  intervalStart:   { type: String, default: '08:00' }, // start of active window
  intervalEnd:     { type: String, default: '17:00' }, // end of active window

  // Which targets to send to (if empty → send to all active targets)
  targetIds: { type: [String], default: [] },
}, { _id: true });

// ── Main Bot Schema ───────────────────────────────────────────
const botSchema = new mongoose.Schema({
  name:        { type: String, required: true, unique: true },
  description: { type: String, default: '' },

  // ✅ Who created this bot
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

  // ✅ API KEY
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

  // ── PPT Template ─────────────────────────────────────────
  // Store reference to an uploaded .pptx file in knowledgeFiles to use as template
  pptTemplateFileId: { type: String, default: null }, // knowledgeFile._id

  // ── Avatar ───────────────────────────────────────────────
  avatar: {
    type:      { type: String, enum: ['image', 'emoji', 'icon'], default: 'emoji' },
    imageUrl:  { type: String, default: null },
    emoji:     { type: String, default: '🤖' },
    icon:      { type: String, default: null },
    bgColor:   { type: String, default: '#6366f1' },
    textColor: { type: String, default: '#ffffff' },
  },

  // ── WAHA WhatsApp Integration (UPDATED: full rewrite) ────
  wahaConfig: {
    enabled:   { type: Boolean, default: false },
    endpoint:  { type: String, default: '' },     // WAHA server base URL e.g. http://localhost:3000
    session:   { type: String, default: 'default' },
    apiKey:    { type: String, default: '' },

    // Webhook config (for receiving messages FROM WhatsApp)
    webhookEnabled: { type: Boolean, default: false },
    webhookSecret:  { type: String, default: '' },  // optional secret to verify webhook calls
    botPhoneNumber: { type: String, default: '' },  // bot's own WhatsApp number (for tag detection)

    // Multiple targets (NEW)
    targets: { type: [wahaTargetSchema], default: [] },

    // Flexible schedules (NEW)
    schedules: { type: [wahaScheduleSchema], default: [] },

    // Legacy fields kept for backward compat
    chatId:         { type: String, default: '' },
    dailySchedule: {
      enabled: { type: Boolean, default: false },
      time:    { type: String, default: '08:00' },
      prompt:  { type: String, default: '' },
    },
  },

  // ── Other Integrations ───────────────────────────────────
  smartsheetConfig:  {
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
