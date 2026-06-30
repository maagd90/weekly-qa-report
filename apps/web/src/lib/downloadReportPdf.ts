import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

const PDF_MARGIN_MM = 8;
const CAPTURE_SCALE = 2;

function addCanvasFitOnePage(pdf: jsPDF, canvas: HTMLCanvasElement): void {
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const printWidth = pageWidth - PDF_MARGIN_MM * 2;
  const printHeight = pageHeight - PDF_MARGIN_MM * 2;

  let imgWidth = printWidth;
  let imgHeight = (canvas.height * printWidth) / canvas.width;

  if (imgHeight > printHeight) {
    imgHeight = printHeight;
    imgWidth = (canvas.width * printHeight) / canvas.height;
  }

  const x = PDF_MARGIN_MM + (printWidth - imgWidth) / 2;
  const y = PDF_MARGIN_MM;
  pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', x, y, imgWidth, imgHeight);
}

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

export async function downloadReportPdf(
  root: HTMLElement,
  filename: string,
  options?: { singlePage?: boolean },
): Promise<void> {
  const singlePage = options?.singlePage ?? true;

  root.classList.add('qa-pdf-capturing');
  root.scrollIntoView({ block: 'start', behavior: 'instant' as ScrollBehavior });

  if (document.fonts?.ready) {
    await document.fonts.ready;
  }
  await new Promise((resolve) => setTimeout(resolve, 400));

  const sections = Array.from(root.querySelectorAll('.pdf-section')) as HTMLElement[];
  const target = sections.length === 1 ? sections[0] : root;

  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });

  try {
    const canvas = await captureSection(target);
    if (singlePage) {
      addCanvasFitOnePage(pdf, canvas);
    } else if (sections.length > 0) {
      for (let i = 0; i < sections.length; i++) {
        const sectionCanvas = await captureSection(sections[i]);
        addCanvasToPdf(pdf, sectionCanvas, i > 0);
      }
    } else {
      addCanvasToPdf(pdf, canvas, false);
    }
    pdf.save(filename);
  } finally {
    root.classList.remove('qa-pdf-capturing');
  }
}
