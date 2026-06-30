import html2pdf from 'html2pdf.js';

/** Target width for A4 body text (~180mm printable area). */
const PDF_CAPTURE_WIDTH_PX = 680;
const PDF_MARGIN_MM = 12;

export async function downloadReportPdf(element: HTMLElement, filename: string): Promise<void> {
  element.classList.add('qa-pdf-capturing');
  element.scrollIntoView({ block: 'start', behavior: 'instant' as ScrollBehavior });

  if (document.fonts?.ready) {
    await document.fonts.ready;
  }
  // Allow layout/fonts/charts to settle after width constraint is applied.
  await new Promise((resolve) => setTimeout(resolve, 350));

  const captureWidth = element.scrollWidth || PDF_CAPTURE_WIDTH_PX;
  const captureHeight = element.scrollHeight;

  try {
    await html2pdf()
      .set({
        margin: PDF_MARGIN_MM,
        filename,
        image: { type: 'jpeg', quality: 0.92 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          allowTaint: true,
          backgroundColor: '#ffffff',
          logging: false,
          scrollX: 0,
          scrollY: -window.scrollY,
          width: captureWidth,
          height: captureHeight,
          windowWidth: captureWidth,
          onclone: (doc: Document) => {
            const node = doc.querySelector('.qa-pdf-export') as HTMLElement | null;
            if (node) {
              node.style.width = `${PDF_CAPTURE_WIDTH_PX}px`;
              node.style.maxWidth = `${PDF_CAPTURE_WIDTH_PX}px`;
              node.style.background = '#ffffff';
            }
          },
        },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait', compress: true },
        pagebreak: { mode: ['css', 'legacy'] },
      })
      .from(element)
      .save();
  } finally {
    element.classList.remove('qa-pdf-capturing');
  }
}
