import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';
import axios from 'axios';

export default {
  /**
   * Fetch L2 Production Report Data from OpenClaw API
   */
  async fetchProductionReport(fromDate, toDate) {
    try {
      const url = `https://prd-api.gyssteel.com/openclaw/production-report?from_date=${fromDate}&to_date=${toDate}`;
      console.log(`[OPENCLAW] Fetching data from: ${url}`);
      
      const response = await axios.get(url, { timeout: 30000 });
      return response.data;
    } catch (error) {
      console.error('[OPENCLAW] API Error:', error.message);
      throw new Error(`Failed to fetch OpenClaw report: ${error.message}`);
    }
  },

  /**
   * Generate PNG Image from Production Data (McKenzie Style)
   */
  async generateReportImage({ data, outputDir, fromDate, toDate, aiAnalysis }) {
    const filename = `OpenClaw-L2-${Date.now()}.png`;
    const filepath = path.join(outputDir, filename);

    // Format dates
    const now = new Date();
    const generatedTime = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
      + ' \u00b7 ' + now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) + ' WIB';

    const fromDateObj = new Date(fromDate);
    const toDateObj   = new Date(toDate);
    const fromDateStr = fromDateObj.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    const toDateStr   = toDateObj.toLocaleDateString('en-GB',   { day: 'numeric', month: 'long', year: 'numeric' });
    const dateRangeLabel = fromDate === toDate
      ? fromDateStr
      : `${fromDateObj.getDate()} - ${toDateStr}`;

    // Logo
    const logoPath     = path.join(process.cwd(), 'assets', 'gys-logo.webp');
    const logoPathAlt  = path.join(process.cwd(), 'data', 'gys-logo.webp');
    const logoPathAlt2 = path.join(process.cwd(), '../client/public/assets/gys-logo.webp');
    const logoPathAlt3 = path.join(process.cwd(), 'server', 'assets', 'gys-logo.webp');
    let logoBase64 = '';
    const resolvedLogoPath = fs.existsSync(logoPath) ? logoPath
      : fs.existsSync(logoPathAlt) ? logoPathAlt
      : fs.existsSync(logoPathAlt2) ? logoPathAlt2
      : fs.existsSync(logoPathAlt3) ? logoPathAlt3
      : null;
    if (resolvedLogoPath) {
      const logoBuf = fs.readFileSync(resolvedLogoPath);
      logoBase64 = 'data:image/webp;base64,' + logoBuf.toString('base64');
    }

    // OpenClaw Logo
    let openClawLogoBase64 = '';
    const openClawLogoPath = path.join(process.cwd(), 'server', 'assets', 'openclaw-seeklogo.png');
    if (fs.existsSync(openClawLogoPath)) {
      const ocLogoBuf = fs.readFileSync(openClawLogoPath);
      openClawLogoBase64 = 'data:image/png;base64,' + ocLogoBuf.toString('base64');
    }

    // Data Processing
    const items = data?.data || [];
    let totalRawTon = 0;
    let totalProdTon = 0;
    let totalPieces = 0;
    let totalConsumption = 0;

    items.forEach(item => {
      totalRawTon     += parseFloat(item.raw_material_ton || 0);
      totalProdTon    += parseFloat(item.production_ton || 0);
      totalPieces     += parseInt(item.production_pcs || 0);
      totalConsumption += parseInt(item.total_consumption || 0);
    });

    const avgYield = totalRawTon > 0 ? (totalProdTon / totalRawTon) * 100 : 0;

    // Table Rows
    let tableRowsHtml = '';
    if (items.length === 0) {
      tableRowsHtml = '<tr><td colspan="10" style="text-align:center; padding: 30px;">No production data available for this date range.</td></tr>';
    } else {
      items.forEach((item, index) => {
        const yieldVal  = parseFloat(item.yield_percentage);
        const yieldColor = yieldVal > 100 ? '#1D4ED8' : yieldVal >= 97 ? '#059669' : '#D97706';
        const delayColor = parseInt(item.total_delay_seconds) > 300 ? '#DC2626'
          : parseInt(item.total_delay_seconds) > 100 ? '#D97706' : '#059669';

        const dateObj = new Date(item.production_date);
        const dateStr = isNaN(dateObj.getTime())
          ? item.production_date
          : dateObj.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

        tableRowsHtml += `
          <tr>
            <td style="text-align:center;">${index + 1}</td>
            <td><strong>${item.order_no}</strong><br><span style="font-size:11px;color:#6B7280;">${dateStr}</span></td>
            <td>${item.description}</td>
            <td style="text-align:right;">${item.raw_material_pcs}</td>
            <td style="text-align:right;">${item.raw_material_ton}</td>
            <td style="text-align:right;">${item.production_ton}</td>
            <td style="text-align:right;">${item.production_pcs}</td>
            <td style="text-align:right;font-weight:bold;color:${yieldColor};">${yieldVal}%</td>
            <td style="text-align:right;"><span style="color:${delayColor};margin-right:4px;">&#9679;</span>${item.total_delay_seconds}</td>
            <td style="text-align:right;">${item.total_consumption}</td>
          </tr>`;
      });
    }

    // Bar Charts
    let barChartHtml = '';
    let yieldChartHtml = '';
    const maxProdTon = Math.max(...items.map(i => parseFloat(i.production_ton || 0)), 1);

    items.forEach(item => {
      const prodTon  = parseFloat(item.production_ton || 0);
      const widthPct = (prodTon / maxProdTon) * 100;
      const dateObj  = new Date(item.production_date);
      const dateStr  = isNaN(dateObj.getTime())
        ? item.production_date
        : dateObj.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

      const color = item.description.includes('SS 400') ? '#0D5C46'
        : item.description.includes('SN 490') ? '#10B981' : '#3B82F6';

      barChartHtml += `
        <div style="display:flex;align-items:center;margin-bottom:8px;">
          <div style="width:140px;font-size:11px;color:#4B5563;">${dateStr} - #${item.order_no.slice(-5)}</div>
          <div style="flex:1;display:flex;align-items:center;">
            <div style="height:14px;background-color:${color};width:${widthPct}%;"></div>
            <div style="margin-left:10px;font-size:11px;font-weight:600;">${prodTon}</div>
          </div>
        </div>`;

      const yieldVal   = parseFloat(item.yield_percentage || 0);
      const yieldWidth = Math.min((yieldVal / 120) * 100, 100);
      const yieldColor = yieldVal > 100 ? '#1D4ED8' : yieldVal >= 97 ? '#059669' : '#D97706';
      const benchmarkPct = ((100 / 120) * 100).toFixed(2);

      yieldChartHtml += `
        <div style="display:flex;align-items:center;margin-bottom:8px;">
          <div style="width:140px;font-size:11px;color:#4B5563;">#${item.order_no.slice(-5)} - ${dateStr}</div>
          <div style="flex:1;position:relative;height:14px;">
            <div style="position:absolute;left:0;top:0;height:100%;background-color:${yieldColor};width:${yieldWidth}%;"></div>
            <div style="position:absolute;left:${benchmarkPct}%;top:-2px;bottom:-2px;width:2px;background-color:#EF4444;opacity:0.5;"></div>
          </div>
          <div style="width:50px;text-align:right;font-size:11px;font-weight:600;color:${yieldColor};">${yieldVal}%</div>
        </div>`;
    });

    // Key Observations
    const dummy = { yield_percentage: 0, order_no: '0000000000' };
    const highestYield = items.length > 0
      ? items.reduce((max, i) => parseFloat(i.yield_percentage) > parseFloat(max.yield_percentage) ? i : max, items[0])
      : dummy;
    const lowestYield = items.length > 0
      ? items.reduce((min, i) => parseFloat(i.yield_percentage) < parseFloat(min.yield_percentage) ? i : min, items[0])
      : dummy;

    let basicObservations = `Production across ${dateRangeLabel} totalled <strong>${totalProdTon.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MT</strong> across ${items.length} orders. `;
    if (items.length > 0) {
      if (parseFloat(highestYield.yield_percentage) > 100) {
        basicObservations += `Order <strong>#${highestYield.order_no.slice(-5)}</strong> recorded an anomalous over-yield of ${highestYield.yield_percentage}% &mdash; data verification recommended. `;
      }
      if (parseFloat(lowestYield.yield_percentage) < 97) {
        basicObservations += `Order <strong>#${lowestYield.order_no.slice(-5)}</strong> fell below the 97% threshold (${lowestYield.yield_percentage}%); root cause analysis advised.`;
      }
    }

    let analyticalHtml = '<div style="color:#9CA3AF;font-size:12px;font-style:italic;">No AI analysis generated.</div>';
    if (aiAnalysis) {
      analyticalHtml = aiAnalysis
        .replace(/### (.*)/g, '<div class="ar-section-title">$1</div>')
        .replace(/## (.*)/g, '<div class="ar-highlight">$1</div>')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\n\n/g, '<div class="ar-spacing"></div>')
        .replace(/\n/g, '<br>');
    }

    const logoHtml = logoBase64
      ? `<img src="${logoBase64}" alt="Logo" style="height:40px;max-width:120px;object-fit:contain;" />`
      : '<div style="font-size:20px;font-weight:bold;color:#0D5C46;">GYS</div>';

    const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>L2 Production Report</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
    body { margin:0;padding:0;font-family:'Inter',sans-serif;background:#F8FAF9;color:#1F2937;width:1600px;min-height:900px;box-sizing:border-box; }
    .header-bg { background-color:#0D5C46;height:110px;padding:0 50px;display:flex;justify-content:space-between;align-items:center;position:relative; }
    .header-bg::after { content:'';position:absolute;bottom:0;left:0;right:0;height:6px;background-color:#D4AF37; }
    .logo-box { background:white;padding:12px 20px;border-radius:4px;box-shadow:0 4px 6px rgba(0,0,0,0.1);display:flex;align-items:center;justify-content:center;height:44px; }
    .header-text { text-align:right;color:white; }
    .header-text .subtitle { font-size:11px;text-transform:uppercase;letter-spacing:2px;color:#A7F3D0;margin-bottom:5px; }
    .header-text h1 { margin:0;font-size:30px;font-weight:300;letter-spacing:-0.5px; }
    .header-text h1 strong { font-weight:700; }
    .header-text .date { font-size:13px;color:#D1FAE5;margin-top:6px; }
    .content { padding:40px 50px; }
    .kpi-row { display:flex;gap:16px;margin-bottom:36px; }
    .kpi-card { flex:1;background:white;border-top:3px solid #0D5C46;padding:18px;box-shadow:0 1px 3px rgba(0,0,0,0.06); }
    .kpi-card.hl { background:#0D5C46;color:white;border-top-color:#D4AF37; }
    .kpi-title { font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#6B7280;margin-bottom:12px; }
    .kpi-card.hl .kpi-title { color:#A7F3D0; }
    .kpi-value { font-size:34px;font-weight:300;color:#111827;margin-bottom:4px; }
    .kpi-card.hl .kpi-value { color:white;font-weight:600; }
    .kpi-desc { font-size:11px;color:#9CA3AF; }
    .kpi-card.hl .kpi-desc { color:#D1FAE5; }
    .section-hdr { display:flex;justify-content:space-between;align-items:center;margin-bottom:12px; }
    .section-hdr h2 { margin:0;font-size:17px;color:#0D5C46;font-weight:600;border-left:5px solid #0D5C46;padding-left:10px; }
    .section-hdr .rec { font-size:11px;color:#6B7280;text-transform:uppercase;letter-spacing:1px; }
    table { width:100%;border-collapse:collapse;background:white;margin-bottom:36px;font-size:12px;box-shadow:0 1px 3px rgba(0,0,0,0.06); }
    th { background:#0D5C46;color:white;padding:11px 14px;text-align:left;font-weight:600;text-transform:uppercase;font-size:10px;letter-spacing:0.5px; }
    td { padding:11px 14px;border-bottom:1px solid #E5E7EB;color:#374151; }
    tr:nth-child(even) { background:#F9FAFB; }
    .charts-row { display:flex;gap:24px;margin-bottom:28px; }
    .chart-card { background:white;border:1px solid #E5E7EB;padding:22px;box-shadow:0 1px 3px rgba(0,0,0,0.05); }
    .chart-title { font-size:13px;color:#0D5C46;font-weight:600;margin-bottom:20px; }
    .obs { background:#ECFDF5;border-left:4px solid #10B981;padding:18px;display:flex;gap:14px;box-shadow:0 1px 3px rgba(0,0,0,0.05); margin-bottom:24px; }
    .obs-icon { font-size:22px;flex-shrink:0; }
    .obs-text { font-size:12px;color:#065F46;line-height:1.7; }

    .bottom-row { display:flex; gap:24px; margin-bottom:28px; }
    .left-col { flex:0 0 45%; display:flex; flex-direction:column; gap:24px; }
    .right-col { flex:1; background:white; border:1px solid #E5E7EB; border-top:4px solid #0D5C46; padding:24px; box-shadow:0 1px 3px rgba(0,0,0,0.05); }
    
    .ar-label { font-size:10px; color:white; background:#0D5C46; padding:4px 8px; display:inline-block; font-weight:700; letter-spacing:1px; margin-bottom:12px; }
    .ar-title { font-size:18px; color:#111827; font-weight:800; letter-spacing:-0.5px; text-transform:uppercase; margin-bottom:4px; }
    .ar-subtitle { font-size:11px; color:#6B7280; margin-bottom:24px; border-bottom:1px solid #E5E7EB; padding-bottom:12px; }
    
    .ar-section-title { font-size:11px; font-weight:700; color:#0D5C46; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:6px; background:#ECFDF5; padding:6px 10px; display:inline-block; border-radius:4px; }
    .ar-highlight { font-size:16px; color:#1D4ED8; font-weight:700; margin-bottom:4px; margin-top:2px; }
    .ar-spacing { height: 16px; }
    .ar-content { font-size:12px; color:#374151; line-height:1.6; }
    
    .footer { background:#0D5C46;color:#A7F3D0;padding:18px 50px;display:flex;justify-content:space-between;font-size:10px;margin-top:auto; }
    .footer strong { color:#D4AF37; }
  </style>
</head>
<body>

  <div class="header-bg">
    <div class="logo-box">${logoHtml}</div>
    <div class="header-text" style="flex:1; margin-right: 30px;">
      <div class="subtitle">OPERATIONS INTELLIGENCE &middot; STEEL DIVISION</div>
      <h1>L2 Production <strong>Report</strong></h1>
      <div class="date">Rolling Mill Performance &middot; ${dateRangeLabel}</div>
    </div>
    ${openClawLogoBase64 ? `<img src="${openClawLogoBase64}" style="height:48px; object-fit:contain; filter: brightness(0) invert(1) opacity(0.9);" />` : ''}
  </div>

  <div class="content">

    <div class="kpi-row">
      <div class="kpi-card">
        <div class="kpi-title">TOTAL INPUT</div>
        <div class="kpi-value">${totalRawTon.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
        <div class="kpi-desc">Metric Tons Raw Material</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-title">TOTAL OUTPUT</div>
        <div class="kpi-value">${totalProdTon.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
        <div class="kpi-desc">Metric Tons Produced</div>
      </div>
      <div class="kpi-card hl">
        <div class="kpi-title">AVG. YIELD</div>
        <div class="kpi-value">${avgYield.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%</div>
        <div class="kpi-desc">Weighted Production Yield</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-title">TOTAL PIECES</div>
        <div class="kpi-value">${totalPieces.toLocaleString()}</div>
        <div class="kpi-desc">Finished Pieces Produced</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-title">TOTAL CONSUMPTION</div>
        <div class="kpi-value">${totalConsumption.toLocaleString()}</div>
        <div class="kpi-desc">Energy / Fuel Units</div>
      </div>
    </div>

    <div class="section-hdr">
      <h2>Production Order Detail</h2>
      <div class="rec">${items.length} RECORDS &middot; ${dateRangeLabel.toUpperCase()}</div>
    </div>

    <table>
      <thead>
        <tr>
          <th style="text-align:center;">#</th>
          <th>ORDER NO.</th>
          <th>PRODUCT DESCRIPTION</th>
          <th style="text-align:right;">RM (PCS)</th>
          <th style="text-align:right;">RM (TON)</th>
          <th style="text-align:right;">OUTPUT (TON)</th>
          <th style="text-align:right;">OUTPUT (PCS)</th>
          <th style="text-align:right;">YIELD %</th>
          <th style="text-align:right;">DELAY (S)</th>
          <th style="text-align:right;">CONSUMPTION</th>
        </tr>
      </thead>
      <tbody>${tableRowsHtml}</tbody>
    </table>

    <div class="obs">
      <div class="obs-icon">&#128203;</div>
      <div class="obs-text"><strong>Key Observations:</strong> ${basicObservations}</div>
    </div>

    <div class="bottom-row">
      <div class="left-col">
        <div class="chart-card">
          <div class="chart-title">Production Output by Order (Metric Tons)</div>
          ${barChartHtml || '<div style="color:#9CA3AF;font-size:12px;">No data</div>'}
        </div>
        <div class="chart-card">
          <div class="chart-title">Yield Performance vs. 100% Benchmark</div>
          <div style="margin-bottom:10px;font-size:10px;color:#6B7280;text-align:right;">Target &ge; 97.0% (Red line = 100%)</div>
          ${yieldChartHtml || '<div style="color:#9CA3AF;font-size:12px;">No data</div>'}
        </div>
      </div>
      
      <div class="right-col">
        <div class="ar-label">ANALYTICAL REPORT</div>
        <div class="ar-title">PRODUCTION PERFORMANCE ANALYSIS</div>
        <div class="ar-subtitle">Period: ${dateRangeLabel} &middot; L2 Rolling Mill</div>
        <div class="ar-content">
          ${analyticalHtml}
        </div>
      </div>
    </div>

  </div>

  <div class="footer">
    <div>
      PT Garuda Yamato Steel &middot; L2 Production System<br>
      Report Generated: ${generatedTime} &middot; Data: ${dateRangeLabel}<br>
      <strong>PRIVATE &amp; CONFIDENTIAL</strong>
    </div>
    <div style="text-align:right;">
      Page 1 of 1 &middot; ${items.length} Records<br>
      Source: L2 Production API &middot; /production-report<br>
      Member of Yamato Group
    </div>
  </div>

</body>
</html>`;

    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 2 });
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
    await page.screenshot({ path: filepath, fullPage: true, type: 'png' });
    await browser.close();

    return {
      fileUrl: `/api/files/${filename}`,
      fileName: filename,
    };
  }
};
