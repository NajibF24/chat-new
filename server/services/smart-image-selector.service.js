// server/services/smart-image-selector.service.js
// ============================================================
// Smart Image Selector untuk PPT Generation
//
// Cara kerja:
//   1. Terima semua gambar yang tersedia dari dokumen
//   2. Gunakan AI untuk menganalisis relevansi setiap gambar
//      berdasarkan:
//      - Nama file gambar
//      - Caption / deskripsi
//      - Ukuran file (gambar terlalu kecil = dekorasi, skip)
//      - Konteks slide yang akan dibuat
//   3. Return hanya gambar yang benar-benar relevan (max sesuai kebutuhan)
//
// Fallback: jika AI gagal, gunakan simple scoring berbasis keyword
// ============================================================

import fs from 'fs';

// Min file size untuk dianggap "konten" bukan dekorasi (bytes)
const MIN_IMAGE_SIZE_BYTES = 15 * 1024; // 15 KB

// Max gambar yang diijinkan di PPT (hindari slide jadi photo album)
const MAX_IMAGES_FOR_PPT = 6;

// ─────────────────────────────────────────────────────────────
// Simple keyword-based scoring (fallback jika AI tidak tersedia)
// ─────────────────────────────────────────────────────────────
function simpleScoreImage(image, slideContent = '', userMessage = '') {
  const context = (slideContent + ' ' + userMessage).toLowerCase();
  const imgName = (image.filename || image.caption || '').toLowerCase();

  let score = 0;

  // Gambar sangat kecil → kemungkinan ikon/dekorasi
  if (image.fileSize && image.fileSize < MIN_IMAGE_SIZE_BYTES) return -1;

  // Kata kunci yang menunjukkan gambar informatif
  const informaticKeywords = [
    'chart', 'graph', 'diagram', 'table', 'figure', 'foto', 'photo',
    'gambar', 'ilustrasi', 'image', 'logo', 'screenshot', 'data',
    'struktur', 'alur', 'flow', 'architecture', 'arsitektur',
  ];
  informaticKeywords.forEach(kw => {
    if (imgName.includes(kw)) score += 3;
    if (context.includes(kw)) score += 1;
  });

  // Gambar berindeks rendah (gambar pertama dalam dokumen lebih penting)
  if (image.index !== undefined) {
    score += Math.max(0, 5 - image.index);
  }

  // Gambar dari PPTX source lebih relevan (sudah di-layout dengan baik)
  if (image.filename?.includes('pptx_')) score += 2;

  // Gambar dari DOCX biasanya konten artikel
  if (image.filename?.includes('docx_')) score += 1;

  return score;
}

// ─────────────────────────────────────────────────────────────
// Filter gambar yang valid di disk + cukup besar
// ─────────────────────────────────────────────────────────────
function filterValidImages(images) {
  return images.filter(img => {
    // Harus ada path dan exist di disk
    if (!img.path || !fs.existsSync(img.path)) return false;

    // Cek ukuran file
    try {
      const stat = fs.statSync(img.path);
      img.fileSize = stat.size; // attach fileSize untuk scoring
      return stat.size >= MIN_IMAGE_SIZE_BYTES;
    } catch {
      return false;
    }
  });
}

// ─────────────────────────────────────────────────────────────
// ✅ MAIN: AI-Powered Smart Image Selection
//
// @param {Array}  images       - Semua gambar yang tersedia
// @param {string} userRequest  - Permintaan user (topik PPT)
// @param {string} slideContent - Markdown slide content yang sudah di-generate AI
// @param {object} aiProvider   - AI provider config untuk analisis
// @param {number} maxImages    - Batas maksimal gambar
// @returns {Array}             - Gambar yang terpilih, sudah diurutkan by relevance
// ─────────────────────────────────────────────────────────────
async function selectRelevantImages(images, userRequest, slideContent, aiProvider, maxImages = MAX_IMAGES_FOR_PPT) {
  if (!images || images.length === 0) return [];

  // Step 1: Filter gambar yang valid (ada di disk + ukuran cukup)
  const validImages = filterValidImages(images);
  console.log(`[SmartImageSelector] ${images.length} total → ${validImages.length} valid (size filter)`);

  if (validImages.length === 0) return [];

  // Jika gambar sedikit (≤ maxImages), return semua tanpa perlu seleksi ketat
  if (validImages.length <= maxImages) {
    console.log(`[SmartImageSelector] ≤${maxImages} images, returning all ${validImages.length}`);
    return validImages;
  }

  // Step 2: Coba AI-powered selection
  try {
    const selected = await aiPoweredSelection(validImages, userRequest, slideContent, aiProvider, maxImages);
    if (selected && selected.length > 0) {
      console.log(`[SmartImageSelector] AI selected ${selected.length} images`);
      return selected;
    }
  } catch (err) {
    console.warn('[SmartImageSelector] AI selection failed, falling back to keyword scoring:', err.message);
  }

  // Step 3: Fallback — simple keyword scoring
  return keywordBasedSelection(validImages, userRequest, slideContent, maxImages);
}

// ─────────────────────────────────────────────────────────────
// AI-powered selection: kirim daftar gambar ke AI, minta dia pilih
// ─────────────────────────────────────────────────────────────
async function aiPoweredSelection(images, userRequest, slideContent, aiProvider, maxImages) {
  // Import AI provider (lazy, avoid circular dependency)
  const { default: AIProviderService } = await import('./ai-provider.service.js');

  // Buat daftar gambar untuk AI
  const imageList = images.map((img, i) => {
    const sizeKB = img.fileSize ? Math.round(img.fileSize / 1024) : '?';
    return `[${i}] filename="${img.filename || 'unknown'}" caption="${img.caption || ''}" source="${img.sourceFile || ''}" size=${sizeKB}KB`;
  }).join('\n');

  // Ekstrak judul slide dari slideContent untuk konteks
  const slideTitles = (slideContent || '')
    .split('\n')
    .filter(l => l.startsWith('## '))
    .map(l => l.replace('## ', '').trim())
    .slice(0, 10)
    .join(', ');

  const systemPrompt = `You are an expert presentation designer. Your job is to select which images from a document should be included in a PowerPoint presentation.

RULES:
1. Only select images that add VALUE to the presentation (charts, diagrams, photos of products/processes, screenshots, figures).
2. SKIP decorative images (logos repeated many times, small icons, background graphics, borders).
3. SKIP images that are clearly not informative (abstract shapes, color blocks, decorative elements).
4. Prefer images that are clearly referenced by the slide content.
5. Select at most ${maxImages} images.
6. Return ONLY a JSON array of indices like: [0, 2, 5] or [] if none are relevant.
7. No explanation, just the JSON array.`;

  const userContent = `Presentation topic: "${userRequest}"

Slide titles to be created: ${slideTitles || '(general presentation)'}

Available images from the document:
${imageList}

Which image indices should be included? Return JSON array of indices only.`;

  const result = await AIProviderService.generateCompletion({
    providerConfig: aiProvider || { provider: 'openai', model: 'gpt-4o-mini' },
    systemPrompt,
    messages: [],
    userContent,
  });

  const responseText = result.text || '';

  // Parse JSON array dari response
  const jsonMatch = responseText.match(/\[[\d,\s]*\]/);
  if (!jsonMatch) {
    console.warn('[SmartImageSelector] Could not parse AI response:', responseText.substring(0, 200));
    return null;
  }

  const selectedIndices = JSON.parse(jsonMatch[0]);
  if (!Array.isArray(selectedIndices)) return null;

  // Return gambar yang dipilih, dalam urutan yang diberikan AI
  return selectedIndices
    .filter(i => i >= 0 && i < images.length)
    .map(i => images[i]);
}

// ─────────────────────────────────────────────────────────────
// Fallback: keyword-based scoring
// ─────────────────────────────────────────────────────────────
function keywordBasedSelection(images, userRequest, slideContent, maxImages) {
  const context = slideContent + ' ' + userRequest;

  const scored = images.map(img => ({
    image: img,
    score: simpleScoreImage(img, context, userRequest),
  }));

  // Filter yang score > 0, sort descending
  const relevant = scored
    .filter(s => s.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxImages)
    .map(s => s.image);

  console.log(`[SmartImageSelector] Keyword scoring selected ${relevant.length} images`);
  return relevant;
}

// ─────────────────────────────────────────────────────────────
// Export
// ─────────────────────────────────────────────────────────────
export {
  selectRelevantImages,
  filterValidImages,
  simpleScoreImage,
  MIN_IMAGE_SIZE_BYTES,
  MAX_IMAGES_FOR_PPT,
};

export default { selectRelevantImages };

