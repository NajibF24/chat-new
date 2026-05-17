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
      width: 1920px;
      min-height: 1080px;
      height: auto;
      box-sizing: border-box;
      position: relative;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      ${steelTextureBase64 ? `background-image: url('${steelTextureBase64}'); background-size: cover; background-repeat: no-repeat;` : ''}
    }
    body::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(240, 242, 240, 0.85);
      z-index: 0;
    }
    body > * { position: relative; z-index: 1; }
    
    /* Header Section */
    .header {
      background: linear-gradient(135deg, #023828 0%, #056649 100%);
      color: white;
      padding: 0 60px;
      display: flex;
      align-items: center;
      position: relative;
      border-bottom: 6px solid #F59E0B; /* Amber accent */
      height: 140px;
    }
    
    .logo-container {
      display: flex;
      align-items: center;
      margin-right: 40px;
    }
    .logo-container img { height: 80px; width: auto; object-fit: contain; }
    .logo-text-block { display: flex; flex-direction: column; margin-left: 15px; }
    .logo-text { font-family: 'Inter', sans-serif; font-size: 24px; font-weight: 700; color: #ffffff; letter-spacing: 2px; line-height: 1.2; }
    
    .divider { width: 1px; height: 80px; background: rgba(255,255,255,0.2); margin: 0 40px; }
    
    .header-content { flex: 1; }
    .title { font-family: 'Inter', sans-serif; font-size: 64px; font-weight: 800; line-height: 1; margin: 0; letter-spacing: -1px; }
    .subtitle { font-size: 24px; font-weight: 500; color: #FCD34D; margin: 8px 0 0 0; }
    
    .header-right {
      display: flex;
      align-items: center;
      gap: 40px;
    }
    
    .date-block {
      display: flex;
      align-items: center;
      gap: 15px;
    }
    .date-text { font-size: 18px; color: #E5E7EB; line-height: 1.4; }
    
    .generated-by {
      font-size: 16px;
      color: #D1FAE5;
      text-align: right;
    }
    .generated-by span {
      display: block;
      color: #FCD34D;
      font-weight: 600;
      font-size: 20px;
      margin-top: 4px;
    }
    
    /* Main Content Area */
    .main-content { 
      padding: 30px 60px; 
      display: grid; 
      grid-template-columns: 1.1fr 0.9fr; 
      gap: 30px; 
      flex: 1; 
    }
    
    /* Left Column */
    .left-col { display: flex; flex-direction: column; gap: 20px; }
    
    .main-card {
      background: #FFFFFF;
      border-radius: 16px;
      padding: 30px;
      box-shadow: 0 10px 25px -5px rgba(0,0,0,0.05);
      position: relative;
    }
    
    .signal-badge {
      display: inline-flex;
      align-items: center;
      background: #EA580C;
      color: white;
      padding: 8px 20px;
      border-radius: 8px;
      font-weight: 700;
      font-size: 18px;
      margin-bottom: 20px;
    }
    .signal-badge svg { margin-right: 8px; }
    
    .headline { font-size: 44px; font-weight: 800; color: #064E3B; line-height: 1.2; margin: 0 0 25px 0; letter-spacing: -0.5px; }
    
    .signal-split { display: grid; grid-template-columns: 1fr 280px; gap: 30px; }
    
    .todays-signal { }
    .section-title-small { font-size: 16px; font-weight: 800; color: #064E3B; text-transform: uppercase; margin-bottom: 4px; }
    .section-subtitle { font-size: 16px; color: #4B5563; margin-bottom: 15px; }
    
    .bullet-list { list-style: none; padding: 0; margin: 0; }
    .bullet-list li { display: flex; margin-bottom: 16px; align-items: flex-start; }
    .bullet-icon { width: 40px; height: 40px; background: #064E3B; color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin-right: 15px; flex-shrink: 0; }
    .bullet-text { font-size: 18px; color: #1F2937; line-height: 1.5; padding-top: 6px; }
    
    .what-changed-box {
      border: 2px solid #E5E7EB;
      border-radius: 12px;
      padding: 20px;
    }
    .what-changed-box .section-title-small { color: #059669; text-align: center; margin-bottom: 15px; }
    .change-item { display: flex; align-items: center; margin-bottom: 15px; }
    .change-item:last-child { margin-bottom: 0; }
    .change-icon { font-size: 24px; margin-right: 12px; color: #059669; }
    .change-text { font-size: 14px; color: #374151; line-height: 1.4; }
    
    .implication-box {
      background: #064E3B;
      border-radius: 16px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .impl-header {
      background: #022c22;
      color: white;
      padding: 15px 30px;
      font-weight: 700;
      font-size: 20px;
      display: flex;
      align-items: center;
    }
    .impl-header svg { margin-right: 10px; }
    .impl-content {
      display: grid;
      grid-template-columns: 1fr 1fr;
      padding: 25px 30px;
      gap: 30px;
    }
    .impl-col-title { font-size: 18px; font-weight: 700; color: #34D399; margin-bottom: 15px; text-transform: uppercase; }
    .impl-list { list-style: none; padding: 0; margin: 0; }
    .impl-list li { display: flex; align-items: flex-start; margin-bottom: 12px; color: white; font-size: 16px; line-height: 1.5; }
    .impl-list .icon { margin-right: 12px; color: #34D399; margin-top: 2px; }
    
    .monitoring-box {
      background: #F3F4F6;
      border-radius: 12px;
      padding: 20px 25px;
      display: flex;
      align-items: center;
      border-left: 6px solid #9CA3AF;
    }
    .monitoring-icon { width: 50px; height: 50px; background: #374151; color: white; border-radius: 12px; display: flex; align-items: center; justify-content: center; margin-right: 20px; }
    .monitoring-content { flex: 1; }
    .monitoring-title { font-size: 16px; font-weight: 700; color: #111827; margin-bottom: 4px; }
    .monitoring-text { font-size: 16px; color: #4B5563; }
    
    /* Right Column */
    .right-col { display: flex; flex-direction: column; gap: 20px; }
    
    .dark-header-box {
      background: white;
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 10px 25px -5px rgba(0,0,0,0.05);
    }
    .dark-header {
      background: #064E3B;
      color: white;
      padding: 15px 25px;
      font-size: 20px;
      font-weight: 700;
      display: flex;
      align-items: center;
    }
    .dark-header svg { margin-right: 12px; }
    
    .watchlist-content { padding: 25px; display: flex; flex-direction: column; gap: 15px; }
    .watchlist-item { border: 1px solid #E5E7EB; border-radius: 12px; padding: 20px; display: flex; gap: 20px; }
    .watchlist-icon-area { display: flex; flex-direction: column; align-items: center; gap: 10px; width: 60px; }
    .wl-num { width: 32px; height: 32px; background: #064E3B; color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 18px; }
    .wl-content { flex: 1; }
    .wl-title { font-size: 20px; font-weight: 700; color: #111827; margin: 0 0 8px 0; }
    .wl-desc { font-size: 16px; color: #4B5563; line-height: 1.5; margin: 0; }
    
    .snapshot-content { padding: 20px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; }
    .snap-item { background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 12px; padding: 20px 10px; display: flex; flex-direction: column; align-items: center; text-align: center; }
    .snap-title { font-size: 12px; font-weight: 700; color: #111827; margin-bottom: 15px; height: 28px; }
    .snap-icon { width: 48px; height: 48px; background: #064E3B; color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin-bottom: 15px; }
    .snap-val { font-size: 18px; font-weight: 800; color: #111827; margin-bottom: 5px; }
    .snap-change { font-size: 16px; font-weight: 700; color: #059669; }
    
    .sources-box {
      background: white;
      border-radius: 12px;
      padding: 20px 25px;
      display: flex;
      align-items: center;
    }
    .sources-icon { width: 48px; height: 48px; background: #064E3B; color: white; border-radius: 8px; display: flex; align-items: center; justify-content: center; margin-right: 20px; flex-shrink: 0; }
    .sources-content { flex: 1; }
    .sources-title { font-size: 16px; font-weight: 700; color: #059669; margin-bottom: 4px; }
    .sources-list { font-size: 14px; color: #4B5563; }
    
    /* Footer */
    .footer {
      background: #111827;
      color: white;
      padding: 20px 60px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: auto;
    }
    .footer-left { font-size: 18px; }
    .footer-left strong { font-family: 'Inter', sans-serif; font-weight: 700; }
    .footer-left span { color: #FCD34D; margin: 0 15px; }
    .footer-right { display: flex; align-items: center; font-size: 16px; color: #D1FAE5; }
    .footer-right svg { margin-right: 8px; }
  </style>
</head>
<body>

  <!-- HEADER -->
  <div class="header">
    <div class="logo-container">
      <img src="${logoBase64}" alt="Logo" />
      <div class="logo-text-block">
        <span class="logo-text">GARUDA</span>
        <span class="logo-text">YAMATO</span>
        <span class="logo-text">STEEL</span>
      </div>
    </div>
    
    <div class="divider"></div>
    
    <div class="header-content">
      <h1 class="title">GYS STEEL SIGNAL</h1>
      <div class="subtitle">Daily Market &amp; Industry Intelligence</div>
    </div>
    
    <div class="header-right">
      <div class="date-block">
        <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" width="36" height="36"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        <div class="date-text">
          <div style="font-weight: 700;">${dateStr.split(',')[0]}</div>
          <div>${dateStr.split(',')[1] ? dateStr.split(',')[1].trim() : dateStr}</div>
        </div>
      </div>
      <div class="generated-by">
        Generated by
        <span>GYS Open Claw ${clawIcon}</span>
      </div>
    </div>
  </div>

  <div class="main-content">
    
    <!-- LEFT COLUMN -->
    <div class="left-col">
      <div class="main-card">
        <div class="signal-badge">
          <svg viewBox="0 0 24 24" fill="white" width="24" height="24"><path d="M12 2L1 21h22M12 8v7m0 4h.01" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          SIGNAL LEVEL: ${data.signalLevel || 'HIGH'}
        </div>
        
        <h2 class="headline">${data.headline || 'Market Update'}</h2>
        
        <div class="signal-split">
          <div class="todays-signal">
            <div class="section-title-small">TODAY'S SIGNAL</div>
            <div class="section-subtitle">Why it matters to GYS</div>
            <ul class="bullet-list">
              ${(data.todaysSignalBullets || []).map((bullet, idx) => `
                <li>
                  <div class="bullet-icon">${idx === 0 ? 'Rp' : idx === 1 ? icons.bar : icons.compass}</div>
                  <div class="bullet-text">${bullet}</div>
                </li>
              `).join('')}
            </ul>
          </div>
          
          <div class="what-changed-box">
            <div class="section-title-small">WHAT CHANGED</div>
            ${(data.whatChanged || []).map(wc => `
              <div class="change-item">
                <div class="change-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="32" height="32"><circle cx="12" cy="12" r="10"/><polyline points="12 16 16 12 12 8"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
                </div>
                <div class="change-text">
                  ${wc.description}
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      <div class="implication-box">
        <div class="impl-header">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="24" height="24"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
          WHAT IT MEANS TO GYS / WHAT TO DO
        </div>
        <div class="impl-content">
          <div>
            <div class="impl-col-title">WHAT IT MEANS TO GYS</div>
            <ul class="impl-list">
              ${(data.whatItMeans || []).map(item => `
                <li><div class="icon">${icons.check}</div><div>${item}</div></li>
              `).join('')}
            </ul>
          </div>
          <div>
            <div class="impl-col-title">WHAT TO DO</div>
            <ul class="impl-list">
              ${(data.whatToDo || []).map(item => `
                <li><div class="icon">${icons.traffic}</div><div>${item}</div></li>
              `).join('')}
            </ul>
          </div>
        </div>
      </div>
      
      <div class="monitoring-box">
        <div class="monitoring-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="28" height="28"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        </div>
        <div class="monitoring-content">
          <div class="monitoring-title">STILL MONITORING</div>
          <div class="monitoring-text">${data.stillMonitoring || ''}</div>
        </div>
      </div>
    </div>
    
    <!-- RIGHT COLUMN -->
    <div class="right-col">
      <div class="dark-header-box">
        <div class="dark-header">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="24" height="24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          WATCHLIST
        </div>
        <div class="watchlist-content">
          ${(data.watchlist || []).map((wl, idx) => `
            <div class="watchlist-item">
              <div class="watchlist-icon-area">
                <svg viewBox="0 0 24 24" fill="none" stroke="#064E3B" stroke-width="2" width="40" height="40"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
              </div>
              <div class="wl-content">
                <div class="wl-num">${idx + 1}</div>
                <div class="wl-title" style="margin-top: 10px;">${wl.title}</div>
                <div class="wl-desc">${wl.description}</div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
      
      <div class="dark-header-box">
        <div class="dark-header">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="24" height="24"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
          MARKET MOVEMENT SNAPSHOT
        </div>
        <div class="snapshot-content">
          ${(data.marketSnapshot || []).map(snap => `
            <div class="snap-item">
              <div class="snap-title">${snap.title}</div>
              <div class="snap-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="24" height="24"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></div>
              <div class="snap-val">${snap.value}</div>
              <div class="snap-change">${snap.change}</div>
            </div>
          `).join('')}
        </div>
        <div style="font-size: 12px; color: #6B7280; text-align: center; font-style: italic; padding-bottom: 15px;">Indicative market snapshot; basis differs by source and market.</div>
      </div>
      
      <div class="sources-box">
        <div class="sources-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="28" height="28"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
        </div>
        <div class="sources-content">
          <div class="sources-title">SOURCES</div>
          <div class="sources-list">${(data.sourceLinks || []).join(' | ')}</div>
        </div>
      </div>
    </div>
    
  </div>

  <!-- FOOTER -->
  <div class="footer">
    <div class="footer-left">
      <strong>GYS STEEL SIGNAL</strong>
      <span>|</span>
      From data to decision. From signal to action.
    </div>
    <div class="footer-right">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      ${dateStr.split(',')[0]} ${dateStr.split(',')[1]} | ${timeStr}
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
    await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 2 });
    
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
