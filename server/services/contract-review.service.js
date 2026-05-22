import fs from 'fs';
import path from 'path';
import { marked } from 'marked';
import HTMLToDOCX from 'html-to-docx';

export default {
  /**
   * Generates the Contract Summary (.docx) based on the template structure.
   */
  async generateContractSummary({ markdownContent, title, outputDir }) {
    const safeTitle = (title || "Contract-Summary").replace(/[^a-zA-Z0-9\s-]/g, "").replace(/\s+/g, "-").substring(0, 40);
    const filename = `GYS-${safeTitle}-${Date.now()}.docx`;
    const filepath = path.join(outputDir, filename);

    // Convert markdown to HTML
    // Make tables look more like the GYS template
    const htmlContent = marked.parse(markdownContent);
    
    // Inject styles specifically for the summary table
    // Note: html-to-docx does not support <style> tags and it may corrupt the DOCX.
    // We use basic HTML structure and let it map to default Word styles.
    const styledHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; color: #1F2937;">
        <h2 style="color: #064E3B; text-align: center;">Contract Summary</h2>
        ${htmlContent}
        <p>&nbsp;</p>
        <p><em>Disclaimer: This review is based on the contract summary provided by the user and may not reflect the full terms and conditions of the complete contract document. Any discrepancies in wording, interpretation, or details between the summary and the full contract remain the responsibility of the user.</em></p>
      </div>
    `;

    const buffer = await HTMLToDOCX(styledHtml, null, {
      table: { row: { cantSplit: true } },
      footer: true,
      pageNumber: true
    });

    fs.writeFileSync(filepath, buffer);

    return {
      fileUrl: `/api/files/${filename}`,
      fileName: filename,
    };
  },

  /**
   * Generates the Reviewed Contract (.docx) with inline comments.
   */
  async generateReviewedContract({ markdownContent, title, outputDir }) {
    const safeTitle = (title || "Reviewed-Contract").replace(/[^a-zA-Z0-9\s-]/g, "").replace(/\s+/g, "-").substring(0, 40);
    const filename = `GYS-Reviewed-${safeTitle}-${Date.now()}.docx`;
    const filepath = path.join(outputDir, filename);

    const htmlContent = marked.parse(markdownContent);
    
    // Inject styles for the reviewed document
    const styledHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; color: #1F2937; line-height: 1.5;">
        <h2 style="color: #064E3B;">Reviewed Contract Document</h2>
        <p style="color: #6B7280; font-style: italic;">Note: This document contains the original text along with AI-generated review comments and findings.</p>
        <p>___________________________________________________</p>
        ${htmlContent}
      </div>
    `;

    const buffer = await HTMLToDOCX(styledHtml, null, {
      table: { row: { cantSplit: true } },
      footer: true,
      pageNumber: true
    });

    fs.writeFileSync(filepath, buffer);

    return {
      fileUrl: `/api/files/${filename}`,
      fileName: filename,
    };
  }
};
