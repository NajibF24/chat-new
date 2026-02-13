import OpenAI from 'openai';
import fs from 'fs-extra';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

// Inisialisasi OpenAI dengan API Key dari .env
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const generateImage = async (prompt) => {
  try {
    console.log(`🎨 Generating image with DALL-E 3 for: "${prompt}"...`);

    // Request ke OpenAI DALL-E 3
    const response = await openai.images.generate({
      model: "dall-e-3",
      prompt: prompt,
      n: 1,
      size: "1024x1024",
      response_format: "b64_json", // Minta format Base64 agar bisa disimpan lokal
      style: "vivid", // Pilihan: "vivid" (lebih artistik) atau "natural"
    });

    const base64Image = response.data[0].b64_json;

    if (!base64Image) {
      throw new Error("No image data returned from OpenAI");
    }

    // --- PROSES PENYIMPANAN FILE (Sama seperti sebelumnya) ---
    
    // Nama file unik
    const fileName = `dalle-${uuidv4()}.png`;
    
    // Path folder: server/data/files/generated
    const uploadDir = path.join(process.cwd(), 'data', 'files', 'generated');
    
    // Pastikan folder ada
    await fs.ensureDir(uploadDir);
    
    // Simpan file fisik
    const filePath = path.join(uploadDir, fileName);
    await fs.writeFile(filePath, base64Image, 'base64');

    console.log(`✅ Image saved: ${fileName}`);

    // Return URL lokal yang bisa diakses Frontend
    return `/api/files/generated/${fileName}`;

  } catch (error) {
    console.error("❌ DALL-E Error:", error);
    // Tampilkan pesan error yang lebih user-friendly
    throw new Error("Gagal membuat gambar: " + (error.message || "OpenAI Error"));
  }
};
