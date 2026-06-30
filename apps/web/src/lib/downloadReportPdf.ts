import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

const PDF_MARGIN_MM = 10;
const CAPTURE_SCALE = 2;

function addCanvasToPdf(pdf: jsPDF, canvas: HTMLCanvasElement, newPageBefore: boolean): void {
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const printWidth = pageWidth - PDF_MARGIN_MM * 2;
  const printHeight = pageHeight - PDF_MARGIN_MM * 2;
  const imgWidth = printWidth;
  const imgHeight = (canvas.height * printWidth) / canvas.width;
  const imgData = canvas.toDataURL('image/jpeg', 0.95);

  if (newPageBefore) {
    pdf.addPage();
  }

  let heightLeft = imgHeight;
  let y = PDF_MARGIN_MM;

  pdf.addImage(imgData, 'JPEG', PDF_MARGIN_MM, y, imgWidth, imgHeight);
  heightLeft -= printHeight;

  while (heightLeft > 0) {
    y = PDF_MARGIN_MM - (imgHeight - heightLeft);
    pdf.addPage();
    pdf.addImage(imgData, 'JPEG', PDF_MARGIN_MM, y, imgWidth, imgHeight);
    heightLeft -= printHeight;
  }
}

async function captureSection(element: HTMLElement): Promise<HTMLCanvasElement> {
  return html2canvas(element, {
    scale: CAPTURE_SCALE,
    useCORS: true,
    allowTaint: true,
    backgroundColor: '#ffffff',
    logging: false,
    scrollX: 0,
    scrollY: -window.scrollY,
    width: element.scrollWidth,
    height: element.scrollHeight,
    windowWidth: element.scrollWidth,
    windowHeight: element.scrollHeight,
  });
}

export async function downloadReportPdf(root: HTMLElement, filename: string): Promise<void> {
  root.classList.add('qa-pdf-capturing');
  root.scrollIntoView({ block: 'start', behavior: 'instant' as ScrollBehavior });

  if (document.fonts?.ready) {
    await document.fonts.ready;
  }
  await new Promise((resolve) => setTimeout(resolve, 400));

  const sections = Array.from(root.querySelectorAll('.pdf-section')) as HTMLElement[];
  const targets = sections.length > 0 ? sections : [root];

  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });

  try {
    for (let i = 0; i < targets.length; i++) {
      const canvas = await captureSection(targets[i]);
      addCanvasToPdf(pdf, canvas, i > 0);
    }
    pdf.save(filename);
  } finally {
    root.classList.remove('qa-pdf-capturing');
  }
}
