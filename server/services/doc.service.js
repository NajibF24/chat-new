import fs from 'fs';
import path from 'path';
import { marked } from 'marked';
import HTMLToDOCX from 'html-to-docx';
import puppeteer from 'puppeteer';

export default {
  async generateWord({ markdownContent, title, outputDir }) {
    const safeTitle = (title || "Document").replace(/[^a-zA-Z0-9\s-]/g, "").replace(/\s+/g, "-").substring(0, 40);
    const filename = `GYS-${safeTitle}-${Date.now()}.docx`;
    const filepath = path.join(outputDir, filename);

    // Convert markdown to HTML
    const htmlContent = marked.parse(markdownContent);
    
    // Add basic styling for Word
    const styledHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; color: #1F2937;">
        ${htmlContent}
      </div>
    `;

    const buffer = await HTMLToDOCX(styledHtml, null, {
      table: { row: { cantSplit: true } },
      footer: true,
      pageNumber: true,
    });

    fs.writeFileSync(filepath, buffer);

    return {
      fileUrl: `/api/files/${filename}`,
      fileName: filename,
    };
  },

  async generatePdf({ markdownContent, title, outputDir }) {
    const safeTitle = (title || "Document").replace(/[^a-zA-Z0-9\s-]/g, "").replace(/\s+/g, "-").substring(0, 40);
    const filename = `GYS-${safeTitle}-${Date.now()}.pdf`;
    const filepath = path.join(outputDir, filename);

    const htmlContent = marked.parse(markdownContent);
    
    const styledHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>${title}</title>
        <style>
          body {
            font-family: 'Inter', 'Segoe UI', Arial, sans-serif;
            color: #1F2937;
            line-height: 1.6;
            margin: 0;
            padding: 40px;
          }
          h1, h2, h3 { color: #064E3B; }
          h1 { border-bottom: 2px solid #059669; padding-bottom: 10px; margin-bottom: 30px; }
          h2 { color: #047857; margin-top: 30px; }
          table { width: 100%; border-collapse: collapse; margin: 20px 0; }
          th, td { border: 1px solid #D1D5DB; padding: 12px; text-align: left; }
          th { background-color: #F3F4F6; color: #111827; font-weight: 600; }
          tr:nth-child(even) { background-color: #F9FAFB; }
          blockquote { border-left: 4px solid #059669; margin: 0; padding-left: 16px; color: #4B5563; font-style: italic; }
          code { background-color: #F3F4F6; padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 0.9em; }
          pre { background-color: #1F2937; color: #F9FAFB; padding: 16px; border-radius: 8px; overflow-x: auto; }
          pre code { background-color: transparent; color: inherit; padding: 0; }
        </style>
      </head>
      <body>
        ${htmlContent}
      </body>
      </html>
    `;

    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.setContent(styledHtml, { waitUntil: 'networkidle0' });
    
    await page.pdf({
      path: filepath,
      format: 'A4',
      printBackground: true,
      margin: { top: '20mm', right: '20mm', bottom: '20mm', left: '20mm' },
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: '<div style="font-size:10px; text-align:center; width:100%; color:#6B7280; font-family:Arial,sans-serif;">PT Garuda Yamato Steel - Halaman <span class="pageNumber"></span> dari <span class="totalPages"></span></div>'
    });

    await browser.close();

    return {
      fileUrl: `/api/files/${filename}`,
      fileName: filename,
    };
  }
};
