import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class PDFReportService {
  constructor() {
    this.dataDir = path.join(__dirname, '..', 'data', 'reports');
  }

  async ensureDataDir() {
    try {
      await fs.mkdir(this.dataDir, { recursive: true });
    } catch (error) {
      console.error('Error creating data directory:', error);
    }
  }

  /**
   * Generate comprehensive PDF report
   */
  async generateReport(sheetData, insights) {
    try {
      await this.ensureDataDir();

      const timestamp = Date.now();
      const filename = `smartsheet-report-${timestamp}.html`;
      const filepath = path.join(this.dataDir, filename);

      // Generate HTML report (can be converted to PDF via browser print)
      const html = this.generateHTML(sheetData, insights);

      await fs.writeFile(filepath, html, 'utf-8');

      console.log('✅ Report generated:', filepath);

      return {
        filename,
        filepath
      };
    } catch (error) {
      console.error('❌ Report generation error:', error.message);
      throw error;
    }
  }

  /**
   * Generate HTML report content
   */
  generateHTML(sheetData, insights) {
    const now = new Date();
    
    return `<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Smartsheet Project Report - ${sheetData.metadata.name}</title>
    <style>
        @page {
            size: A4;
            margin: 15mm;
        }
        
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            line-height: 1.6;
            color: #333;
            padding: 20px;
            background: #fff;
        }
        
        .header {
            background: linear-gradient(135deg, #16a34a 0%, #15803d 100%);
            color: white;
            padding: 30px;
            border-radius: 8px;
            margin-bottom: 30px;
            text-align: center;
        }
        
        .header h1 {
            font-size: 32px;
            margin-bottom: 10px;
        }
        
        .header p {
            font-size: 14px;
            opacity: 0.9;
        }
        
        .section {
            margin-bottom: 30px;
            page-break-inside: avoid;
        }
        
        .section-title {
            background: #f0fdf4;
            color: #15803d;
            padding: 12px 15px;
            font-size: 18px;
            font-weight: bold;
            border-left: 4px solid #16a34a;
            margin-bottom: 15px;
        }
        
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin-bottom: 20px;
        }
        
        .stat-card {
            background: #f9fafb;
            border: 1px solid #e5e7eb;
            border-radius: 6px;
            padding: 15px;
        }
        
        .stat-label {
            font-size: 12px;
            color: #6b7280;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 5px;
        }
        
        .stat-value {
            font-size: 24px;
            font-weight: bold;
            color: #16a34a;
        }
        
        .alert {
            border-left: 4px solid;
            padding: 15px;
            margin: 10px 0;
            border-radius: 4px;
        }
        
        .alert-high {
            background: #fef2f2;
            border-color: #dc2626;
            color: #991b1b;
        }
        
        .alert-medium {
            background: #fff7ed;
            border-color: #f59e0b;
            color: #92400e;
        }
        
        .alert-low {
            background: #fef9c3;
            border-color: #eab308;
            color: #854d0e;
        }
        
        .project-list {
            list-style: none;
        }
        
        .project-item {
            background: #f9fafb;
            border: 1px solid #e5e7eb;
            border-radius: 6px;
            padding: 15px;
            margin: 10px 0;
        }
        
        .project-name {
            font-weight: bold;
            color: #111827;
            font-size: 16px;
            margin-bottom: 8px;
        }
        
        .project-detail {
            font-size: 14px;
            color: #6b7280;
            margin: 3px 0;
        }
        
        .badge {
            display: inline-block;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: 600;
            margin-right: 5px;
        }
        
        .badge-red {
            background: #fecaca;
            color: #991b1b;
        }
        
        .badge-yellow {
            background: #fef3c7;
            color: #92400e;
        }
        
        .badge-green {
            background: #d1fae5;
            color: #065f46;
        }
        
        .recommendation {
            background: #dbeafe;
            border-left: 4px solid #2563eb;
            padding: 15px;
            margin: 10px 0;
            border-radius: 4px;
        }
        
        .recommendation-title {
            font-weight: bold;
            color: #1e40af;
            margin-bottom: 5px;
        }
        
        .recommendation-text {
            color: #1e3a8a;
            font-size: 14px;
        }
        
        .footer {
            margin-top: 40px;
            padding-top: 20px;
            border-top: 2px solid #e5e7eb;
            text-align: center;
            color: #6b7280;
            font-size: 12px;
        }
        
        @media print {
            body {
                padding: 0;
            }
            
            .section {
                page-break-inside: avoid;
            }
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>📊 Smartsheet Project Report</h1>
        <p>Garuda Yamato Steel</p>
        <p>${sheetData.metadata.name}</p>
        <p>Generated: ${now.toLocaleString('id-ID')}</p>
    </div>

    <!-- EXECUTIVE SUMMARY -->
    <div class="section">
        <div class="section-title">📈 Executive Summary</div>
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-label">Total Projects</div>
                <div class="stat-value">${insights.overview.totalProjects}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Completion Rate</div>
                <div class="stat-value">${insights.overview.completionRate}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Overdue Projects</div>
                <div class="stat-value">${insights.overdueProjects.length}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Projects with Issues</div>
                <div class="stat-value">${insights.projectsWithIssues.length}</div>
            </div>
        </div>
        <p style="color: #6b7280; font-size: 14px;">
            Last Update: ${new Date(insights.overview.lastUpdate).toLocaleString('id-ID')} 
            (${insights.overview.dataFreshness})
        </p>
    </div>

    <!-- OVERDUE PROJECTS -->
    ${insights.overdueProjects.length > 0 ? `
    <div class="section">
        <div class="section-title">⚠️ Overdue Projects (${insights.overdueProjects.length})</div>
        <div class="alert alert-high">
            <strong>Critical:</strong> ${insights.overdueProjects.length} project(s) are past their due date and require immediate attention.
        </div>
        <ul class="project-list">
            ${insights.overdueProjects.map(project => `
            <li class="project-item">
                <div class="project-name">
                    ${project.name}
                    <span class="badge badge-red">${project.daysOverdue} days overdue</span>
                </div>
                <div class="project-detail">📅 Due Date: ${project.dueDate}</div>
                <div class="project-detail">📊 Status: ${project.status}</div>
                <div class="project-detail">🔢 Row: ${project.rowNumber}</div>
            </li>
            `).join('')}
        </ul>
    </div>
    ` : ''}

    <!-- PROJECTS WITH ISSUES -->
    ${insights.projectsWithIssues.length > 0 ? `
    <div class="section">
        <div class="section-title">🚨 Projects with Issues (${insights.projectsWithIssues.length})</div>
        <div class="alert alert-medium">
            <strong>Warning:</strong> ${insights.projectsWithIssues.length} project(s) have reported issues that need resolution.
        </div>
        <ul class="project-list">
            ${insights.projectsWithIssues.map(project => `
            <li class="project-item">
                <div class="project-name">
                    ${project.name}
                    <span class="badge badge-yellow">Active Issue</span>
                </div>
                <div class="project-detail">⚠️ Issue: ${project.issue}</div>
                <div class="project-detail">📊 Status: ${project.status}</div>
                <div class="project-detail">🔢 Row: ${project.rowNumber}</div>
            </li>
            `).join('')}
        </ul>
    </div>
    ` : ''}

    <!-- RECENT UPDATES -->
    ${insights.recentUpdates.length > 0 ? `
    <div class="section">
        <div class="section-title">🔄 Recent Updates (Last 7 Days)</div>
        <ul class="project-list">
            ${insights.recentUpdates.slice(0, 10).map(project => `
            <li class="project-item">
                <div class="project-name">
                    ${project.name}
                    <span class="badge badge-green">Recently Updated</span>
                </div>
                <div class="project-detail">📅 Updated: ${new Date(project.modifiedDate).toLocaleDateString('id-ID')}</div>
                <div class="project-detail">📊 Status: ${project.status}</div>
                <div class="project-detail">🔢 Row: ${project.rowNumber}</div>
            </li>
            `).join('')}
        </ul>
    </div>
    ` : ''}

    <!-- RISK ANALYSIS -->
    ${(insights.riskAnalysis.high.length + insights.riskAnalysis.medium.length > 0) ? `
    <div class="section">
        <div class="section-title">🚨 Risk Analysis</div>
        
        ${insights.riskAnalysis.high.length > 0 ? `
        <div class="alert alert-high">
            <strong>High Risk Projects: ${insights.riskAnalysis.high.length}</strong>
        </div>
        <ul class="project-list">
            ${insights.riskAnalysis.high.map(project => `
            <li class="project-item">
                <div class="project-name">
                    ${project.name}
                    <span class="badge badge-red">HIGH RISK</span>
                </div>
                <div class="project-detail">🔢 Row: ${project.rowNumber}</div>
                ${project.reasons.map(reason => `
                <div class="project-detail">⚠️ ${reason}</div>
                `).join('')}
            </li>
            `).join('')}
        </ul>
        ` : ''}
        
        ${insights.riskAnalysis.medium.length > 0 ? `
        <div class="alert alert-medium" style="margin-top: 15px;">
            <strong>Medium Risk Projects: ${insights.riskAnalysis.medium.length}</strong>
        </div>
        <ul class="project-list">
            ${insights.riskAnalysis.medium.slice(0, 5).map(project => `
            <li class="project-item">
                <div class="project-name">
                    ${project.name}
                    <span class="badge badge-yellow">MEDIUM RISK</span>
                </div>
                <div class="project-detail">🔢 Row: ${project.rowNumber}</div>
                ${project.reasons.map(reason => `
                <div class="project-detail">⚠️ ${reason}</div>
                `).join('')}
            </li>
            `).join('')}
        </ul>
        ` : ''}
    </div>
    ` : ''}

    <!-- RECOMMENDATIONS -->
    ${insights.recommendations.length > 0 ? `
    <div class="section">
        <div class="section-title">💡 Recommendations</div>
        ${insights.recommendations.map((rec, idx) => `
        <div class="recommendation">
            <div class="recommendation-title">
                ${idx + 1}. ${rec.category} 
                <span class="badge badge-${rec.priority === 'high' ? 'red' : rec.priority === 'medium' ? 'yellow' : 'green'}">
                    ${rec.priority.toUpperCase()}
                </span>
            </div>
            <div class="recommendation-text">
                <p><strong>Issue:</strong> ${rec.message}</p>
                <p><strong>Action:</strong> ${rec.action}</p>
            </div>
        </div>
        `).join('')}
    </div>
    ` : ''}

    <!-- PROJECT STATUS DISTRIBUTION -->
    ${insights.projectsByStatus ? `
    <div class="section">
        <div class="section-title">📊 Project Status Distribution</div>
        <div class="stats-grid">
            ${Object.entries(insights.projectsByStatus).map(([status, projects]) => `
            <div class="stat-card">
                <div class="stat-label">${status}</div>
                <div class="stat-value">${projects.length}</div>
            </div>
            `).join('')}
        </div>
    </div>
    ` : ''}

    <!-- FOOTER -->
    <div class="footer">
        <p><strong>Garuda Yamato Steel</strong></p>
        <p>Smartsheet Project Management Report</p>
        <p>Generated: ${now.toLocaleString('id-ID')}</p>
        <p>Data Source: ${sheetData.metadata.name}</p>
        <p style="margin-top: 10px;">
            <a href="${sheetData.metadata.permalink}" style="color: #2563eb; text-decoration: none;">
                🔗 View in Smartsheet
            </a>
        </p>
    </div>
</body>
</html>`;
  }

  /**
   * Get report file path
   */
  async getReportPath(filename) {
    const filepath = path.join(this.dataDir, filename);
    try {
      await fs.access(filepath);
      return filepath;
    } catch (error) {
      throw new Error('Report not found');
    }
  }

  /**
   * Clean up old reports
   */
  async cleanupOldReports() {
    try {
      await this.ensureDataDir();
      const files = await fs.readdir(this.dataDir);
      const now = Date.now();
      const oneDay = 24 * 60 * 60 * 1000;

      for (const file of files) {
        if (file.startsWith('smartsheet-report-')) {
          const filepath = path.join(this.dataDir, file);
          const stats = await fs.stat(filepath);
          
          if (now - stats.mtimeMs > oneDay) {
            await fs.unlink(filepath);
            console.log('🗑️ Cleaned up report:', file);
          }
        }
      }
    } catch (error) {
      console.error('❌ Cleanup error:', error.message);
    }
  }
}

export default PDFReportService;
