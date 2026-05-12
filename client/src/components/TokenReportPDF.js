// TokenReportPDF.js — Premium management-ready PDF report generator
import jsPDF from 'jspdf';
import 'jspdf-autotable';

// ── Color palette ─────────────────────────────────────────────
const C = {
  primary:    [0, 78, 54],    // #004E36  GYS deep green
  accent:     [0, 120, 87],   // #007857
  lightGreen: [72, 174, 146], // #48AE92
  dark:       [30, 30, 35],
  white:      [255, 255, 255],
  offWhite:   [247, 248, 250],
  gray:       [156, 163, 175],
  lightGray:  [229, 231, 235],
  blue:       [59, 130, 246],
  violet:     [139, 92, 246],
  amber:      [245, 158, 11],
  emerald:    [16, 185, 129],
  rose:       [244, 63, 94],
};

const fmt = (n) => (n || 0).toLocaleString('en-US');
const fmtUSD = (n) => (n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
const pct = (a, b) => b > 0 ? Math.round((a / b) * 100) : 0;

// ── Helpers ───────────────────────────────────────────────────
function drawRoundedRect(doc, x, y, w, h, r, fill, stroke) {
  doc.setFillColor(...fill);
  if (stroke) doc.setDrawColor(...stroke);
  doc.roundedRect(x, y, w, h, r, r, stroke ? 'FD' : 'F');
}

function drawGradientBar(doc, x, y, w, h, pctVal, color) {
  // Background
  doc.setFillColor(229, 231, 235);
  doc.roundedRect(x, y, w, h, h / 2, h / 2, 'F');
  // Fill
  if (pctVal > 0) {
    const fillW = Math.max(h, (w * pctVal) / 100);
    doc.setFillColor(...color);
    doc.roundedRect(x, y, fillW, h, h / 2, h / 2, 'F');
  }
}

function drawPieChart(doc, cx, cy, radius, data, colors) {
  if (!data || data.length === 0) return;
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return;
  let startAngle = -Math.PI / 2;
  data.forEach((d, i) => {
    const sliceAngle = (d.value / total) * 2 * Math.PI;
    const endAngle = startAngle + sliceAngle;
    doc.setFillColor(...(colors[i % colors.length]));
    // Draw pie slice using lines
    doc.setDrawColor(255, 255, 255);
    doc.setLineWidth(0.5);
    const steps = Math.max(20, Math.ceil(sliceAngle * 30));
    const points = [[cx, cy]];
    for (let j = 0; j <= steps; j++) {
      const a = startAngle + (sliceAngle * j) / steps;
      points.push([cx + radius * Math.cos(a), cy + radius * Math.sin(a)]);
    }
    // Draw filled triangle fan
    for (let j = 1; j < points.length - 1; j++) {
      doc.triangle(
        points[0][0], points[0][1],
        points[j][0], points[j][1],
        points[j + 1][0], points[j + 1][1],
        'F'
      );
    }
    startAngle = endAngle;
  });
  // Center hole (donut)
  doc.setFillColor(255, 255, 255);
  const inner = radius * 0.55;
  for (let a = 0; a < Math.PI * 2; a += 0.05) {
    doc.setFillColor(255, 255, 255);
  }
  // Simple circle fill for donut hole
  doc.setFillColor(255, 255, 255);
  doc.circle(cx, cy, inner, 'F');
}

function drawBarChart(doc, x, y, w, h, data, color) {
  if (!data || data.length === 0) return;
  const maxVal = Math.max(...data.map(d => d.value), 1);
  const barW = Math.min(8, (w - 10) / data.length - 2);
  const gap = (w - data.length * barW) / (data.length + 1);
  // Grid lines
  doc.setDrawColor(229, 231, 235);
  doc.setLineWidth(0.2);
  for (let i = 0; i <= 4; i++) {
    const ly = y + h - (h * i) / 4;
    doc.line(x, ly, x + w, ly);
  }
  // Bars
  data.forEach((d, i) => {
    const barH = (d.value / maxVal) * (h - 15);
    const bx = x + gap + i * (barW + gap);
    const by = y + h - barH;
    doc.setFillColor(...color);
    doc.roundedRect(bx, by, barW, barH, 1, 1, 'F');
    // Label
    doc.setFontSize(4.5);
    doc.setTextColor(...C.gray);
    const label = d.label.length > 5 ? d.label.substring(5) : d.label;
    doc.text(label, bx + barW / 2, y + h + 4, { align: 'center' });
  });
}

// ══════════════════════════════════════════════════════════════
// MAIN EXPORT
// ══════════════════════════════════════════════════════════════
export function generateTokenReport(tokenStats, bots, dateRange) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pw = doc.internal.pageSize.getWidth();   // 210
  const ph = doc.internal.pageSize.getHeight();   // 297
  const margin = 14;
  const contentW = pw - margin * 2;
  let curY = 0;
  const reportDate = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const reportTime = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

  // ── PAGE 1: Cover + Summary ─────────────────────────────────

  // Header banner
  drawRoundedRect(doc, 0, 0, pw, 52, 0, C.primary);
  // Decorative accent stripe
  doc.setFillColor(...C.accent);
  doc.rect(0, 48, pw, 4, 'F');

  // Title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(...C.white);
  doc.text('AI Token Usage Report', margin, 22);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(200, 230, 215);
  doc.text('GYS Portal — AI Management Console', margin, 30);

  // Date range badge
  const rangeText = dateRange.from && dateRange.to
    ? `${dateRange.from}  →  ${dateRange.to}`
    : dateRange.from ? `From ${dateRange.from}` : dateRange.to ? `Until ${dateRange.to}` : 'All Time';
  doc.setFontSize(8);
  doc.setTextColor(...C.white);
  doc.text(`Period: ${rangeText}`, margin, 39);
  doc.text(`Generated: ${reportDate} at ${reportTime}`, margin, 45);

  // Confidential badge
  doc.setFontSize(7);
  doc.setTextColor(200, 230, 215);
  doc.text('CONFIDENTIAL — FOR MANAGEMENT USE ONLY', pw - margin, 45, { align: 'right' });

  curY = 60;

  // ── Executive Summary Cards ─────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...C.dark);
  doc.text('Executive Summary', margin, curY);
  curY += 8;

  const totals = tokenStats.totals || {};
  const cards = [
    { label: 'Total Tokens', value: fmt(totals.totalTokens), sub: 'consumed', color: C.primary, icon: 'Σ' },
    { label: 'AI Responses', value: fmt(totals.messageCount), sub: 'generated', color: C.blue, icon: '💬' },
    { label: 'Est. Cost', value: fmtUSD(totals.costUSD), sub: 'USD', color: C.emerald, icon: '💵' },
    { label: 'Active Users', value: fmt((tokenStats.perUser || []).length), sub: 'users', color: C.violet, icon: '👥' },
  ];

  const cardW = (contentW - 9) / 4;
  cards.forEach((card, i) => {
    const cx = margin + i * (cardW + 3);
    drawRoundedRect(doc, cx, curY, cardW, 28, 3, C.offWhite);
    // Accent top bar
    doc.setFillColor(...card.color);
    doc.roundedRect(cx, curY, cardW, 3, 3, 3, 'F');
    doc.rect(cx, curY + 1.5, cardW, 1.5, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(...card.color);
    doc.text(card.value, cx + cardW / 2, curY + 15, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...C.gray);
    doc.text(card.label, cx + cardW / 2, curY + 22, { align: 'center' });
  });

  curY += 36;

  // ── Token Breakdown (Prompt vs Completion) ──────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...C.dark);
  doc.text('Token Breakdown', margin, curY);
  curY += 6;

  drawRoundedRect(doc, margin, curY, contentW, 22, 3, C.offWhite);

  const promptPct = pct(totals.promptTokens, totals.totalTokens);
  const completionPct = 100 - promptPct;

  // Stacked bar
  const barX = margin + 5;
  const barY = curY + 5;
  const barW = contentW - 70;
  const barH = 12;

  doc.setFillColor(...C.blue);
  doc.roundedRect(barX, barY, barW, barH, 2, 2, 'F');
  if (completionPct > 0) {
    const compW = (barW * completionPct) / 100;
    doc.setFillColor(...C.emerald);
    doc.roundedRect(barX + barW - compW, barY, compW, barH, 2, 2, 'F');
    // Fix overlap
    if (promptPct > 0 && promptPct < 100) {
      doc.setFillColor(...C.blue);
      doc.rect(barX, barY, barW - compW + 2, barH, 'F');
    }
  }

  // Labels
  const legendX = barX + barW + 5;
  doc.setFontSize(7);
  doc.setFillColor(...C.blue);
  doc.circle(legendX + 1.5, barY + 2.5, 1.5, 'F');
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...C.dark);
  doc.text(`Prompt: ${fmt(totals.promptTokens)} (${promptPct}%)`, legendX + 5, barY + 3.5);

  doc.setFillColor(...C.emerald);
  doc.circle(legendX + 1.5, barY + 9, 1.5, 'F');
  doc.text(`Completion: ${fmt(totals.completionTokens)} (${completionPct}%)`, legendX + 5, barY + 10);

  curY += 28;

  // ── Top Users Table ─────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...C.dark);
  doc.text('Top Users by Token Consumption', margin, curY);
  curY += 2;

  const perUser = (tokenStats.perUser || []).slice(0, 15);
  if (perUser.length > 0) {
    const maxUserTokens = perUser[0]?.totalTokens || 1;
    doc.autoTable({
      startY: curY,
      margin: { left: margin, right: margin },
      styles: { fontSize: 7, cellPadding: 2.5, lineColor: [229, 231, 235], lineWidth: 0.2, textColor: C.dark, font: 'helvetica' },
      headStyles: { fillColor: C.primary, textColor: C.white, fontStyle: 'bold', fontSize: 7, cellPadding: 3 },
      alternateRowStyles: { fillColor: [250, 251, 252] },
      columnStyles: {
        0: { cellWidth: 8, halign: 'center' },
        1: { cellWidth: 30 },
        2: { cellWidth: 22 },
        3: { cellWidth: 22, halign: 'right' },
        4: { cellWidth: 20, halign: 'right' },
        5: { cellWidth: 22, halign: 'right' },
        6: { cellWidth: 14, halign: 'right' },
        7: { cellWidth: 16, halign: 'right' },
        8: { cellWidth: 18, halign: 'right' },
      },
      head: [['#', 'User', 'Department', 'Total Tokens', 'Prompt', 'Completion', 'Calls', 'Avg/Call', 'Cost (USD)']],
      body: perUser.map((u, i) => {
        const avg = u.messageCount > 0 ? Math.round(u.totalTokens / u.messageCount) : 0;
        return [
          i + 1,
          u.username || '—',
          u.department || '—',
          fmt(u.totalTokens),
          fmt(u.promptTokens),
          fmt(u.completionTokens),
          fmt(u.messageCount),
          fmt(avg),
          fmtUSD(u.costUSD),
        ];
      }),
      didDrawCell: (data) => {
        // Draw usage bar in Total Tokens column
        if (data.section === 'body' && data.column.index === 3) {
          const row = perUser[data.row.index];
          if (row) {
            const p = pct(row.totalTokens, maxUserTokens);
            const bx = data.cell.x + 1;
            const by = data.cell.y + data.cell.height - 3;
            drawGradientBar(doc, bx, by, data.cell.width - 2, 1.5, p, C.accent);
          }
        }
      },
    });
    curY = doc.lastAutoTable.finalY + 6;
  }

  // ── PAGE 2: Bot Usage + Daily Trend ─────────────────────────
  doc.addPage();
  curY = margin;

  // Page header
  doc.setFillColor(...C.primary);
  doc.rect(0, 0, pw, 8, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...C.white);
  doc.text('GYS AI Token Usage Report', margin, 5.5);
  doc.text(`Page 2 — ${reportDate}`, pw - margin, 5.5, { align: 'right' });
  curY = 16;

  // ── Bot Usage Section ───────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...C.dark);
  doc.text('Bot Usage Analysis', margin, curY);
  curY += 8;

  const perBot = (tokenStats.perBot || []).slice(0, 10);
  const botChartData = perBot.map(b => ({ label: b.botName || '—', value: b.totalTokens }));
  const pieColors = [C.primary, C.blue, C.emerald, C.violet, C.amber, C.rose, C.accent, C.lightGreen, [100, 116, 139], [236, 72, 153]];

  if (perBot.length > 0) {
    // Donut chart
    const chartAreaH = 55;
    drawRoundedRect(doc, margin, curY, contentW, chartAreaH, 3, C.offWhite);

    drawPieChart(doc, margin + 38, curY + chartAreaH / 2, 22, botChartData, pieColors);

    // Total in center
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...C.dark);
    doc.text(fmt(totals.totalTokens), margin + 38, curY + chartAreaH / 2 - 1, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5);
    doc.setTextColor(...C.gray);
    doc.text('TOTAL', margin + 38, curY + chartAreaH / 2 + 3, { align: 'center' });

    // Legend
    const legX = margin + 72;
    let legY = curY + 6;
    perBot.forEach((b, i) => {
      const color = pieColors[i % pieColors.length];
      doc.setFillColor(...color);
      doc.roundedRect(legX, legY, 4, 3, 0.5, 0.5, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(...C.dark);
      doc.text(b.botName || '—', legX + 6, legY + 2.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...C.gray);
      const info = `${fmt(b.totalTokens)} tokens · ${fmt(b.messageCount)} calls · ${fmtUSD(b.costUSD)}`;
      doc.text(info, legX + 6, legY + 6.5);
      // Usage bar
      const maxBot = perBot[0]?.totalTokens || 1;
      drawGradientBar(doc, legX + 6, legY + 8, 80, 1.5, pct(b.totalTokens, maxBot), color);
      legY += 12;
      if (legY > curY + chartAreaH - 4) return;
    });

    curY += chartAreaH + 6;
  }

  // ── Bot Table ───────────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...C.dark);
  doc.text('Bot Performance Summary', margin, curY);
  curY += 2;

  if (perBot.length > 0) {
    doc.autoTable({
      startY: curY,
      margin: { left: margin, right: margin },
      styles: { fontSize: 7.5, cellPadding: 2.5, lineColor: [229, 231, 235], lineWidth: 0.2, textColor: C.dark },
      headStyles: { fillColor: C.accent, textColor: C.white, fontStyle: 'bold', fontSize: 7.5, cellPadding: 3 },
      alternateRowStyles: { fillColor: [250, 251, 252] },
      columnStyles: {
        0: { cellWidth: 8, halign: 'center' },
        1: { cellWidth: 45 },
        2: { cellWidth: 32, halign: 'right' },
        3: { cellWidth: 24, halign: 'right' },
        4: { cellWidth: 22, halign: 'right' },
        5: { cellWidth: 24, halign: 'right' },
      },
      head: [['#', 'Bot Name', 'Total Tokens', 'API Calls', 'Avg/Call', 'Cost (USD)']],
      body: perBot.map((b, i) => {
        const avg = b.messageCount > 0 ? Math.round(b.totalTokens / b.messageCount) : 0;
        return [i + 1, b.botName || '—', fmt(b.totalTokens), fmt(b.messageCount), fmt(avg), fmtUSD(b.costUSD)];
      }),
      foot: [['', 'TOTAL', fmt(totals.totalTokens), fmt(totals.messageCount), '', fmtUSD(totals.costUSD)]],
      footStyles: { fillColor: C.primary, textColor: C.white, fontStyle: 'bold' },
    });
    curY = doc.lastAutoTable.finalY + 8;
  }

  // ── Daily Token Trend ───────────────────────────────────────
  const dailyTrend = (tokenStats.dailyTrend || []).slice(-30);
  if (dailyTrend.length > 0) {
    // Check if we need new page
    if (curY + 65 > ph - 20) {
      doc.addPage();
      doc.setFillColor(...C.primary);
      doc.rect(0, 0, pw, 8, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(...C.white);
      doc.text('GYS AI Token Usage Report', margin, 5.5);
      doc.text(`Page ${doc.internal.getNumberOfPages()} — ${reportDate}`, pw - margin, 5.5, { align: 'right' });
      curY = 16;
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...C.dark);
    doc.text('Daily Token Consumption Trend (Last 30 Days)', margin, curY);
    curY += 3;

    drawRoundedRect(doc, margin, curY, contentW, 55, 3, C.offWhite);
    const chartData = dailyTrend.map(d => ({ label: d._id, value: d.totalTokens }));
    drawBarChart(doc, margin + 3, curY + 3, contentW - 6, 42, chartData, C.accent);

    curY += 60;

    // Daily trend table
    if (curY + 10 < ph - 30) {
      doc.autoTable({
        startY: curY,
        margin: { left: margin, right: margin },
        styles: { fontSize: 6.5, cellPadding: 1.8, lineColor: [229, 231, 235], lineWidth: 0.15, textColor: C.dark },
        headStyles: { fillColor: C.primary, textColor: C.white, fontStyle: 'bold', fontSize: 6.5, cellPadding: 2.5 },
        alternateRowStyles: { fillColor: [250, 251, 252] },
        head: [['Date', 'Tokens', 'Messages', 'Date', 'Tokens', 'Messages']],
        body: (() => {
          const rows = [];
          const half = Math.ceil(dailyTrend.length / 2);
          for (let i = 0; i < half; i++) {
            const left = dailyTrend[i];
            const right = dailyTrend[i + half];
            rows.push([
              left?._id || '', fmt(left?.totalTokens), fmt(left?.messages),
              right?._id || '', right ? fmt(right.totalTokens) : '', right ? fmt(right.messages) : '',
            ]);
          }
          return rows;
        })(),
      });
      curY = doc.lastAutoTable.finalY + 6;
    }
  }

  // ── Footer on every page ────────────────────────────────────
  const totalPages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    // Footer line
    doc.setDrawColor(...C.lightGray);
    doc.setLineWidth(0.3);
    doc.line(margin, ph - 12, pw - margin, ph - 12);
    // Footer text
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...C.gray);
    doc.text('GYS Portal AI — Token Usage Report · Confidential', margin, ph - 8);
    doc.text(`Page ${i} of ${totalPages}`, pw - margin, ph - 8, { align: 'right' });
    // GYS branding
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6);
    doc.setTextColor(...C.primary);
    doc.text('PT GARUDA YAMATO STEEL', pw / 2, ph - 8, { align: 'center' });
  }

  // ── Save ────────────────────────────────────────────────────
  const filename = `GYS_AI_Token_Report_${new Date().toISOString().split('T')[0]}.pdf`;
  doc.save(filename);
  return filename;
}
