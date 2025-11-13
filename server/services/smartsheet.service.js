import axios from 'axios';

class SmartsheetService {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseURL = 'https://api.smartsheet.com/2.0';
    this.client = axios.create({
      baseURL: this.baseURL,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });
  }

  // ==================== USER INFO ====================
  async getUserInfo() {
    try {
      const response = await this.client.get('/users/me');
      return response.data;
    } catch (error) {
      throw new Error(`Failed to get user info: ${error.message}`);
    }
  }

  // ==================== SHEETS ====================
  
  // List all sheets
  async listSheets() {
    try {
      const response = await this.client.get('/sheets', {
        params: { includeAll: true }
      });
      return response.data.data || [];
    } catch (error) {
      throw new Error(`Failed to list sheets: ${error.message}`);
    }
  }

  // Get complete sheet details with ALL data
  async getSheetComplete(sheetId) {
    try {
      const response = await this.client.get(`/sheets/${sheetId}`, {
        params: {
          include: 'attachments,discussions,format,filters,ownerInfo',
          level: 3 // Maximum detail level
        }
      });
      return response.data;
    } catch (error) {
      throw new Error(`Failed to get sheet ${sheetId}: ${error.message}`);
    }
  }

  // Get sheet with formatted data
  async getSheetDetails(sheetIdOrName) {
    try {
      let sheet;
      
      // If name, search first
      if (isNaN(sheetIdOrName)) {
        const sheets = await this.listSheets();
        const found = sheets.find(s => 
          s.name.toLowerCase().includes(sheetIdOrName.toLowerCase())
        );
        if (!found) throw new Error(`Sheet "${sheetIdOrName}" not found`);
        sheet = await this.getSheetComplete(found.id);
      } else {
        sheet = await this.getSheetComplete(sheetIdOrName);
      }

      // Format data
      const formatted = {
        id: sheet.id,
        name: sheet.name,
        permalink: sheet.permalink,
        createdAt: sheet.createdAt,
        modifiedAt: sheet.modifiedAt,
        owner: sheet.owner?.name || 'Unknown',
        totalRows: sheet.totalRowCount || sheet.rows?.length || 0,
        totalColumns: sheet.columns?.length || 0,
        columns: [],
        rows: [],
        attachments: sheet.attachments?.length || 0,
        discussions: sheet.discussions?.length || 0,
        filters: sheet.filters?.length || 0
      };

      // Process columns
      if (sheet.columns) {
        formatted.columns = sheet.columns.map(col => ({
          id: col.id,
          title: col.title,
          type: col.type,
          primary: col.primary || false,
          width: col.width,
          options: col.options || null
        }));
      }

      // Process rows with actual data
      if (sheet.rows) {
        formatted.rows = sheet.rows.map(row => {
          const rowData = {
            rowNumber: row.rowNumber,
            id: row.id,
            parentId: row.parentId,
            expanded: row.expanded,
            cells: {}
          };

          row.cells.forEach(cell => {
            const column = formatted.columns.find(c => c.id === cell.columnId);
            if (column) {
              rowData.cells[column.title] = {
                value: cell.displayValue || cell.value || '',
                formula: cell.formula || null,
                hyperlink: cell.hyperlink || null,
                image: cell.image || null
              };
            }
          });

          return rowData;
        });
      }

      // Process attachments
      if (sheet.attachments) {
        formatted.attachmentsList = sheet.attachments.map(att => ({
          id: att.id,
          name: att.name,
          attachmentType: att.attachmentType,
          mimeType: att.mimeType,
          sizeInKb: att.sizeInKb,
          createdAt: att.createdAt,
          url: att.url
        }));
      }

      // Process discussions
      if (sheet.discussions) {
        formatted.discussionsList = sheet.discussions.map(disc => ({
          id: disc.id,
          title: disc.title,
          commentCount: disc.commentCount,
          lastCommentedAt: disc.lastCommentedAt,
          createdBy: disc.createdBy?.name || 'Unknown'
        }));
      }

      return formatted;
    } catch (error) {
      throw new Error(`Failed to get sheet details: ${error.message}`);
    }
  }

  // Format sheet for AI
  formatSheetForAI(sheetDetails) {
    let text = `# 📋 Sheet: ${sheetDetails.name}\n\n`;
    text += `**Last Modified:** ${new Date(sheetDetails.modifiedAt).toLocaleString('id-ID')}\n`;
    text += `**Owner:** ${sheetDetails.owner}\n`;
    text += `**Total Rows:** ${sheetDetails.totalRows}\n`;
    text += `**Total Columns:** ${sheetDetails.totalColumns}\n`;
    text += `**Attachments:** ${sheetDetails.attachments}\n`;
    text += `**Discussions:** ${sheetDetails.discussions}\n`;
    text += `**Link:** [Open Sheet](${sheetDetails.permalink})\n\n`;

    // Columns
    text += `## 📊 Columns (${sheetDetails.columns.length})\n\n`;
    sheetDetails.columns.forEach((col, idx) => {
      text += `${idx + 1}. **${col.title}** (${col.type})${col.primary ? ' [PRIMARY]' : ''}\n`;
    });
    text += `\n`;

    // Sample data
    if (sheetDetails.rows.length > 0) {
      const sampleCount = Math.min(10, sheetDetails.rows.length);
      text += `## 📝 Data (showing ${sampleCount} of ${sheetDetails.totalRows} rows)\n\n`;
      
      sheetDetails.rows.slice(0, sampleCount).forEach((row, idx) => {
        text += `### Row ${row.rowNumber}\n`;
        Object.entries(row.cells).forEach(([colName, cellData]) => {
          if (cellData.value) {
            text += `- **${colName}:** ${cellData.value}\n`;
          }
        });
        text += `\n`;
      });
    }

    // Attachments
    if (sheetDetails.attachmentsList && sheetDetails.attachmentsList.length > 0) {
      text += `## 📎 Attachments (${sheetDetails.attachmentsList.length})\n\n`;
      sheetDetails.attachmentsList.forEach((att, idx) => {
        text += `${idx + 1}. **${att.name}** (${att.mimeType}, ${att.sizeInKb} KB)\n`;
      });
      text += `\n`;
    }

    return text;
  }

  // ==================== WORKSPACES ====================
  
  async listWorkspaces() {
    try {
      const response = await this.client.get('/workspaces');
      return response.data.data || [];
    } catch (error) {
      throw new Error(`Failed to list workspaces: ${error.message}`);
    }
  }

  async getWorkspaceDetails(workspaceIdOrName) {
    try {
      let workspace;
      
      if (isNaN(workspaceIdOrName)) {
        const workspaces = await this.listWorkspaces();
        const found = workspaces.find(w => 
          w.name.toLowerCase().includes(workspaceIdOrName.toLowerCase())
        );
        if (!found) throw new Error(`Workspace "${workspaceIdOrName}" not found`);
        workspace = await this.client.get(`/workspaces/${found.id}`).then(r => r.data);
      } else {
        workspace = await this.client.get(`/workspaces/${workspaceIdOrName}`).then(r => r.data);
      }

      return {
        id: workspace.id,
        name: workspace.name,
        permalink: workspace.permalink,
        sheets: workspace.sheets?.map(s => ({
          id: s.id,
          name: s.name,
          permalink: s.permalink
        })) || [],
        folders: workspace.folders?.map(f => ({
          id: f.id,
          name: f.name,
          permalink: f.permalink
        })) || []
      };
    } catch (error) {
      throw new Error(`Failed to get workspace details: ${error.message}`);
    }
  }

  formatWorkspaceForAI(workspaceDetails) {
    let text = `# 📁 Workspace: ${workspaceDetails.name}\n\n`;
    text += `**Link:** [Open Workspace](${workspaceDetails.permalink})\n\n`;
    
    if (workspaceDetails.sheets.length > 0) {
      text += `## 📋 Sheets (${workspaceDetails.sheets.length})\n\n`;
      workspaceDetails.sheets.forEach((sheet, idx) => {
        text += `${idx + 1}. [${sheet.name}](${sheet.permalink})\n`;
      });
      text += `\n`;
    }

    if (workspaceDetails.folders.length > 0) {
      text += `## 📂 Folders (${workspaceDetails.folders.length})\n\n`;
      workspaceDetails.folders.forEach((folder, idx) => {
        text += `${idx + 1}. ${folder.name}\n`;
      });
      text += `\n`;
    }

    return text;
  }

  // ==================== DASHBOARDS (SIGHTS) ====================
  
  async listSights() {
    try {
      const response = await this.client.get('/sights');
      return response.data.data || [];
    } catch (error) {
      throw new Error(`Failed to list dashboards: ${error.message}`);
    }
  }

  async getDashboardDetails(dashboardIdOrName) {
    try {
      let dashboard;
      
      if (isNaN(dashboardIdOrName)) {
        const dashboards = await this.listSights();
        const found = dashboards.find(d => 
          d.name.toLowerCase().includes(dashboardIdOrName.toLowerCase())
        );
        if (!found) throw new Error(`Dashboard "${dashboardIdOrName}" not found`);
        dashboard = await this.client.get(`/sights/${found.id}`).then(r => r.data);
      } else {
        dashboard = await this.client.get(`/sights/${dashboardIdOrName}`).then(r => r.data);
      }

      const formatted = {
        id: dashboard.id,
        name: dashboard.name,
        description: dashboard.description || 'No description',
        permalink: dashboard.permalink,
        createdAt: dashboard.createdAt,
        modifiedAt: dashboard.modifiedAt,
        totalWidgets: dashboard.widgets?.length || 0,
        widgets: []
      };

      // Process widgets
      if (dashboard.widgets) {
        for (const widget of dashboard.widgets) {
          const widgetInfo = {
            id: widget.id,
            type: widget.type,
            title: widget.title || 'Untitled',
            position: { x: widget.xPosition, y: widget.yPosition },
            size: { width: widget.width, height: widget.height }
          };

          // Extract content based on type
          switch (widget.type) {
            case 'TITLE':
              widgetInfo.content = widget.contents?.title || '';
              break;

            case 'RICHTEXT':
              widgetInfo.content = widget.contents?.html?.replace(/<[^>]*>/g, '') || '';
              break;

            case 'IMAGE':
              widgetInfo.imageInfo = {
                fileName: widget.contents?.fileName || 'No filename',
                format: widget.contents?.format || 'Unknown'
              };
              break;

            case 'METRIC':
              widgetInfo.metric = {
                label: widget.contents?.label,
                value: widget.contents?.cellData?.[0]?.displayValue || 'N/A'
              };
              break;

            case 'CHART':
              widgetInfo.chart = {
                type: widget.contents?.chartType || 'Unknown'
              };
              break;

            case 'SHEETSUMMARY':
              if (widget.contents?.sheetId) {
                try {
                  const sheetSummary = await this.getSheetSummaryForWidget(widget.contents.sheetId);
                  widgetInfo.sheetSummary = sheetSummary;
                } catch (err) {
                  widgetInfo.sheetSummary = { error: err.message };
                }
              }
              break;

            case 'WEBCONTENT':
              widgetInfo.webContent = { url: widget.contents?.url || 'No URL' };
              break;
          }

          formatted.widgets.push(widgetInfo);
        }
      }

      return formatted;
    } catch (error) {
      throw new Error(`Failed to get dashboard details: ${error.message}`);
    }
  }

  async getSheetSummaryForWidget(sheetId) {
    try {
      const sheet = await this.getSheetComplete(sheetId);
      
      const summary = {
        sheetName: sheet.name,
        totalRows: sheet.rows?.length || 0,
        columns: sheet.columns?.map(c => c.title) || [],
        recentData: []
      };

      if (sheet.rows && sheet.rows.length > 0) {
        const recent = sheet.rows.slice(0, 5);
        recent.forEach(row => {
          const rowData = {};
          row.cells.forEach((cell, idx) => {
            const column = sheet.columns?.[idx];
            if (column && (cell.displayValue || cell.value)) {
              rowData[column.title] = cell.displayValue || cell.value;
            }
          });
          summary.recentData.push(rowData);
        });
      }

      return summary;
    } catch (error) {
      return { error: error.message };
    }
  }

  formatDashboardForAI(dashboardDetails) {
    let text = `# 📊 Dashboard: ${dashboardDetails.name}\n\n`;
    
    if (dashboardDetails.description) {
      text += `**Description:** ${dashboardDetails.description}\n\n`;
    }
    
    text += `**Last Updated:** ${new Date(dashboardDetails.modifiedAt).toLocaleString('id-ID')}\n`;
    text += `**Total Widgets:** ${dashboardDetails.totalWidgets}\n`;
    text += `**Link:** [Open Dashboard](${dashboardDetails.permalink})\n\n`;
    
    text += `## 📦 Widgets\n\n`;
    
    dashboardDetails.widgets.forEach((widget, idx) => {
      text += `### ${idx + 1}. ${widget.title} (${widget.type})\n`;
      
      if (widget.content) {
        text += `**Content:** ${widget.content.substring(0, 200)}\n`;
      }
      
      if (widget.metric) {
        text += `**${widget.metric.label}:** ${widget.metric.value}\n`;
      }
      
      if (widget.sheetSummary && !widget.sheetSummary.error) {
        text += `**Sheet:** ${widget.sheetSummary.sheetName} (${widget.sheetSummary.totalRows} rows)\n`;
        text += `**Columns:** ${widget.sheetSummary.columns.join(', ')}\n`;
        
        if (widget.sheetSummary.recentData.length > 0) {
          text += `\n**Recent Data:**\n`;
          widget.sheetSummary.recentData.slice(0, 3).forEach((row, i) => {
            text += `\nRow ${i + 1}:\n`;
            Object.entries(row).forEach(([key, val]) => {
              text += `  - ${key}: ${val}\n`;
            });
          });
        }
      }
      
      text += `\n`;
    });
    
    return text;
  }

  // ==================== REPORTS ====================
  
  async listReports() {
    try {
      const response = await this.client.get('/reports');
      return response.data.data || [];
    } catch (error) {
      throw new Error(`Failed to list reports: ${error.message}`);
    }
  }

  async getReport(reportId) {
    try {
      const response = await this.client.get(`/reports/${reportId}`);
      return response.data;
    } catch (error) {
      throw new Error(`Failed to get report: ${error.message}`);
    }
  }

  // ==================== SEARCH ====================
  
  async searchAll(query) {
    try {
      const response = await this.client.get('/search', {
        params: { query }
      });
      return response.data.results || [];
    } catch (error) {
      throw new Error(`Failed to search: ${error.message}`);
    }
  }

  // ==================== COMPREHENSIVE SUMMARY ====================
  
  async getComprehensiveSummary() {
    try {
      const [sheets, workspaces, sights, reports] = await Promise.all([
        this.listSheets(),
        this.listWorkspaces(),
        this.listSights(),
        this.listReports().catch(() => [])
      ]);

      return {
        summary: {
          totalSheets: sheets.length,
          totalWorkspaces: workspaces.length,
          totalDashboards: sights.length,
          totalReports: reports.length
        },
        sheets: sheets.map(s => ({
          id: s.id,
          name: s.name,
          permalink: s.permalink,
          modifiedAt: s.modifiedAt
        })),
        workspaces: workspaces.map(w => ({
          id: w.id,
          name: w.name,
          permalink: w.permalink
        })),
        dashboards: sights.map(d => ({
          id: d.id,
          name: d.name,
          permalink: d.permalink
        })),
        reports: reports.map(r => ({
          id: r.id,
          name: r.name,
          permalink: r.permalink
        }))
      };
    } catch (error) {
      throw new Error(`Failed to get comprehensive summary: ${error.message}`);
    }
  }

  // ==================== PDF EXPORTS ====================
  
  async getSightAsPDF(sightId) {
    try {
      const response = await this.client.get(`/sights/${sightId}`, {
        headers: { 'Accept': 'application/pdf' },
        responseType: 'arraybuffer'
      });
      return response.data;
    } catch (error) {
      throw new Error(`Failed to export dashboard as PDF: ${error.message}`);
    }
  }

  async getSheetAsPDF(sheetId) {
    try {
      const response = await this.client.get(`/sheets/${sheetId}`, {
        headers: { 'Accept': 'application/pdf' },
        responseType: 'arraybuffer'
      });
      return response.data;
    } catch (error) {
      throw new Error(`Failed to export sheet as PDF: ${error.message}`);
    }
  }
}

export default SmartsheetService;
