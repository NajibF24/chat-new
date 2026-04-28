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

    // Logo: primary = server/assets/ (git-tracked, always inside Docker)
    const logoPath = path.join(process.cwd(), 'assets', 'gys-logo.webp');
    const logoPathAlt = path.join(process.cwd(), 'data', 'gys-logo.webp');
    const logoPathAlt2 = path.join(process.cwd(), '../client/public/assets/gys-logo.webp');
    let logoBase64 = '';
    const resolvedLogoPath = fs.existsSync(logoPath) ? logoPath 
      : fs.existsSync(logoPathAlt) ? logoPathAlt 
      : fs.existsSync(logoPathAlt2) ? logoPathAlt2 
      : null;
    if (resolvedLogoPath) {
      const logoBuf = fs.readFileSync(resolvedLogoPath);
      logoBase64 = 'data:image/webp;base64,' + logoBuf.toString('base64');
      console.log('[NEWSLETTER] Logo loaded from:', resolvedLogoPath);
    } else {
      console.warn('[NEWSLETTER] Logo not found — using text fallback');
    }
    
    const logoHtml = logoBase64 
      ? `<img src="${logoBase64}" alt="GYS Logo" style="height: 60px;">` 
      : `<div class="logo-text">GYS</div><div class="logo-sub">GARUDA YAMATO STEEL</div>`;

    // Steel texture background image
    const steelTexturePath = path.join(process.cwd(), 'assets', 'steel-texture.png');
    let steelTextureBase64 = '';
    if (fs.existsSync(steelTexturePath)) {
      const steelBuf = fs.readFileSync(steelTexturePath);
      steelTextureBase64 = 'data:image/png;base64,' + steelBuf.toString('base64');
      console.log('[NEWSLETTER] Steel texture loaded');
    }

    // SVG lobster/claw icon (replaces emoji which doesn't render on Alpine Linux)
    const clawIcon = `<svg viewBox="0 0 64 64" width="18" height="18" style="vertical-align: middle; margin-left: 4px;"><path fill="#E74C3C" d="M32 58c-2 0-4-1-5-3l-3-8c-1-2 0-4 1-5l4-3c-3-1-5-4-5-7v-4c0-2-2-4-4-4h-2c-3 0-5-2-6-5l-2-6c0-2 0-4 2-5l6-3c2-1 4 0 5 1l2 4 2-2c1-2 3-3 5-3s4 1 5 3l2 2 2-4c1-2 3-2 5-1l6 3c2 1 2 3 2 5l-2 6c-1 3-3 5-6 5h-2c-2 0-4 2-4 4v4c0 3-2 6-5 7l4 3c1 1 2 3 1 5l-3 8c-1 2-3 3-5 3z"/><circle fill="#fff" cx="26" cy="22" r="3"/><circle fill="#fff" cx="38" cy="22" r="3"/><circle fill="#222" cx="26" cy="22" r="1.5"/><circle fill="#222" cx="38" cy="22" r="1.5"/><path fill="none" stroke="#C0392B" stroke-width="2" d="M28 34c0 0 4 3 8 0"/></svg>`;

    const icons = {
      traffic: `<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M12 2C8.13 2 5 5.13 5 9v6c0 3.87 3.13 7 7 7s7-3.13 7-7V9c0-3.87-3.13-7-7-7zm0 4.5c.83 0 1.5.67 1.5 1.5S12.83 9.5 12 9.5 10.5 8.83 10.5 8 11.17 6.5 12 6.5zm0 5.5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5-1.5-.67-1.5-1.5.67-1.5 1.5-1.5zm0 5.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/></svg>`,
      compass: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>`,
      target: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>`,
      users: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
      handshake: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4"/><path d="M4 6v12c0 1.1.9 2 2 2h14v-4"/><path d="M18 14H6"/></svg>`,
      trend: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>`,
      check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><polyline points="20 6 9 17 4 12"/></svg>`,
      bar: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="24" height="24"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`,
      cart: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="24" height="24"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>`,
      pin: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="24" height="24"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>`,
      link: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`
    };

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
      background-color: #E8EAEB;
      color: #1F2937;
      width: 900px;
      min-height: 100vh;
      box-sizing: border-box;
      position: relative;
      display: flex;
      flex-direction: column;
      ${steelTextureBase64 ? `background-image: url('${steelTextureBase64}'); background-size: cover; background-repeat: repeat;` : ''}
    }
    /* Semi-transparent overlay so steel texture is visible but not overwhelming */
    body::before {
      content: '';
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(245, 247, 246, 0.72);
      z-index: 0;
      pointer-events: none;
    }
    body > * { position: relative; z-index: 1; }
    
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
      background: transparent;
      padding: 8px 16px;
      border-radius: 8px;
      margin-right: 30px;
      z-index: 2;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }
    .logo-container img { max-height: 70px; width: auto; object-fit: contain; }
    .logo-text { font-family: 'Oswald', sans-serif; font-size: 46px; font-weight: 800; color: #ffffff; letter-spacing: -1px; line-height: 1; }
    .logo-sub { font-size: 10px; font-weight: 700; color: #A7F3D0; letter-spacing: 0.5px; text-align: center; }
    
    .header-content { z-index: 2; flex: 1; }
    .title { font-family: 'Oswald', sans-serif; font-size: 58px; font-weight: 600; line-height: 1; margin: 0; letter-spacing: -0.5px; }
    .subtitle { font-size: 18px; font-weight: 500; color: #D1FAE5; margin: 5px 0 15px 0; }
    
    .meta-bar { display: flex; align-items: center; font-size: 13px; color: #A7F3D0; font-weight: 500; }
    .meta-item { display: flex; align-items: center; margin-right: 20px; }
    .meta-icon { margin-right: 6px; display: inline-flex; align-items: center; }
    .separator { margin: 0 15px; color: #6EE7B7; }
    
    .watermark { position: absolute; right: 40px; bottom: 20px; font-size: 12px; color: rgba(255,255,255,0.7); font-style: italic; z-index: 2; }
    
    /* Diagonal decorative lines in header */
    .deco-lines { position: absolute; right: -50px; top: -50px; width: 400px; height: 400px; opacity: 0.15; z-index: 1; background: repeating-linear-gradient(45deg, transparent, transparent 10px, #ffffff 10px, #ffffff 12px); }

    .main-content { padding: 30px 40px; display: flex; flex-direction: column; gap: 20px; flex: 1; }
    
    /* Box Styles — slightly transparent white so steel texture peeks through */
    .box {
      background: rgba(255, 255, 255, 0.88);
      border-radius: 12px;
      box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -1px rgba(0,0,0,0.03);
      padding: 25px;
      position: relative;
      border: 1px solid #E5E7EB;
      backdrop-filter: blur(2px);
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
    
    /* Footer — normal flow at bottom, NOT absolute */
    .footer { background: #064E3B; color: white; padding: 20px 40px; display: flex; justify-content: space-between; align-items: center; margin-top: 0; }
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
      <div class="subtitle">Daily Market &amp; Industry Intelligence</div>
      <div class="meta-bar">
        <div class="meta-item"><span class="meta-icon"><svg viewBox="0 0 24 24" fill="none" stroke="#A7F3D0" stroke-width="2" width="16" height="16"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></span> ${dateStr}</div>
        <div class="separator">|</div>
        <div class="meta-item"><span class="meta-icon"><svg viewBox="0 0 24 24" fill="none" stroke="#A7F3D0" stroke-width="2" width="16" height="16"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></span> ${timeStr}</div>
      </div>
    </div>
    <div class="watermark">Generated by | GYS Open Claw ${clawIcon}</div>
  </div>

  <div class="main-content">
    
    <div class="box signal-box">
      <div class="section-header">
        <div class="section-icon">${icons.traffic}</div>
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
        <div class="section-icon">${icons.compass}</div>
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
        <div class="section-icon">${icons.target}</div>
        <h2 class="section-title">Commercial Implication for GYS</h2>
      </div>
      <div class="impl-intro">${data.implicationIntro || 'The immediate focus should be to monitor whether this news changes:'}</div>
      <div class="impl-grid">
        <div class="impl-item">
          <div class="impl-header">
            <span class="impl-icon" style="width:24px;height:24px;display:inline-block;">${icons.users}</span>
            <span class="impl-title">Customer behavior</span>
          </div>
          <div class="impl-text">${data.implicationCustomer || ''}</div>
        </div>
        <div class="impl-item">
          <div class="impl-header">
            <span class="impl-icon" style="width:24px;height:24px;display:inline-block;">${icons.handshake}</span>
            <span class="impl-title">Supplier behavior</span>
          </div>
          <div class="impl-text">${data.implicationSupplier || ''}</div>
        </div>
        <div class="impl-item">
          <div class="impl-header">
            <span class="impl-icon" style="width:24px;height:24px;display:inline-block;">${icons.trend}</span>
            <span class="impl-title">Market narrative</span>
          </div>
          <div class="impl-text">${data.implicationMarket || ''}</div>
        </div>
      </div>
    </div>

    <!-- 4. ACTIONS FOR THIS WEEK -->
    <div class="box">
      <div class="section-header">
        <div class="section-icon">${icons.check}</div>
        <h2 class="section-title">Actions for This Week</h2>
      </div>
      <div class="action-grid">
        <div class="action-card">
          <div class="action-icon-wrap">${icons.bar}</div>
          <div class="action-content">
            <h3 class="action-role">Sales</h3>
            <p class="action-desc">${data.actionSalesCheck || ''}</p>
            <p class="action-rec-label">Recommended action:</p>
            <p class="action-rec">${data.actionSalesRec || ''}</p>
          </div>
        </div>
        <div class="action-card">
          <div class="action-icon-wrap">${icons.cart}</div>
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
      <div class="takeaway-icon">${icons.pin}</div>
      <div class="takeaway-content">
        <span class="quote-mark quote-start">"</span>
        <div class="takeaway-text">${data.managementTakeaway || ''}</div>
        <span class="quote-mark quote-end">"</span>
      </div>
    </div>

    <!-- 6. SOURCES & REFERENCES -->
    ${(data.sourceLinks && data.sourceLinks.length > 0) ? `
    <div class="box" style="padding: 18px 25px; border-left: 4px solid #059669;">
      <div class="section-header" style="margin-bottom: 8px;">
        <div class="section-icon" style="width:28px;height:28px;">${icons.link}</div>
        <h2 class="section-title" style="font-size: 16px;">Sources &amp; References</h2>
      </div>
      <div style="font-size: 12px; color: #2563EB; word-break: break-all; padding-left: 40px; line-height: 2;">
        ${data.sourceLinks.map(l => `<div>&#8226; ${l}</div>`).join('')}
      </div>
    </div>` : ''}

  </div>

  <!-- FOOTER -->
  <div class="footer">
    <div class="footer-left">
      <strong>GYS STEEL SIGNAL</strong>
      <span>From data to decision. From signal to action.</span>
    </div>
    <div class="footer-right">
      <div>Generated by | GYS Open Claw ${clawIcon}</div>
      <div>${dateStr} | ${timeStr}</div>
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
    
    // Set viewport wide enough; height will be determined by content (fullPage)
    await page.setViewport({ width: 900, height: 1200, deviceScaleFactor: 2 });
    
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
    
    // Take full-page screenshot — captures ALL content regardless of viewport height
    await page.screenshot({ path: filepath, fullPage: true, type: 'png' });

    await browser.close();

    return {
      fileUrl: `/api/files/${filename}`,
      fileName: filename,
    };
  }
};
