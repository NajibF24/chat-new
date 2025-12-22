import axios from 'axios';

class KouventaService {
  constructor(apiKey, endpoint) {
    this.apiKey = apiKey;
    this.endpoint = endpoint; // URL lengkap (misal: .../run/.../test_ray)
  }

  async generateResponse(userMessage) {
    try {
      console.log(`📡 Sending to Kouventa: ${this.endpoint}`);
      
      // ✅ LOGIC POSTMAN-STYLE
      // Format Body: { "message": "teks panjang...", "files": {} }
      const payload = {
        message: userMessage, // Ini bisa berisi teks PDF panjang
        files: {} // Kosong sesuai screenshot
      };

      // ✅ CONFIG HEADER
      const config = {
        headers: {
          'Content-Type': 'application/json'
        }
      };

      // Jika ada API Key di settingan, masukkan ke Header Authorization juga
      if (this.apiKey) {
         config.headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      // ✅ TEMBAK API
      const response = await axios.post(this.endpoint, payload, config);

      // ✅ AMBIL JAWABAN
      // Kouventa mengembalikan JSON, kita cari field pesannya
      const data = response.data;
      
      // Prioritas pengambilan data (sesuaikan jika struktur berubah)
      const reply = data.message || data.result || data.output || data.text || (typeof data === 'string' ? data : "No text response.");

      return reply;

    } catch (error) {
      console.error('❌ Kouventa Error:', error.response?.data || error.message);
      
      if (error.response?.status === 404) return "Error 404: URL Endpoint salah.";
      if (error.response?.status === 401) return "Error 401: API Key salah/expired.";
      
      return `Maaf, terjadi kesalahan koneksi Kouventa. (${error.message})`;
    }
  }
}

export default KouventaService;
