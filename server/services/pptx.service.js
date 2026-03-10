// server/services/pptx.service.js
import PptxGenJS from "pptxgenjs";
import path from "path";
import fs from "fs";

// Dummy export agar ai-core.service.js tidak error saat import
export const HTML_SLIDE_SYSTEM_PROMPT = ""; 

const PptxService = {
  
  // Fungsi utama untuk merakit PPTX Native dari JSON AI
  async generate({ pptData, slideContent, title, outputDir, styleDesc }) {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const pptx = new PptxGenJS();
    pptx.layout = "LAYOUT_16x9";
    
    // ════════════════════════════════════════════════════════
    // TEMA: MCKINSEY / CORPORATE EXECUTIVE (Navy Blue & Clean)
    // ════════════════════════════════════════════════════════
    pptx.defineSlideMaster({
      title: "MASTER_SLIDE",
      background: { color: "0A1128" }, // Deep Navy Blue
      objects: [
        // Aksen garis biru muda di atas
        { rect: { x: 0, y: 0, w: "100%", h: 0.1, fill: { color: "0EA5E9" } } },
        // Footer teks statis
        { text: { text: "Confidential & Proprietary", options: { x: 0.5, y: 5.3, w: 3, h: 0.2, color: "64748B", fontSize: 10 } } }
      ],
      slideNumber: { x: "95%", y: 5.3, color: "64748B", fontSize: 10 }
    });

    let slideCount = 0;
    let usedFallback = false;

    try {
      if (!pptData || !pptData.slides || !Array.isArray(pptData.slides)) {
        throw new Error("Invalid JSON data");
      }

      // Looping data dari AI dan merakit slide native
      pptData.slides.forEach((slideData) => {
        let slide = pptx.addSlide({ masterName: "MASTER_SLIDE" });
        slideCount++;

        // ── LAYOUT 1: TITLE SLIDE ──
        if (slideData.layout === "TITLE") {
          slide.addText(slideData.title, { 
            x: 0.5, y: 2.0, w: "90%", h: 1.5, 
            fontSize: 44, color: "FFFFFF", bold: true, align: "center" 
          });
          if (slideData.subtitle) {
            slide.addText(slideData.subtitle, { 
              x: 0.5, y: 3.5, w: "90%", h: 1, 
              fontSize: 22, color: "38BDF8", align: "center" 
            });
          }
        } 
        
        // ── LAYOUT 2: CONTENT (BULLETS) ──
        else if (slideData.layout === "CONTENT") {
          // Slide Title
          slide.addText(slideData.title, { 
            x: 0.5, y: 0.4, w: "90%", h: 0.8, 
            fontSize: 28, color: "FFFFFF", bold: true 
          });
          // Garis pemisah
          slide.addShape(pptx.shapes.LINE, { x: 0.5, y: 1.2, w: 9, h: 0, line: { color: "1E293B", width: 1 } });
          
          if (slideData.bullets && slideData.bullets.length > 0) {
            let bulletText = slideData.bullets.map(b => ({ 
              text: b, 
              options: { bullet: true, color: "E2E8F0", fontSize: 18, breakLine: true } 
            }));
            slide.addText(bulletText, { 
              x: 0.5, y: 1.5, w: "90%", h: 3.5, valign: "top", paraSpaceAfter: 15 
            });
          }
        } 
        
        // ── LAYOUT 3: CHART (EDITABLE DATA) ──
        else if (slideData.layout === "CHART") {
          slide.addText(slideData.title, { 
            x: 0.5, y: 0.4, w: "90%", h: 0.8, 
            fontSize: 28, color: "FFFFFF", bold: true 
          });
          slide.addShape(pptx.shapes.LINE, { x: 0.5, y: 1.2, w: 9, h: 0, line: { color: "1E293B", width: 1 } });
          
          if (slideData.chartData && slideData.chartData.length > 0) {
            let pptChartType = pptx.ChartType.bar;
            if (slideData.chartType === "pie") pptChartType = pptx.ChartType.pie;
            if (slideData.chartType === "line") pptChartType = pptx.ChartType.line;

            slide.addChart(pptChartType, slideData.chartData, {
              x: 1.5, y: 1.5, w: 7, h: 3.5,
              showTitle: false,
              showLegend: true,
              legendPos: "b",
              legendColor: "E2E8F0",
              chartColors: ["0EA5E9", "F59E0B", "10B981", "8B5CF6"], 
              dataLabelColor: "FFFFFF",
              valAxisLabelColor: "94A3B8",
              catAxisLabelColor: "94A3B8",
              gridLineColor: "1E293B"
            });
          }
        }
      });

    } catch (err) {
      console.error("⚠️ [PPT] Native parsing failed, using simple fallback:", err.message);
      usedFallback = true;
      slideCount = 1;
      let slide = pptx.addSlide({ masterName: "MASTER_SLIDE" });
      slide.addText(title, { x: 0.5, y: 2, w: 9, h: 1, fontSize: 36, color: "FFFFFF", bold: true });
      slide.addText("Mohon maaf, terjadi kesalahan saat merender data presentasi.", { x: 0.5, y: 3, w: 9, h: 1, fontSize: 18, color: "94A3B8" });
    }

    const safeTitle = title.replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '-').substring(0, 40) || 'Presentation';
    const timestamp = Date.now();
    const filename = `${safeTitle}-${timestamp}.pptx`;
    const filepath = path.join(outputDir, filename);

    // Render file
    await pptx.writeFile({ fileName: filepath });
    console.log(`✅ [PPT] Native PPTX generated: ${filename}`);

    return {
      pptxFile: filepath,
      pptxUrl: `/api/files/${filename}`,
      pptxName: filename,
      slideCount: slideCount,
      usedFallback: usedFallback,
      styleDesc: styleDesc
    };
  },

  getStyleExamples() {
    return [
      { label: 'Corporate Executive', example: 'style executive boardroom — deep navy, gold accents, formal' },
      { label: 'McKinsey / BCG',      example: 'style McKinsey consulting — navy, data charts, sharp typography' }
    ];
  }
};

export default PptxService;