// server/services/waha.service.js
// Unified WAHA API client — kirim text, gambar, file, typing indicator
import axios from 'axios';

// ── Markdown → WhatsApp format converter ─────────────────────
// WA mendukung: *bold*, _italic_, ~strikethrough~, `code`, ```block```
export function markdownToWA(text = '') {
  return text
    // Hapus blok citation portal
    .replace(/<!--CITATIONS_START-->[\s\S]*?<!--CITATIONS_END-->/g, '')
    // Header → bold
    .replace(/^#{1,6}\s+(.+)$/gm, '*$1*')
    // Bold **text** → *text* (WA style)
    .replace(/\*\*(.+?)\*\*/gs, '*$1*')
    // Strikethrough
    .replace(/~~(.+?)~~/g, '~$1~')
    // Horizontal rule
    .replace(/^---+$/gm, '────────────────')
    // Tabel markdown → hapus separator, biarkan baris datanya
    .replace(/^\|[-: |]+\|$/gm, '')
    .replace(/^\|(.+)\|$/gm, (_, row) =>
      row.split('|').map(c => c.trim()).filter(Boolean).join(' │ ')
    )
    // Bullet point → •
    .replace(/^[ \t]*[-*]\s+/gm, '• ')
    // Numbered list tetap
    // Inline citation [1] → hapus
    .replace(/\[\d+\]/g, '')
    // Multiple blank lines → max 2
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── Split panjang message agar tidak melebihi batas WA (~4096 char) ──
export function chunkMessage(text, maxLen = 3800) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  const paragraphs = text.split(/\n\n+/);
  let current = '';
  for (const para of paragraphs) {
    if ((current + '\n\n' + para).length > maxLen && current) {
      chunks.push(current.trim());
      current = para;
    } else {
      current = current ? current + '\n\n' + para : para;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

class WahaService {
  constructor(wahaConfig) {
    if (!wahaConfig?.endpoint) throw new Error('WAHA endpoint tidak dikonfigurasi');

    // Derive base URL dari endpoint yang ada
    // Endpoint di DB bisa berupa: http://waha:3000/api/sendText atau http://waha:3000
    try {
      const u = new URL(wahaConfig.endpoint);
      this.baseUrl = `${u.protocol}//${u.host}`;
    } catch {
      this.baseUrl = wahaConfig.endpoint.replace(/\/api\/.*$/, '');
    }

    this.session = wahaConfig.session || 'default';
    this.apiKey  = wahaConfig.apiKey  || '';
  }

  headers() {
    const h = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (this.apiKey) h['X-Api-Key'] = this.apiKey;
    return h;
  }

  async post(path, body, timeoutMs = 12000) {
    return axios.post(`${this.baseUrl}${path}`, body, {
      headers: this.headers(),
      timeout: timeoutMs,
    });
  }

  // ── Kirim teks (otomatis split jika panjang) ──────────────
  async sendText(chatId, text) {
    const chunks = chunkMessage(markdownToWA(text));
    for (const chunk of chunks) {
      await this.post('/api/sendText', {
        session: this.session,
        chatId,
        text: chunk,
      });
      // Jeda kecil antar chunk
      if (chunks.length > 1) await new Promise(r => setTimeout(r, 400));
    }
  }

  // ── Kirim gambar (URL harus bisa diakses oleh WAHA server) ─
  async sendImage(chatId, imageUrl, caption = '') {
    await this.post('/api/sendImage', {
      session: this.session,
      chatId,
      file:    { url: imageUrl },
      caption: markdownToWA(caption),
    });
  }

  // ── Kirim file/dokumen ─────────────────────────────────────
  async sendFile(chatId, fileUrl, filename, caption = '') {
    await this.post('/api/sendFile', {
      session:  this.session,
      chatId,
      file:     { url: fileUrl },
      fileName: filename,
      caption:  markdownToWA(caption),
    });
  }

  // ── Typing indicator ──────────────────────────────────────
  async startTyping(chatId) {
    try {
      await this.post('/api/startTyping', { session: this.session, chatId });
    } catch {
      // Non-fatal — abaikan jika WAHA versi lama tidak support
    }
  }

  async stopTyping(chatId) {
    try {
      await this.post('/api/stopTyping', { session: this.session, chatId });
    } catch {}
  }

  // ── Download media dari WAHA ──────────────────────────────
  async downloadMedia(mediaUrl, mimeType = '') {
    const res = await axios.get(mediaUrl, {
      responseType: 'arraybuffer',
      headers:      this.headers(),
      timeout:      30000,
    });
    return {
      buffer:   Buffer.from(res.data),
      mimeType: mimeType || res.headers['content-type'] || 'application/octet-stream',
    };
  }
}

export default WahaService;

