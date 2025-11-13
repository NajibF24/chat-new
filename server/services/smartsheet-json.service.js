import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class SmartsheetJSONService {
  constructor() {
    this.apiKey = process.env.SMARTSHEET_API_KEY;
    this.baseURL = 'https://api.smartsheet.com/2.0';
    this.dataDir = path.join(__dirname, '..', 'data');
    this.cacheFile = path.join(this.dataDir, 'smartsheet-data.json');
    this.cacheMaxAge = 5 * 60 * 1000; // 5 minutes
    
    this.client = axios.create({
      baseURL: this.baseURL,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });
  }

  async ensureDataDir() {
    try {
      await fs.mkdir(this.dataDir, { recursive: true });
    } catch (error) {
      console.error('Error creating data directory:', error);
    }
  }

  /**
   * Fetch sheet from Smartsheet API and save to JSON
   */
  async fetchAndCacheSheet(sheetId) {
    try {
      console.log('');
      console.log('='.repeat(70));
      console.log('📊 FETCHING SMARTSHEET DATA');
      console.log('='.repeat(70));
      console.log(`🆔 Sheet ID: ${sheetId}`);
      console.log(`⏰ Time: ${new Date().toLocaleString('id-ID')}`);
      console.log('');

      // Fetch from API with CORRECT level parameter (max is 2)
      console.log('📡 Calling Smartsheet API...');
      const response = await this.client.get(`/sheets/${sheetId}`, {
        params: {
          include: 'attachments,discussions',
          level: 2
        }
      });

      const sheet = response.data;
      console.log('✅ API Response received');
      console.log(`   Sheet Name: ${sheet.name}`);
      console.log(`   Total Rows: ${sheet.rows?.length || 0}`);
      console.log(`   Total Columns: ${sheet.columns?.length || 0}`);

      // Process data
      console.log('');
      console.log('🔄 Processing data...');
      const processed = this.processSheetData(sheet);

      // Save to JSON
      await this.ensureDataDir();
      await fs.writeFile(
        this.cacheFile, 
        JSON.stringify(processed, null, 2),
        'utf-8'
      );

      console.log('✅ Data saved to JSON');
      console.log(`   File: ${this.cacheFile}`);
      console.log(`   Size: ${(JSON.stringify(processed).length / 1024).toFixed(2)} KB`);
      console.log('='.repeat(70));
      console.log('');

      return processed;
    } catch (error) {
      console.error('');
      console.error('❌ FETCH ERROR');
      console.error('='.repeat(70));
      console.error('Error:', error.message);
      if (error.response) {
        console.error('Status:', error.response.status);
        console.error('Data:', JSON.stringify(error.response.data, null, 2));
      }
      console.error('='.repeat(70));
      console.error('');
      throw error;
    }
  }

  /**
   * Process raw sheet data into structured format
   */
  processSheetData(sheet) {
    const processed = {
      metadata: {
        id: sheet.id,
        name: sheet.name,
        permalink: sheet.permalink,
        createdAt: sheet.createdAt,
        modifiedAt: sheet.modifiedAt,
        owner: sheet.owner?.name || 'Unknown',
        totalRows: sheet.rows?.length || 0,
        totalColumns: sheet.columns?.length || 0,
        fetchedAt: new Date().toISOString()
      },
      columns: [],
      projects: []
    };

    // Process columns
    if (sheet.columns) {
      processed.columns = sheet.columns.map(col => ({
        id: col.id,
        title: col.title,
        type: col.type,
        primary: col.primary || false,
        index: col.index
      }));
    }

    // Process rows as projects
    if (sheet.rows && sheet.columns) {
      processed.projects = sheet.rows.map(row => {
        const project = {
          rowNumber: row.rowNumber,
          rowId: row.id,
          parentId: row.parentId || null,
          expanded: row.expanded || false,
          data: {}
        };

        // Map cells to column names
        row.cells.forEach((cell, cellIndex) => {
          const column = sheet.columns.find(c => c.id === cell.columnId);
          if (column) {
            const cellData = {
              value: cell.displayValue || cell.value || null,
              formula: cell.formula || null
            };

            // Handle special types
            if (cell.hyperlink) {
              cellData.hyperlink = cell.hyperlink;
            }
            if (cell.image) {
              cellData.hasImage = true;
            }

            project.data[column.title] = cellData;
          }
        });

        return project;
      });
    }

    // Add statistics
    processed.statistics = this.calculateStatistics(processed);

    return processed;
  }

  /**
   * Calculate statistics from processed data
   */
  calculateStatistics(processed) {
    const stats = {
      totalProjects: processed.projects.length,
      columnBreakdown: {},
      statusSummary: {},
      completionRate: '0%'
    };

    // Count non-empty values per column
    processed.columns.forEach(col => {
      const nonEmptyCount = processed.projects.filter(
        p => p.data[col.title]?.value
      ).length;
      stats.columnBreakdown[col.title] = {
        total: processed.projects.length,
        filled: nonEmptyCount,
        empty: processed.projects.length - nonEmptyCount,
        fillRate: ((nonEmptyCount / processed.projects.length) * 100).toFixed(1) + '%'
      };
    });

    // Find status column and calculate summary
    const statusColumn = processed.columns.find(col => 
      col.title.toLowerCase().includes('status') ||
      col.title.toLowerCase().includes('progress')
    );

    if (statusColumn) {
      processed.projects.forEach(project => {
        const status = project.data[statusColumn.title]?.value || 'Unknown';
        stats.statusSummary[status] = (stats.statusSummary[status] || 0) + 1;
      });

      // Calculate completion rate
      const completedStatuses = Object.keys(stats.statusSummary).filter(status =>
        status.toLowerCase().includes('complete') ||
        status.toLowerCase().includes('done') ||
        status.toLowerCase().includes('finish') ||
        status.toLowerCase().includes('selesai')
      );

      const completedCount = completedStatuses.reduce(
        (sum, status) => sum + stats.statusSummary[status], 
        0
      );

      stats.completionRate = ((completedCount / stats.totalProjects) * 100).toFixed(1) + '%';
    }

    return stats;
  }

  /**
   * Read data from JSON cache
   */
  async readFromCache() {
    try {
      const data = await fs.readFile(this.cacheFile, 'utf-8');
      const parsed = JSON.parse(data);
      
      console.log('📖 Reading from cache');
      console.log(`   Last fetched: ${new Date(parsed.metadata.fetchedAt).toLocaleString('id-ID')}`);
      console.log(`   Projects: ${parsed.projects.length}`);
      
      return parsed;
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.log('⚠️  Cache file not found');
        return null;
      }
      throw error;
    }
  }

  /**
   * Get data (from cache or fetch if needed)
   */
  async getData(sheetId, forceRefresh = false) {
    if (!forceRefresh) {
      const cached = await this.readFromCache();
      if (cached) {
        const age = Date.now() - new Date(cached.metadata.fetchedAt).getTime();

        if (age < this.cacheMaxAge) {
          console.log(`✅ Using cache (age: ${Math.floor(age / 1000)}s)`);
          return cached;
        } else {
          console.log(`⚠️  Cache expired (age: ${Math.floor(age / 1000)}s)`);
        }
      }
    }

    // Fetch fresh data
    console.log('🔄 Fetching fresh data...');
    return await this.fetchAndCacheSheet(sheetId);
  }

  /**
   * ✅ IMPROVED: Format data for AI context - Better organization
   */
  formatForAI(data) {
    let context = `# PROJECT DATA SUMMARY\n\n`;
    
    // Metadata
    context += `**Sheet Name:** ${data.metadata.name}\n`;
    context += `**Last Updated:** ${new Date(data.metadata.modifiedAt).toLocaleString('id-ID')}\n`;
    context += `**Owner:** ${data.metadata.owner}\n`;
    context += `**Total Projects:** ${data.statistics.totalProjects}\n`;
    context += `**Completion Rate:** ${data.statistics.completionRate}\n\n`;

    // Status breakdown
    if (Object.keys(data.statistics.statusSummary).length > 0) {
      context += `**Status Distribution:**\n`;
      Object.entries(data.statistics.statusSummary)
        .sort((a, b) => b[1] - a[1])
        .forEach(([status, count]) => {
          const percentage = ((count / data.statistics.totalProjects) * 100).toFixed(1);
          context += `• ${status}: ${count} projects (${percentage}%)\n`;
        });
      context += `\n`;
    }

    // Available columns
    context += `**Available Data Fields:**\n`;
    data.columns.forEach(col => {
      context += `• ${col.title} (${col.type})\n`;
    });
    context += `\n`;

    // Project data - organized for easy parsing
    context += `# COMPLETE PROJECT DATA (${data.projects.length} projects)\n\n`;
    
    data.projects.forEach((project, idx) => {
      context += `## PROJECT ${idx + 1} (Row ${project.rowNumber})\n`;
      
      // Group related fields for better organization
      const basicInfo = {};
      const statusInfo = {};
      const dateInfo = {};
      const budgetInfo = {};
      const detailInfo = {};
      
      Object.entries(project.data).forEach(([colName, cellData]) => {
        if (!cellData.value) return;
        
        const lowerCol = colName.toLowerCase();
        
        // Categorize fields
        if (lowerCol.includes('id') || lowerCol.includes('name') || 
            lowerCol.includes('division') || lowerCol.includes('department') ||
            lowerCol.includes('classification') || lowerCol.includes('manager') ||
            lowerCol.includes('owner')) {
          basicInfo[colName] = cellData.value;
        } else if (lowerCol.includes('status') || lowerCol.includes('progress') ||
                   lowerCol.includes('risk') || lowerCol.includes('at risk')) {
          statusInfo[colName] = cellData.value;
        } else if (lowerCol.includes('date') || lowerCol.includes('start') ||
                   lowerCol.includes('end') || lowerCol.includes('modified') ||
                   lowerCol.includes('target') || lowerCol.includes('deadline')) {
          dateInfo[colName] = cellData.value;
        } else if (lowerCol.includes('budget') || lowerCol.includes('afe') ||
                   lowerCol.includes('cost') || lowerCol.includes('price')) {
          budgetInfo[colName] = cellData.value;
        } else {
          detailInfo[colName] = cellData.value;
        }
      });
      
      // Output organized data
      if (Object.keys(basicInfo).length > 0) {
        context += `**BASIC INFO:**\n`;
        Object.entries(basicInfo).forEach(([key, val]) => {
          context += `• ${key}: ${val}\n`;
        });
      }
      
      if (Object.keys(statusInfo).length > 0) {
        context += `**STATUS & PROGRESS:**\n`;
        Object.entries(statusInfo).forEach(([key, val]) => {
          context += `• ${key}: ${val}\n`;
        });
      }
      
      if (Object.keys(dateInfo).length > 0) {
        context += `**TIMELINE:**\n`;
        Object.entries(dateInfo).forEach(([key, val]) => {
          context += `• ${key}: ${val}\n`;
        });
      }
      
      if (Object.keys(budgetInfo).length > 0) {
        context += `**BUDGET:**\n`;
        Object.entries(budgetInfo).forEach(([key, val]) => {
          context += `• ${key}: ${val}\n`;
        });
      }
      
      if (Object.keys(detailInfo).length > 0) {
        context += `**DETAILS:**\n`;
        Object.entries(detailInfo).forEach(([key, val]) => {
          let value = val;
          // Truncate long values to prevent token overflow
          if (typeof value === 'string' && value.length > 200) {
            value = value.substring(0, 200) + '...';
          }
          context += `• ${key}: ${value}\n`;
        });
      }
      
      context += `\n`;
    });

    // Add link
    context += `\n---\n`;
    context += `**View Full Sheet:** ${data.metadata.permalink}\n`;

    return context;
  }

  /**
   * Get cache info
   */
  async getCacheInfo() {
    try {
      const cached = await this.readFromCache();
      if (!cached) {
        return {
          exists: false,
          message: 'No cache available'
        };
      }

      const age = Date.now() - new Date(cached.metadata.fetchedAt).getTime();
      
      return {
        exists: true,
        fetchedAt: cached.metadata.fetchedAt,
        ageSeconds: Math.floor(age / 1000),
        ageMinutes: Math.floor(age / 60000),
        sheetName: cached.metadata.name,
        totalProjects: cached.projects.length,
        isExpired: age > this.cacheMaxAge
      };
    } catch (error) {
      return {
        exists: false,
        error: error.message
      };
    }
  }
}

export default SmartsheetJSONService;
