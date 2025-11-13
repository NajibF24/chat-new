import PDFDocument from 'pdfkit';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class PDFService {
  constructor() {
    this.tempDir = path.join(__dirname, '..', 'temp');
  }

  async ensureTempDir() {
    try {
      await fs.mkdir(this.tempDir, { recursive: true });
    } catch (error) {
      console.error('Error creating temp directory:', error);
    }
  }

  /**
   * Generate comprehensive Smartsheet project report
   */
  async generateSmartsheetReport(reportData) {
    try {
      await this.ensureTempDir();

      const timestamp = Date.now();
      const filename = `smartsheet-report-${timestamp}.pdf`;
      const filepath = path.join(this.tempDir, filename);

      return new Promise((resolve, reject) => {
        const doc = new PDFDocument({
          size: 'A4',
          margins: { top: 50, bottom: 50, left: 50, right: 50 }
        });

        const stream = doc.pipe(require('fs').createWriteStream(filepath));

        // HEADER
        this.addHeader(doc);

        // DASHBOARD SECTION
        if (reportData.dashboard) {
          this.addDashboardSection(doc, reportData.dashboard);
        }

        // PROJECTS SECTION
        if (reportData.projects && reportData.projects.length > 0) {
          this.addProjectsSection(doc, reportData.projects);
        }

        // IMAGE WIDGETS INFO (metadata only)
        if (reportData.imageWidgets) {
          this.addImageWidgetsSection(doc, reportData.imageWidgets);
        }

        // SUMMARY
        this.addSummary(doc, reportData);

        // FOOTER
        this.addFooter(doc);

        doc.end();

        stream.on('finish', () => {
          console.log('✅ PDF generated:', filepath);
          resolve({ filepath, filename });
        });

        stream.on('error', reject);
      });
    } catch (error) {
      console.error('❌ PDF generation error:', error.message);
      throw error;
    }
  }

  addHeader(doc) {
    doc.fontSize(24)
       .font('Helvetica-Bold')
       .fillColor('#1a5490')
       .text('GARUDA YAMATO STEEL', { align: 'center' });
    
    doc.fontSize(18)
       .fillColor('#333333')
       .text('Smartsheet Project Report', { align: 'center' });
    
    doc.moveDown(0.5);
    doc.fontSize(10)
       .font('Helvetica')
       .fillColor('#666666')
       .text(`Generated: ${new Date().toLocaleString('id-ID')}`, { align: 'center' });
    
    doc.moveDown(2);
    this.addHorizontalLine(doc);
    doc.moveDown();
  }

  addDashboardSection(doc, dashboard) {
    this.checkNewPage(doc, 150);

    doc.fontSize(16)
       .font('Helvetica-Bold')
       .fillColor('#1a5490')
       .text('📱 Dashboard Overview');
    
    doc.moveDown(0.5);
    
    doc.fontSize(11)
       .font('Helvetica')
       .fillColor('#333333')
       .text(`Name: ${dashboard.name}`);
    
    if (dashboard.description) {
      doc.text(`Description: ${dashboard.description}`);
    }
    
    doc.text(`Total Widgets: ${dashboard.totalWidgets}`);
    
    doc.moveDown();
    
    // Widget breakdown
    if (dashboard.widgets && dashboard.widgets.length > 0) {
      doc.fontSize(12)
         .font('Helvetica-Bold')
         .text('Widget Breakdown:');
      
      doc.fontSize(10)
         .font('Helvetica');
      
      const widgetTypes = {};
      dashboard.widgets.forEach(w => {
        widgetTypes[w.type] = (widgetTypes[w.type] || 0) + 1;
      });
      
      Object.entries(widgetTypes).forEach(([type, count]) => {
        doc.text(`  • ${type}: ${count}`);
      });
    }
    
    doc.moveDown(2);
    this.addHorizontalLine(doc);
    doc.moveDown();
  }

  addProjectsSection(doc, projects) {
    this.checkNewPage(doc, 150);

    doc.fontSize(16)
       .font('Helvetica-Bold')
       .fillColor('#1a5490')
       .text(`📊 Projects (${projects.length})`);
    
    doc.moveDown();

    projects.forEach((project, index) => {
      this.checkNewPage(doc, 200);

      // Project header
      doc.fontSize(14)
         .font('Helvetica-Bold')
         .fillColor('#2c5aa0')
         .text(`${index + 1}. ${project.name}`);
      
      doc.moveDown(0.3);

      if (project.error) {
        doc.fontSize(10)
           .font('Helvetica')
           .fillColor('#d32f2f')
           .text(`❌ Error: ${project.error}`);
        doc.moveDown(2);
        return;
      }

      // Project details
      doc.fontSize(10)
         .font('Helvetica')
         .fillColor('#333333');
      
      doc.text(`📅 Last Modified: ${new Date(project.modifiedAt).toLocaleString('id-ID')}`);
      doc.text(`📋 Total Tasks: ${project.stats.totalTasks}`);
      doc.text(`📊 Total Columns: ${project.totalColumns}`);
      doc.text(`✅ Completion Rate: ${project.stats.completionRate}%`);
      
      if (project.attachments > 0) {
        doc.text(`📎 Attachments: ${project.attachments}`);
      }
      
      if (project.discussions > 0) {
        doc.text(`💬 Discussions: ${project.discussions}`);
      }

      doc.moveDown(0.5);

      // Status breakdown
      if (Object.keys(project.stats.tasksByStatus).length > 0) {
        doc.fontSize(11)
           .font('Helvetica-Bold')
           .text('Task Status Breakdown:');
        
        doc.fontSize(9)
           .font('Helvetica');
        
        Object.entries(project.stats.tasksByStatus)
          .sort((a, b) => b[1] - a[1])
          .forEach(([status, count]) => {
            const percentage = ((count / project.stats.totalTasks) * 100).toFixed(1);
            doc.text(`  • ${status}: ${count} (${percentage}%)`);
          });
        
        doc.moveDown(0.5);
      }

      // Columns info
      if (project.columns && project.columns.length > 0) {
        doc.fontSize(11)
           .font('Helvetica-Bold')
           .text('Columns:');
        
        doc.fontSize(9)
           .font('Helvetica');
        
        const columnNames = project.columns
          .map(col => col.title)
          .join(', ');
        
        doc.text(`  ${columnNames}`, {
          width: 480,
          align: 'left'
        });
        
        doc.moveDown(0.5);
      }

      // Sample data
      if (project.rows && project.rows.length > 0) {
        doc.fontSize(11)
           .font('Helvetica-Bold')
           .text('Sample Data (first 5 rows):');
        
        doc.fontSize(8)
           .font('Helvetica');
        
        project.rows.slice(0, 5).forEach((row, rowIdx) => {
          doc.text(`  Row ${rowIdx + 1}:`, { continued: false });
          
          Object.entries(row.data)
            .filter(([key, val]) => val.value)
            .slice(0, 3)
            .forEach(([key, val]) => {
              doc.text(`    • ${key}: ${String(val.value).substring(0, 50)}`, {
                width: 460
              });
            });
          
          if (rowIdx < 4) doc.moveDown(0.3);
        });
      }

      doc.moveDown(1.5);
      
      // Link to sheet
      doc.fontSize(9)
         .fillColor('#1a5490')
         .text(`🔗 Open in Smartsheet: ${project.permalink}`, {
           link: project.permalink,
           underline: true
         });

      doc.moveDown(2);
      this.addHorizontalLine(doc, '#e0e0e0');
      doc.moveDown(1.5);
    });
  }

  addImageWidgetsSection(doc, imageWidgets) {
    this.checkNewPage(doc, 150);

    doc.fontSize(16)
       .font('Helvetica-Bold')
       .fillColor('#1a5490')
       .text(`📸 Dashboard Images (${imageWidgets.totalImages})`);
    
    doc.moveDown(0.5);
    
    doc.fontSize(10)
       .font('Helvetica')
       .fillColor('#666666')
       .text('Note: Images are available in Smartsheet dashboard but cannot be downloaded via API.');
    
    doc.moveDown();

    if (imageWidgets.images && imageWidgets.images.length > 0) {
      doc.fontSize(10)
         .font('Helvetica')
         .fillColor('#333333');
      
      imageWidgets.images.forEach((img, idx) => {
        doc.text(`${idx + 1}. ${img.title}`);
        doc.fontSize(9)
           .fillColor('#666666')
           .text(`   File: ${img.fileName}`, { indent: 20 });
        doc.fontSize(10)
           .fillColor('#333333');
        doc.moveDown(0.3);
      });
    }

    doc.moveDown();
    doc.fontSize(9)
       .fillColor('#1a5490')
       .text(`🔗 View Dashboard: ${imageWidgets.dashboardUrl}`, {
         link: imageWidgets.dashboardUrl,
         underline: true
       });

    doc.moveDown(2);
    this.addHorizontalLine(doc);
    doc.moveDown();
  }

  addSummary(doc, reportData) {
    this.checkNewPage(doc, 150);

    doc.fontSize(16)
       .font('Helvetica-Bold')
       .fillColor('#1a5490')
       .text('📈 Summary');
    
    doc.moveDown();

    const totalProjects = reportData.projects?.length || 0;
    const totalTasks = reportData.projects
      ?.filter(p => !p.error)
      .reduce((sum, p) => sum + (p.stats?.totalTasks || 0), 0) || 0;
    
    const avgCompletion = reportData.projects
      ?.filter(p => !p.error && p.stats?.completionRate)
      .reduce((sum, p, idx, arr) => sum + p.stats.completionRate / arr.length, 0) || 0;

    doc.fontSize(11)
       .font('Helvetica')
       .fillColor('#333333');
    
    doc.text(`Total Projects: ${totalProjects}`);
    doc.text(`Total Tasks: ${totalTasks}`);
    doc.text(`Average Completion Rate: ${avgCompletion.toFixed(1)}%`);
    
    if (reportData.imageWidgets) {
      doc.text(`Dashboard Images: ${reportData.imageWidgets.totalImages}`);
    }

    doc.moveDown(2);
  }

  addFooter(doc) {
    const pageCount = doc.bufferedPageRange().count;
    
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      
      doc.fontSize(8)
         .font('Helvetica')
         .fillColor('#999999')
         .text(
           `Page ${i + 1} of ${pageCount} | Garuda Yamato Steel | Confidential`,
           50,
           doc.page.height - 30,
           { align: 'center', width: doc.page.width - 100 }
         );
    }
  }

  addHorizontalLine(doc, color = '#cccccc') {
    doc.strokeColor(color)
       .lineWidth(1)
       .moveTo(50, doc.y)
       .lineTo(doc.page.width - 50, doc.y)
       .stroke();
  }

  checkNewPage(doc, requiredSpace = 100) {
    if (doc.y > doc.page.height - requiredSpace) {
      doc.addPage();
    }
  }

  /**
   * Clean up old PDF files
   */
  async cleanupOldFiles() {
    try {
      await this.ensureTempDir();
      const files = await fs.readdir(this.tempDir);
      const now = Date.now();
      const oneHour = 60 * 60 * 1000;

      for (const file of files) {
        if (file.endsWith('.pdf')) {
          const filepath = path.join(this.tempDir, file);
          const stats = await fs.stat(filepath);
          
          if (now - stats.mtimeMs > oneHour) {
            await fs.unlink(filepath);
            console.log('🗑️ Cleaned up PDF:', file);
          }
        }
      }
    } catch (error) {
      console.error('❌ PDF cleanup error:', error.message);
    }
  }
}

export default new PDFService();
