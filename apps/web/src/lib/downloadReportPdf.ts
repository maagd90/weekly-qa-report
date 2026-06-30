/** Printable content width for A4 with 15mm side margins (~680px at 96dpi). */
const PDF_CONTENT_WIDTH_PX = 680;
const PDF_MARGIN_MM = 15;

export async function downloadReportPdf(element: HTMLElement, filename: string): Promise<void> {
  const html2pdf = (await import('html2pdf.js')).default;

  const wrapper = document.createElement('div');
  wrapper.className = 'qa-pdf-root';
  wrapper.setAttribute('aria-hidden', 'true');
  Object.assign(wrapper.style, {
    position: 'fixed',
    left: '0',
    top: '0',
    width: `${PDF_CONTENT_WIDTH_PX}px`,
    background: '#ffffff',
    zIndex: '-9999',
    pointerEvents: 'none',
    overflow: 'visible',
  });

  const clone = element.cloneNode(true) as HTMLElement;
  clone.classList.add('qa-pdf-export-clone');
  wrapper.appendChild(clone);
  document.body.appendChild(wrapper);

  if (document.fonts?.ready) {
    await document.fonts.ready;
  }
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  try {
    await html2pdf()
      .set({
        margin: PDF_MARGIN_MM,
        filename,
        image: { type: 'jpeg', quality: 0.96 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          logging: false,
          backgroundColor: '#ffffff',
          width: PDF_CONTENT_WIDTH_PX,
          windowWidth: PDF_CONTENT_WIDTH_PX,
          scrollX: 0,
          scrollY: 0,
        },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait', compress: true },
        pagebreak: {
          mode: ['avoid-all', 'css', 'legacy'],
          avoid: ['.pdf-avoid-break', 'tr', 'table', 'svg'],
        },
      })
      .from(wrapper)
      .save();
  } finally {
    document.body.removeChild(wrapper);
  }
}
