import JSZip from 'jszip';
import PptxGenJS from 'pptxgenjs';

async function run() {
  const pptx = new PptxGenJS();
  pptx.defineSlideMaster({ title: "COVER" });
  const s1 = pptx.addSlide("COVER");
  const buf = await pptx.write({ outputType: 'nodebuffer' });
  
  const zip = await JSZip.loadAsync(buf);
  const rels1 = await zip.files['ppt/slides/_rels/slide1.xml.rels'].async('string');
  console.log('rels1:', rels1);
}
run();
