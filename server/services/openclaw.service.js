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
   * Generate PNG Image from Production Data
   */
  async generateReportImage({ data, outputDir, fromDate, toDate }) {
    const filename = `OpenClaw-L2-${Date.now()}.png`;
    const filepath = path.join(outputDir, filename);

    // Format current date and time
    const now = new Date();
    const generatedTime = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) + ' · ' + now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) + ' WIB';

    const fromDateStr = new Date(fromDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    const toDateStr = new Date(toDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    const dateRangeLabel = fromDate === toDate ? fromDateStr : `${new Date(fromDate).getDate()} - ${toDateStr}`;

    // Logo
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
    }

    // Data Processing
    const items = data?.data || [];
    let totalRawTon = 0;
    let totalProdTon = 0;
    let totalPieces = 0;
    let totalConsumption = 0;
    
    items.forEach(item => {
      totalRawTon += parseFloat(item.raw_material_ton || 0);
      totalProdTon += parseFloat(item.production_ton || 0);
      totalPieces += parseInt(item.production_pcs || 0);
      totalConsumption += parseInt(item.total_consumption || 0);
    });

    const avgYield = totalRawTon > 0 ? (totalProdTon / totalRawTon) * 100 : 0;

    // Generate Table Rows
    let tableRowsHtml = '';
    if (items.length === 0) {
      tableRowsHtml = `<tr><td colspan="10" style="text-align:center; padding: 30px;">No production data available for this date range.</td></tr>`;
    } else {
      items.forEach((item, index) => {
        const yieldVal = parseFloat(item.yield_percentage);
        let yieldColor = yieldVal > 100 ? '#1D4ED8' : yieldVal >= 97 ? '#059669' : '#D97706';
        let delayColor = parseInt(item.total_delay_seconds) > 300 ? '#DC2626' : parseInt(item.total_delay_seconds) > 100 ? '#D97706' : '#059669';
        
        let dateObj = new Date(item.production_date);
        let dateStr = isNaN(dateObj) ? item.production_date : dateObj.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

        tableRowsHtml += `
          <tr>
            <td style="text-align:center;">${index + 1}</td>
            <td><strong>${item.order_no}</strong><br><span style="font-size:11px; color:#6B7280;">${dateStr}</span></td>
            <td>${item.description}</td>
            <td style="text-align: right;">${item.raw_material_pcs}</td>
            <td style="text-align: right;">${item.raw_material_ton}</td>
            <td style="text-align: right;">${item.production_ton}</td>
            <td style="text-align: right;">${item.production_pcs}</td>
            <td style="text-align: right; font-weight: bold; color: ${yieldColor};">${yieldVal}%</td>
            <td style="text-align: right;"><span style="color:${delayColor}; margin-right:4px;">●</span> ${item.total_delay_seconds}</td>
            <td style="text-align: right;">${item.total_consumption}</td>
          </tr>
        `;
      });
    }

    // Generate Chart Data
    let barChartHtml = '';
    let yieldChartHtml = '';
    const maxProdTon = Math.max(...items.map(i => parseFloat(i.production_ton || 0)), 1);
    
    items.forEach((item, index) => {
      const prodTon = parseFloat(item.production_ton || 0);
      const widthPct = (prodTon / maxProdTon) * 100;
      let dateObj = new Date(item.production_date);
      let dateStr = isNaN(dateObj) ? item.production_date : dateObj.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      
      const isSS400 = item.description.includes('SS 400');
      const isSN490 = item.description.includes('SN 490');
      const color = isSS400 ? '#0D5C46' : isSN490 ? '#10B981' : '#3B82F6';

      barChartHtml += `
        <div style="display: flex; align-items: center; margin-bottom: 8px;">
          <div style="width: 140px; font-size: 11px; color: #4B5563;">${dateStr} - #${item.order_no.slice(-5)}</div>
          <div style="flex: 1; display: flex; align-items: center;">
            <div style="height: 14px; background-color: ${color}; width: ${widthPct}%;"></div>
            <div style="margin-left: 10px; font-size: 11px; font-weight: 600;">${prodTon}</div>
          </div>
        </div>
      `;

      const yieldVal = parseFloat(item.yield_percentage || 0);
      const yieldWidth = Math.min((yieldVal / 120) * 100, 100); // Scale up to 120%
      const yieldColor = yieldVal > 100 ? '#1D4ED8' : yieldVal >= 97 ? '#059669' : '#D97706';

      yieldChartHtml += `
        <div style="display: flex; align-items: center; margin-bottom: 8px;">
          <div style="width: 140px; font-size: 11px; color: #4B5563;">#${item.order_no.slice(-5)} - ${dateStr}</div>
          <div style="flex: 1; position: relative; height: 14px;">
            <div style="position: absolute; left: 0; top: 0; height: 100%; background-color: ${yieldColor}; width: ${yieldWidth}%;"></div>
            <div style="position: absolute; left: ${(100/120)*100}%; top: -2px; bottom: -2px; width: 2px; background-color: #EF4444; opacity: 0.5;"></div>
          </div>
          <div style="width: 50px; text-align: right; font-size: 11px; font-weight: 600; color: ${yieldColor};">${yieldVal}%</div>
        </div>
      `;
    });

    // Key Observations
    let highestYield = items.reduce((max, i) => parseFloat(i.yield_percentage) > parseFloat(max.yield_percentage) ? i : max, items[0] || {yield_percentage:0});
    let lowestYield = items.reduce((min, i) => parseFloat(i.yield_percentage) < parseFloat(min.yield_percentage) ? i : min, items[0] || {yield_percentage:0});
    let observations = `Production across ${dateRangeLabel} totalled <strong>${totalProdTon.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})} MT</strong> across ${items.length} orders. `;
    if (items.length > 0) {
      if (parseFloat(highestYield.yield_percentage) > 100) {
        observations += `Order <strong>#${highestYield.order_no.slice(-5)}</strong> recorded an anomalous over-yield of ${highestYield.yield_percentage}% &mdash; data verification recommended. `;
      }
      if (parseFloat(lowestYield.yield_percentage) < 97) {
        observations += `Order <strong>#${lowestYield.order_no.slice(-5)}</strong> fell below the 97% threshold (${lowestYield.yield_percentage}%); root cause analysis advised.`;
      }
    }

    const htmlContent = \`
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>L2 Production Report</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
    
    body {
      margin: 0; padding: 0;
      font-family: 'Inter', sans-serif;
      background-color: #F8FAF9; /* Very light gray/green */
      color: #1F2937;
      width: 1400px;
      min-height: 900px;
      box-sizing: border-box;
    }
    
    .header-bg {
      background-color: #0D5C46; /* Deep Teal */
      height: 110px;
      padding: 0 50px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      position: relative;
    }
    .header-bg::after {
      content: '';
      position: absolute;
      bottom: 0; left: 0; right: 0;
      height: 6px;
      background-color: #D4AF37; /* Gold */
    }
    
    .logo-container {
      background: white;
      padding: 15px 25px;
      border-radius: 4px;
      margin-top: 40px;
      box-shadow: 0 4px 6px rgba(0,0,0,0.1);
      display: inline-block;
      height: 40px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .logo-container img { height: 40px; max-width: 120px; object-fit: contain; }
    
    .header-text {
      text-align: right;
      color: white;
      margin-top: 20px;
    }
    .header-text .subtitle {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 2px;
      color: #A7F3D0;
      margin-bottom: 5px;
    }
    .header-text h1 {
      margin: 0;
      font-size: 32px;
      font-weight: 300;
      letter-spacing: -0.5px;
    }
    .header-text h1 strong { font-weight: 700; }
    .header-text .date {
      font-size: 13px;
      color: #D1FAE5;
      margin-top: 8px;
    }
    
    .content { padding: 50px; }
    
    .kpi-row {
      display: flex; gap: 20px;
      margin-bottom: 40px;
    }
    .kpi-card {
      flex: 1;
      background: white;
      border-top: 3px solid #0D5C46;
      padding: 20px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    }
    .kpi-card.highlight {
      background: #0D5C46;
      color: white;
      border-top-color: #D4AF37;
    }
    .kpi-title {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: #6B7280;
      margin-bottom: 15px;
    }
    .kpi-card.highlight .kpi-title { color: #A7F3D0; }
    .kpi-value {
      font-size: 36px;
      font-weight: 300;
      color: #111827;
      margin-bottom: 5px;
    }
    .kpi-card.highlight .kpi-value { color: white; font-weight: 600; }
    .kpi-desc {
      font-size: 11px;
      color: #9CA3AF;
    }
    .kpi-card.highlight .kpi-desc { color: #D1FAE5; }
    
    .section-title {
      display: flex; justify-content: space-between; align-items: center;
      margin-bottom: 15px;
    }
    .section-title h2 {
      margin: 0;
      font-size: 18px;
      color: #0D5C46;
      font-weight: 600;
      border-left: 5px solid #0D5C46;
      padding-left: 10px;
    }
    .section-title .records {
      font-size: 11px;
      color: #6B7280;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    
    table {
      width: 100%; border-collapse: collapse;
      background: white; margin-bottom: 40px;
      font-size: 12px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    }
    th {
      background: #0D5C46;
      color: white;
      padding: 12px 15px;
      text-align: left;
      font-weight: 600;
      text-transform: uppercase;
      font-size: 10px;
      letter-spacing: 0.5px;
    }
    td {
      padding: 12px 15px;
      border-bottom: 1px solid #E5E7EB;
      color: #374151;
    }
    tr:nth-child(even) { background: #F9FAFB; }
    
    .charts-row {
      display: flex; gap: 30px; margin-bottom: 30px;
    }
    .chart-card {
      flex: 1; background: white;
      border: 1px solid #E5E7EB;
      padding: 25px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    }
    .chart-title {
      font-size: 14px; color: #0D5C46; font-weight: 600;
      margin-bottom: 25px;
    }
    
    .observations {
      background: #ECFDF5;
      border-left: 4px solid #10B981;
      padding: 20px;
      display: flex; gap: 15px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    }
    .obs-icon { font-size: 24px; }
    .obs-text {
      font-size: 12px; color: #065F46; line-height: 1.6;
    }
    
    .footer {
      background: #0D5C46;
      color: #A7F3D0;
      padding: 20px 50px;
      display: flex; justify-content: space-between;
      font-size: 10px;
    }
    .footer-left strong { color: #D4AF37; }
    
  </style>
</head>
<body>

  <div class="header-bg">
    <div class="logo-container">
      \${logoBase64 ? \`<img src="\${logoBase64}" alt="Logo" />\` : '<div style="font-size: 20px; font-weight: bold; color: #0D5C46;">GYS</div>'}
    </div>
    <div class="header-text">
      <div class="subtitle">OPERATIONS INTELLIGENCE &middot; STEEL DIVISION</div>
      <h1>L2 Production <strong>Report</strong></h1>
      <div class="date">Rolling Mill Performance &middot; \${dateRangeLabel}</div>
    </div>
  </div>

  <div class="content">
    <div class="kpi-row">
      <div class="kpi-card">
        <div class="kpi-title">TOTAL INPUT</div>
        <div class="kpi-value">\${totalRawTon.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}</div>
        <div class="kpi-desc">Metric Tons Raw Material</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-title">TOTAL OUTPUT</div>
        <div class="kpi-value">\${totalProdTon.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}</div>
        <div class="kpi-desc">Metric Tons Produced</div>
      </div>
      <div class="kpi-card highlight">
        <div class="kpi-title">AVG. YIELD</div>
        <div class="kpi-value">\${avgYield.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}%</div>
        <div class="kpi-desc">Weighted Production Yield</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-title">TOTAL PIECES</div>
        <div class="kpi-value">\${totalPieces.toLocaleString()}</div>
        <div class="kpi-desc">Finished Pieces Produced</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-title">TOTAL CONSUMPTION</div>
        <div class="kpi-value">\${totalConsumption.toLocaleString()}</div>
        <div class="kpi-desc">Energy / Fuel Units</div>
      </div>
    </div>

    <div class="section-title">
      <h2>Production Order Detail</h2>
      <div class="records">\${items.length} RECORDS &middot; \${dateRangeLabel.toUpperCase()}</div>
    </div>
    
    <table>
      <thead>
        <tr>
          <th style="text-align:center;">#</th>
          <th>ORDER NO.</th>
          <th>PRODUCT DESCRIPTION</th>
          <th style="text-align: right;">RM (PCS)</th>
          <th style="text-align: right;">RM (TON)</th>
          <th style="text-align: right;">OUTPUT (TON)</th>
          <th style="text-align: right;">OUTPUT (PCS)</th>
          <th style="text-align: right;">YIELD %</th>
          <th style="text-align: right;">DELAY (S)</th>
          <th style="text-align: right;">CONSUMPTION</th>
        </tr>
      </thead>
      <tbody>
        \${tableRowsHtml}
      </tbody>
    </table>

    <div class="charts-row">
      <div class="chart-card">
        <div class="chart-title">Production Output by Order (Metric Tons)</div>
        \${barChartHtml || '<div style="color:#9CA3AF; font-size:12px;">No data</div>'}
      </div>
      <div class="chart-card">
        <div class="chart-title">Yield Performance vs. 100% Benchmark</div>
        <div style="margin-bottom:10px; font-size:10px; color:#6B7280; text-align:right;">Target &ge; 97.0% (Red line marks 100%)</div>
        \${yieldChartHtml || '<div style="color:#9CA3AF; font-size:12px;">No data</div>'}
      </div>
    </div>

    <div class="observations">
      <div class="obs-icon">📋</div>
      <div class="obs-text">
        <strong>Key Observations:</strong> \${observations}
      </div>
    </div>

  </div>

  <div class="footer">
    <div class="footer-left">
      PT Garuda Yamato Steel &middot; L2 Production System<br>
      Report Generated: \${generatedTime} &middot; Data: \${dateRangeLabel}<br>
      <strong>PRIVATE &amp; CONFIDENTIAL</strong>
    </div>
    <div style="text-align: right;">
      Page 1 of 1 &middot; \${items.length} Records<br>
      Source: L2 Production API &middot; /production-report<br>
      Member of Yamato Group
    </div>
  </div>

</body>
</html>
    \`;

    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    
    // Set viewport wide enough; height will be determined by content (fullPage)
    await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 2 });
    
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
    
    // Take full-page screenshot
    await page.screenshot({ path: filepath, fullPage: true, type: 'png' });

    await browser.close();

    return {
      fileUrl: `/api/files/${filename}`,
      fileName: filename,
    };
  }
};
