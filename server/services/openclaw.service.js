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
    const generatedTime = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) + ' ' + now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) + ' WIB';

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

    // Prepare table rows from API data
    const items = data?.data || [];
    let tableRowsHtml = '';
    let totalRawTon = 0;
    let totalProdTon = 0;

    if (items.length === 0) {
      tableRowsHtml = `<tr><td colspan="9" style="text-align:center; padding: 30px;">No production data available for this date range.</td></tr>`;
    } else {
      items.forEach(item => {
        totalRawTon += parseFloat(item.raw_material_ton || 0);
        totalProdTon += parseFloat(item.production_ton || 0);
        
        tableRowsHtml += `
          <tr>
            <td>${item.rn}</td>
            <td>${item.order_no}</td>
            <td>${item.description}</td>
            <td style="text-align: right;">${item.raw_material_pcs}</td>
            <td style="text-align: right;">${item.raw_material_ton}</td>
            <td style="text-align: right;">${item.production_pcs}</td>
            <td style="text-align: right;">${item.production_ton}</td>
            <td style="text-align: right; font-weight: bold; color: ${parseFloat(item.yield_percentage) > 95 ? '#059669' : '#DC2626'};">${item.yield_percentage}%</td>
            <td style="text-align: center;">${item.total_delay_seconds}s</td>
          </tr>
        `;
      });
    }

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>L2 Production Report</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
    
    body {
      margin: 0;
      padding: 0;
      font-family: 'Inter', sans-serif;
      background-color: #F3F4F6;
      color: #1F2937;
      width: 1400px;
      min-height: 800px;
      height: auto;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
    }
    
    .header {
      background: linear-gradient(135deg, #1E3A8A 0%, #1D4ED8 100%);
      color: white;
      padding: 30px 50px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 6px solid #F59E0B;
    }
    
    .logo-container {
      display: flex;
      align-items: center;
      gap: 20px;
    }
    
    .logo-container img {
      height: 60px;
    }
    
    .title-block h1 {
      margin: 0;
      font-size: 36px;
      font-weight: 800;
      letter-spacing: -0.5px;
    }
    
    .title-block p {
      margin: 5px 0 0 0;
      font-size: 18px;
      color: #93C5FD;
    }
    
    .date-badge {
      background: rgba(255, 255, 255, 0.2);
      padding: 10px 20px;
      border-radius: 8px;
      text-align: right;
    }
    
    .date-badge .label {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: #DBEAFE;
      margin-bottom: 4px;
    }
    
    .date-badge .value {
      font-size: 20px;
      font-weight: 700;
    }
    
    .main-content {
      padding: 40px 50px;
      flex: 1;
    }
    
    .summary-cards {
      display: flex;
      gap: 20px;
      margin-bottom: 30px;
    }
    
    .card {
      flex: 1;
      background: white;
      border-radius: 12px;
      padding: 20px;
      box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);
      border-left: 5px solid #3B82F6;
    }
    
    .card:nth-child(2) { border-left-color: #10B981; }
    .card:nth-child(3) { border-left-color: #F59E0B; }
    
    .card-title {
      font-size: 14px;
      color: #6B7280;
      text-transform: uppercase;
      font-weight: 600;
      margin-bottom: 10px;
    }
    
    .card-value {
      font-size: 32px;
      font-weight: 800;
      color: #111827;
    }
    
    .table-container {
      background: white;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);
    }
    
    table {
      width: 100%;
      border-collapse: collapse;
    }
    
    th {
      background: #F9FAFB;
      padding: 16px 20px;
      text-align: left;
      font-size: 13px;
      font-weight: 700;
      color: #4B5563;
      text-transform: uppercase;
      border-bottom: 1px solid #E5E7EB;
    }
    
    td {
      padding: 16px 20px;
      font-size: 15px;
      border-bottom: 1px solid #E5E7EB;
      color: #1F2937;
    }
    
    tr:last-child td {
      border-bottom: none;
    }
    
    tr:nth-child(even) {
      background: #F9FAFB;
    }
    
    .footer {
      background: #1F2937;
      color: #9CA3AF;
      padding: 20px 50px;
      display: flex;
      justify-content: space-between;
      font-size: 14px;
    }
    
  </style>
</head>
<body>

  <div class="header">
    <div class="logo-container">
      ${logoBase64 ? `<img src="${logoBase64}" alt="Logo" />` : '<div style="font-size: 24px; font-weight: bold;">GYS</div>'}
      <div class="title-block">
        <h1>L2 Production Report</h1>
        <p>OpenClaw Automated System</p>
      </div>
    </div>
    
    <div class="date-badge">
      <div class="label">Periode</div>
      <div class="value">${fromDate} to ${toDate}</div>
    </div>
  </div>

  <div class="main-content">
    
    <div class="summary-cards">
      <div class="card">
        <div class="card-title">Total Orders</div>
        <div class="card-value">${items.length}</div>
      </div>
      <div class="card">
        <div class="card-title">Total Raw Material (Ton)</div>
        <div class="card-value">${totalRawTon.toFixed(2)}</div>
      </div>
      <div class="card">
        <div class="card-title">Total Production (Ton)</div>
        <div class="card-value">${totalProdTon.toFixed(2)}</div>
      </div>
    </div>

    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>No</th>
            <th>Order No</th>
            <th>Description</th>
            <th style="text-align: right;">Raw (Pcs)</th>
            <th style="text-align: right;">Raw (Ton)</th>
            <th style="text-align: right;">Prod (Pcs)</th>
            <th style="text-align: right;">Prod (Ton)</th>
            <th style="text-align: right;">Yield</th>
            <th style="text-align: center;">Delay</th>
          </tr>
        </thead>
        <tbody>
          ${tableRowsHtml}
        </tbody>
      </table>
    </div>
    
  </div>

  <div class="footer">
    <div>Generated by <strong>GYS Portal AI Chatbot</strong></div>
    <div>Timestamp: ${generatedTime}</div>
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
    
    // Take full-page screenshot
    await page.screenshot({ path: filepath, fullPage: true, type: 'png' });

    await browser.close();

    return {
      fileUrl: `/api/files/${filename}`,
      fileName: filename,
    };
  }
};
