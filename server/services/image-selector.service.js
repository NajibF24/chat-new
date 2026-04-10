// server/services/image-selector.service.js
// ============================================================
// Selects the most relevant images from an extracted image set
// to place into PPT slides.
//
// Strategy:
//   1. Build a list of all available images with their captions
//   2. Ask the AI to decide which image (if any) belongs on
//      which slide, with a brief caption to show on the slide
//   3. Return { slideIndex, imagePath, caption, mimeType }[]
//
// Rules enforced:
//   - Max 2 images total per presentation (keeps it professional)
//   - Only place an image when it genuinely adds value
//   - Never place images on TITLE, CLOSING, or SECTION slides
//   - Prefer CONTENT slides with room for a visual
// ============================================================

import AIProviderService from './ai-provider.service.js';
import fs from 'fs';

const IMAGE_SELECTION_SYSTEM_PROMPT = `You are a professional presentation designer.
Your job is to decide which images (if any) from a document should appear in a presentation.

Rules:
- Maximum 2 images total in the whole presentation
- Only place images on CONTENT, GRID, or STATS slides — never TITLE, CLOSING, SECTION, QUOTE
- Only select an image when it GENUINELY adds value (a chart, diagram, product photo, process illustration)
- Skip decorative/background images — only pick informative visuals
- Write a short, descriptive caption (max 10 words) for each selected image

Output ONLY valid JSON in this exact format (no markdown, no explanation):
{
  "selections": [
    {
      "imageIndex": 0,
      "slideIndex": 2,
      "caption": "Short descriptive caption here"
    }
  ]
}

If no images should be used, return: { "selections": [] }
`;

/**
 * Select relevant images from extracted images to place in slides.
 *
 * @param {object[]} slides        - Array of slide data objects from AI
 * @param {object[]} availableImages - [{ path, caption, mimeType, index }]
 * @param {object}   providerConfig  - AI provider config from bot
 *
 * @returns {object[]} [{ slideIndex, imagePath, caption, mimeType }]
 */
async function selectImagesForSlides(slides, availableImages, providerConfig) {
  // Filter to only images that actually exist on disk
  const validImages = availableImages.filter(img =>
    img.path && fs.existsSync(img.path)
  );

  if (!validImages.length) return [];
  if (!slides?.length)     return [];

  // Only content slides are eligible
  const ELIGIBLE_LAYOUTS = ['CONTENT', 'GRID', 'STATS', 'TIMELINE', 'TWO_COLUMN'];
  const eligibleSlides = slides
    .map((s, i) => ({ ...s, originalIndex: i }))
    .filter(s => ELIGIBLE_LAYOUTS.includes((s.layout || 'CONTENT').toUpperCase()));

  if (!eligibleSlides.length) return [];

  // Build the prompt describing slides and available images
  const slideDescriptions = eligibleSlides.map((s, i) =>
    `Slide index ${s.originalIndex} (${s.layout || 'CONTENT'}): "${s.title || 'Untitled'}"`
  ).join('\n');

  const imageDescriptions = validImages.map((img, i) =>
    `Image ${i}: ${img.caption || img.filename || `image_${i}`}`
  ).join('\n');

  const userPrompt =
    `SLIDES:\n${slideDescriptions}\n\n` +
    `AVAILABLE IMAGES (${validImages.length} total):\n${imageDescriptions}\n\n` +
    `Which images should go on which slides? Remember: max 2 images, informative only.`;

  try {
    const result = await AIProviderService.generateCompletion({
      providerConfig,
      systemPrompt: IMAGE_SELECTION_SYSTEM_PROMPT,
      messages:     [],
      userContent:  userPrompt,
    });

    // Parse AI response
    let raw = (result.text || '').replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
    const jsonStart = raw.indexOf('{');
    const jsonEnd   = raw.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd === -1) return [];

    raw = raw.substring(jsonStart, jsonEnd + 1);
    const parsed = JSON.parse(raw);

    const selections = (parsed.selections || []).slice(0, 2); // hard cap at 2

    // Map back to actual image paths
    return selections
      .map(sel => {
        const img = validImages[sel.imageIndex];
        if (!img) return null;
        return {
          slideIndex: sel.slideIndex,
          imagePath:  img.path,
          caption:    sel.caption || img.caption || '',
          mimeType:   img.mimeType || 'image/png',
        };
      })
      .filter(Boolean);

  } catch (err) {
    console.warn('[ImageSelector] AI selection failed, using no images:', err.message);
    return [];
  }
}

export default { selectImagesForSlides };
