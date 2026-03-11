import axios from 'axios';

class AzureSearchService {
  constructor(apiKey, endpoint) {
    this.apiKey = apiKey;
    this.endpoint = endpoint; // URL lengkap (misal: https://ai-search-gys.search.windows.net/indexes/YOUR-INDEX/docs/search?api-version=2023-11-01)
  }

  async generateResponse(userMessage) {
    try {
      console.log(`📡 Sending to Azure AI Search: ${this.endpoint}`);

      // ✅ LOGIC POSTMAN-STYLE
      // Format Body: { "search": "query", "top": 5 }
      const payload = {
        search: userMessage,
        top: 5,              // Ambil 5 dokumen paling relevan
        queryType: 'simple', // Ganti ke 'semantic' jika semantic ranker aktif di Azure
        searchMode: 'any',
      };

      // ✅ CONFIG HEADER
      // Azure Search pakai header 'api-key' (bukan Bearer)
      const config = {
        headers: {
          'Content-Type': 'application/json',
          'api-key': this.apiKey,
        }
      };

      // ✅ TEMBAK API
      const response = await axios.post(this.endpoint, payload, config);

      // ✅ AMBIL JAWABAN
      const data = response.data;

      if (!data.value || data.value.length === 0) {
        return 'Tidak ditemukan dokumen relevan di Azure AI Search.';
      }

      // Gabungkan hasil pencarian jadi satu blok teks konteks
      // Azure Search mengembalikan array 'value' berisi dokumen
      const results = data.value.map((doc, i) => {
        // Coba ambil field umum — sesuaikan dengan schema index Anda
        const content =
          doc.content        ||
          doc.chunk          ||
          doc.text           ||
          doc.merged_content ||
          doc.description    ||
          JSON.stringify(doc);

        const title =
          doc.title          ||
          doc.name           ||
          doc.filename       ||
          doc.metadata_storage_name ||
          `Result ${i + 1}`;

        return `[${i + 1}] ${title}\n${String(content).substring(0, 1500)}`;
      });

      const reply = results.join('\n\n---\n\n');
      return reply;

    } catch (error) {
      console.error('❌ Azure Search Error:', error.response?.data || error.message);

      if (error.response?.status === 404) return 'Error 404: URL Endpoint atau nama index salah.';
      if (error.response?.status === 401) return 'Error 401: API Key salah/expired.';
      if (error.response?.status === 403) return 'Error 403: API Key tidak punya akses ke index ini.';

      return `Maaf, terjadi kesalahan koneksi Azure AI Search. (${error.message})`;
    }
  }
}

export default AzureSearchService;
