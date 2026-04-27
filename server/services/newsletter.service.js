import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';

export default {
  async generateNewsletterImage({ data, outputDir }) {
    const filename = `GYS-Signal-${Date.now()}.png`;
    const filepath = path.join(outputDir, filename);

    // Format current date and time
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) + ' WIB';

    const logoPath = path.join(process.cwd(), '../client/src/assets/gys-logo.webp');
    let logoBase64 = '';
    if (fs.existsSync(logoPath)) {
      const logoBuf = fs.readFileSync(logoPath);
      logoBase64 = 'data:image/webp;base64,' + logoBuf.toString('base64');
    }
    
    const logoHtml = logoBase64 
      ? `<img src="${logoBase64}" alt="GYS Logo" style="height: 60px;">` 
      : `<div class="logo-text">GYS</div><div class="logo-sub">GARUDA YAMATO STEEL</div>`;

    // HTML Template matching the "GYS STEEL SIGNAL" reference
    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>GYS Steel Signal</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Oswald:wght@600&display=swap');
    
    body {
      margin: 0;
      padding: 0;
      font-family: 'Inter', sans-serif;
      background-color: #F8FAF9;
      color: #1F2937;
      width: 1000px;
      height: 1414px; /* A4 aspect ratio (1:1.414) */
      box-sizing: border-box;
      position: relative;
    }
    
    /* Header Section */
    .header {
      background: linear-gradient(135deg, #023828 0%, #056649 100%);
      color: white;
      padding: 30px 40px;
      display: flex;
      align-items: center;
      position: relative;
      border-bottom: 5px solid #F59E0B; /* Amber accent */
      overflow: hidden;
      height: 120px;
    }
    
    .logo-container {
      background: white;
      padding: 15px 25px;
      border-radius: 8px;
      margin-right: 30px;
      z-index: 2;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }
    .logo-text { font-family: 'Oswald', sans-serif; font-size: 46px; font-weight: 800; color: #064E3B; letter-spacing: -1px; line-height: 1; }
    .logo-sub { font-size: 10px; font-weight: 700; color: #064E3B; letter-spacing: 0.5px; text-align: center; }
    
    .header-content { z-index: 2; flex: 1; }
    .title { font-family: 'Oswald', sans-serif; font-size: 58px; font-weight: 600; line-height: 1; margin: 0; letter-spacing: -0.5px; }
    .subtitle { font-size: 18px; font-weight: 500; color: #D1FAE5; margin: 5px 0 15px 0; }
    
    .meta-bar { display: flex; align-items: center; font-size: 13px; color: #A7F3D0; font-weight: 500; }
    .meta-item { display: flex; align-items: center; margin-right: 20px; }
    .meta-icon { margin-right: 6px; font-size: 16px; }
    .separator { margin: 0 15px; color: #6EE7B7; }
    
    .watermark { position: absolute; right: 40px; bottom: 20px; font-size: 12px; color: rgba(255,255,255,0.7); font-style: italic; z-index: 2; }
    
    /* Diagonal decorative lines in header */
    .deco-lines { position: absolute; right: -50px; top: -50px; width: 400px; height: 400px; opacity: 0.15; z-index: 1; background: repeating-linear-gradient(45deg, transparent, transparent 10px, #ffffff 10px, #ffffff 12px); }

    .main-content { padding: 30px 40px; display: flex; flex-direction: column; gap: 20px; }
    
    /* Box Styles */
    .box {
      background: white;
      border-radius: 12px;
      box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -1px rgba(0,0,0,0.03);
      padding: 25px;
      position: relative;
      border: 1px solid #E5E7EB;
    }
    
    .section-header { display: flex; align-items: center; margin-bottom: 15px; }
    .section-icon { width: 32px; height: 32px; background: #ECFDF5; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 18px; margin-right: 12px; border: 2px solid #059669; }
    .section-title { font-size: 22px; font-weight: 700; color: #064E3B; margin: 0; }
    
    /* Today's Signal */
    .signal-box { border-left: 6px solid #059669; }
    .signal-headline { font-size: 26px; font-weight: 800; color: #111827; margin-bottom: 15px; line-height: 1.3; }
    .signal-text { font-size: 15px; color: #4B5563; line-height: 1.6; }
    .signal-text p { margin-top: 0; margin-bottom: 10px; }
    .signal-text p:last-child { margin-bottom: 0; }
    
    /* 3 Columns Layout */
    .grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
    .card { background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 8px; padding: 20px; }
    .card-num { width: 24px; height: 24px; background: #064E3B; color: white; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-weight: bold; font-size: 12px; margin-right: 8px; }
    .card-title { font-size: 16px; font-weight: 700; color: #1F2937; margin: 0 0 10px 0; display: flex; align-items: flex-start; }
    .card-text { font-size: 13px; color: #4B5563; line-height: 1.5; margin: 0; }
    
    /* Implication Layout */
    .impl-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-top: 15px; }
    .impl-item { display: flex; flex-direction: column; }
    .impl-header { display: flex; align-items: center; margin-bottom: 8px; }
    .impl-icon { font-size: 24px; margin-right: 10px; color: #059669; }
    .impl-title { font-weight: 700; color: #064E3B; font-size: 15px; }
    .impl-text { font-size: 13px; color: #4B5563; line-height: 1.5; padding-left: 34px; border-left: 2px solid #E5E7EB; margin-left: 12px; }
    .impl-intro { font-size: 14px; font-weight: 600; color: #111827; margin-bottom: 10px; }
    
    /* Actions Grid */
    .action-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; }
    .action-card { display: flex; background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 8px; overflow: hidden; }
    .action-icon-wrap { background: #064E3B; padding: 25px 20px; display: flex; align-items: center; justify-content: center; font-size: 32px; color: white; width: 40px; }
    .action-content { padding: 15px 20px; flex: 1; }
    .action-role { font-size: 18px; font-weight: 700; color: #111827; margin: 0 0 8px 0; }
    .action-desc { font-size: 13px; color: #4B5563; line-height: 1.5; margin: 0 0 10px 0; }
    .action-rec-label { font-size: 12px; font-weight: 700; color: #059669; margin: 0 0 4px 0; }
    .action-rec { font-size: 13px; color: #1F2937; font-weight: 500; line-height: 1.4; margin: 0; }
    
    /* Takeaway */
    .takeaway-box { display: flex; align-items: center; background: #F0FDF4; border: 1px solid #A7F3D0; }
    .takeaway-icon { width: 60px; height: 60px; background: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 30px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); margin-right: 25px; flex-shrink: 0; }
    .takeaway-content { flex: 1; position: relative; }
    .quote-mark { font-family: Georgia, serif; font-size: 60px; color: #A7F3D0; position: absolute; line-height: 1; }
    .quote-start { top: -20px; left: -15px; }
    .quote-end { bottom: -40px; right: 0; }
    .takeaway-text { font-size: 16px; font-weight: 600; font-style: italic; color: #064E3B; line-height: 1.6; position: relative; z-index: 1; text-align: center; padding: 0 20px; }
    
    /* Footer */
    .footer { position: absolute; bottom: 0; left: 0; right: 0; background: #064E3B; color: white; padding: 20px 40px; display: flex; justify-content: space-between; align-items: center; }
    .footer-left strong { font-family: 'Oswald', sans-serif; font-size: 20px; letter-spacing: 0.5px; }
    .footer-left span { font-style: italic; font-size: 13px; color: #A7F3D0; margin-left: 10px; }
    .footer-right { font-size: 12px; color: #D1FAE5; text-align: right; }
    .footer-right div { margin-bottom: 4px; }
  </style>
</head>
<body>

  <!-- HEADER -->
  <div class="header">
    <div class="deco-lines"></div>
    <div class="logo-container">
      ${logoHtml}
    </div>
    <div class="header-content">
      <h1 class="title">GYS STEEL SIGNAL</h1>
      <div class="subtitle">Daily Market & Industry Intelligence</div>
      <div class="meta-bar">
        <div class="meta-item"><span class="meta-icon">📅</span> ${dateStr}</div>
        <div class="separator">|</div>
        <div class="meta-item"><span class="meta-icon">🕒</span> ${timeStr}</div>
      </div>
    </div>
    <div class="watermark">Generated by GYS Portal AI 🤖</div>
  </div>

  <div class="main-content">
    
    <!-- 1. TODAY'S SIGNAL -->
    <div class="box signal-box">
      <div class="section-header">
        <div class="section-icon">🚦</div>
        <h2 class="section-title">Today's Signal</h2>
      </div>
      <div class="signal-headline">${data.headline || 'Market Update'}</div>
      <div class="signal-text">
        ${(data.summaryParagraphs || []).map(p => `<p>${p}</p>`).join('')}
      </div>
    </div>

    <!-- 2. THINGS YOU NEED TO KNOW -->
    <div class="box">
      <div class="section-header">
        <div class="section-icon">🧭</div>
        <h2 class="section-title">Things You Need to Know</h2>
      </div>
      <div class="grid-3">
        ${(data.keyPoints || []).slice(0,3).map((kp, idx) => `
        <div class="card">
          <h3 class="card-title"><span class="card-num">${idx+1}</span> ${kp.title}</h3>
          <p class="card-text">${kp.description}</p>
        </div>
        `).join('')}
      </div>
    </div>

    <!-- 3. COMMERCIAL IMPLICATION -->
    <div class="box">
      <div class="section-header">
        <div class="section-icon">🎯</div>
        <h2 class="section-title">Commercial Implication for GYS</h2>
      </div>
      <div class="impl-intro">${data.implicationIntro || 'The immediate focus should be to monitor whether this news changes:'}</div>
      <div class="impl-grid">
        <div class="impl-item">
          <div class="impl-header">
            <span class="impl-icon">👥</span>
            <span class="impl-title">Customer behavior</span>
          </div>
          <div class="impl-text">${data.implicationCustomer || ''}</div>
        </div>
        <div class="impl-item">
          <div class="impl-header">
            <span class="impl-icon">🤝</span>
            <span class="impl-title">Supplier behavior</span>
          </div>
          <div class="impl-text">${data.implicationSupplier || ''}</div>
        </div>
        <div class="impl-item">
          <div class="impl-header">
            <span class="impl-icon">📈</span>
            <span class="impl-title">Market narrative</span>
          </div>
          <div class="impl-text">${data.implicationMarket || ''}</div>
        </div>
      </div>
    </div>

    <!-- 4. ACTIONS FOR THIS WEEK -->
    <div class="box">
      <div class="section-header">
        <div class="section-icon">✅</div>
        <h2 class="section-title">Actions for This Week</h2>
      </div>
      <div class="action-grid">
        <div class="action-card">
          <div class="action-icon-wrap">📊</div>
          <div class="action-content">
            <h3 class="action-role">Sales</h3>
            <p class="action-desc">${data.actionSalesCheck || ''}</p>
            <p class="action-rec-label">Recommended action:</p>
            <p class="action-rec">${data.actionSalesRec || ''}</p>
          </div>
        </div>
        <div class="action-card">
          <div class="action-icon-wrap">🛒</div>
          <div class="action-content">
            <h3 class="action-role">Procurement</h3>
            <p class="action-desc">${data.actionProcurementCheck || ''}</p>
            <p class="action-rec-label">Recommended action:</p>
            <p class="action-rec">${data.actionProcurementRec || ''}</p>
          </div>
        </div>
      </div>
    </div>

    <!-- 5. MANAGEMENT TAKEAWAY -->
    <div class="box takeaway-box">
      <div class="takeaway-icon">📌</div>
      <div class="takeaway-content">
        <span class="quote-mark quote-start">"</span>
        <div class="takeaway-text">${data.managementTakeaway || ''}</div>
        <span class="quote-mark quote-end">"</span>
      </div>
    </div>

  </div>

  <!-- FOOTER -->
  <div class="footer">
    <div class="footer-left">
      <strong>GYS STEEL SIGNAL</strong>
      <span>From data to decision. From signal to action.</span>
    </div>
    <div class="footer-right">
      <div>Generated by GYS Portal AI 🤖</div>
      <div>📅 ${dateStr} | 🕒 ${timeStr}</div>
    </div>
  </div>

</body>
</html>
    `;

    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    
    // Set viewport to match the aspect ratio of the layout
    await page.setViewport({ width: 1000, height: 1414, deviceScaleFactor: 2 });
    
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
    
    // Take screenshot of the full page
    await page.screenshot({ path: filepath, fullPage: true, type: 'png' });

    await browser.close();

    return {
      fileUrl: `/api/files/${filename}`,
      fileName: filename,
    };
  }
};
