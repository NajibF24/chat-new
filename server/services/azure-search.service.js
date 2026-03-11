import axios from 'axios';

// server/services/azure-search.service.js
// Azure AI Search RAG service for GYS chatbot portal
// Supports: gys-annual-chatbot-index-* and scrapi-report-index

class AzureSearchService {
  constructor(apiKey, endpoint) {
    // endpoint format: https://ai-search-gys.search.windows.net/indexes/INDEX-NAME-HERE
    this.apiKey = apiKey;
    this.endpoint = endpoint ? endpoint.replace(/\/$/, '') : '';

    // Parse base URL and index name from endpoint
    const match = this.endpoint.match(/^(https:\/\/[^/]+)\/indexes\/(.+)$/);
    if (match) {
      this.baseUrl = match[1];
      this.indexName = match[2];
    } else {
      this.baseUrl = this.endpoint;
      this.indexName = null;
    }
  }

  isConfigured() {
    return !!(this.apiKey && this.baseUrl && this.indexName);
  }

  getIndexType() {
    if (!this.indexName) return 'unknown';
    if (this.indexName.includes('scrapi')) return 'scrapi';
    if (this.indexName.includes('summary')) return 'summary';
    return 'annual';
  }

  /**
   * Search Azure AI Search index and return formatted context string
   * @param {string} userMessage - The user's question
   * @param {number} top - Number of results to retrieve (default 5)
   * @returns {string|null} Formatted context for OpenAI prompt, or null if no results
   */
  async generateResponse(userMessage, top = 5) {
    if (!this.isConfigured()) {
      throw new Error('Azure Search not properly configured. Endpoint must include index name, e.g.: https://ai-search-gys.search.windows.net/indexes/gys-annual-chatbot-index-production-multilingual');
    }

    const searchUrl = `${this.baseUrl}/indexes/${this.indexName}/docs/search?api-version=2023-11-01`;

    const payload = {
      search: userMessage,
      top,
      queryType: 'simple',
      searchMode: 'any',
      select: this._getSelectFields(),
    };

    const response = await fetch(searchUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': this.apiKey,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Azure Search error ${response.status}: ${errText}`);
    }

    const data = await response.json();
    const results = data.value || [];

    if (results.length === 0) {
      return null; // No results — let OpenAI answer from its own knowledge
    }

    return this._formatContext(results);
  }

  _getSelectFields() {
    const type = this.getIndexType();
    if (type === 'scrapi') {
      return 'id,record_type,record_date,record_datetime,content,raw_json';
    }
    // annual and summary indexes
    return 'id,tag,file_id,file_name,content';
  }

  _formatContext(results) {
    const type = this.getIndexType();
    if (type === 'scrapi') return this._formatScrapiContext(results);
    return this._formatAnnualContext(results);
  }

  _formatAnnualContext(results) {
    const lines = ['The following are relevant excerpts from GYS documents:\n'];

    results.forEach((doc, i) => {
      const fileName = doc.file_name || 'Unknown Document';
      const tag = doc.tag || '';
      const content = doc.content || '';

      lines.push(`--- Document ${i + 1} ---`);
      if (tag) lines.push(`Category: ${tag}`);
      lines.push(`File: ${fileName}`);
      if (content) lines.push(`Content:\n${content.substring(0, 1500)}`);
      lines.push('');
    });

    lines.push("Based on the above documents, please answer the user's question.");
    return lines.join('\n');
  }

  _formatScrapiContext(results) {
    const lines = ['The following are relevant SCRAPI report records:\n'];

    results.forEach((doc, i) => {
      const recordType = doc.record_type || 'Unknown';
      const recordDate = doc.record_date || doc.record_datetime || '';
      const content = doc.content || '';
      const rawJson = doc.raw_json || null;

      lines.push(`--- Record ${i + 1} ---`);
      lines.push(`Type: ${recordType}`);
      if (recordDate) lines.push(`Date: ${recordDate}`);
      if (content) lines.push(`Content:\n${content.substring(0, 1500)}`);

      if (rawJson) {
        try {
          const parsed = JSON.parse(rawJson);
          const extras = Object.entries(parsed)
            .filter(([k]) => !['id', 'content', 'content_vector'].includes(k))
            .slice(0, 10)
            .map(([k, v]) => `  ${k}: ${v}`)
            .join('\n');
          if (extras) lines.push(`Data:\n${extras}`);
        } catch {
          // ignore parse errors
        }
      }
      lines.push('');
    });

    lines.push("Based on the above records, please answer the user's question.");
    return lines.join('\n');
  }
}

//module.exports = AzureSearchService;

export default AzureSearchService;
