import { fixedWidthPage, type PositionedText } from '@/lib/pdf-text-layout';

/** Dedicated ATC/EZFW extraction: general weight parsing keeps its existing reader. */
export async function ofpLayoutFromPdf(bytes: Uint8Array | ArrayBuffer): Promise<string> {
  const { getDocumentProxy } = await import('unpdf');
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const buffer = new Uint8Array(view.length);
  buffer.set(view);
  const doc = await getDocumentProxy(buffer, { disableWorker: true } as Parameters<typeof getDocumentProxy>[1]);
  try {
    const pages: string[] = [];
    for (let number = 1; number <= doc.numPages; number++) {
      const page = await doc.getPage(number);
      const content = await page.getTextContent();
      pages.push(fixedWidthPage(content.items.filter(item => 'str' in item) as PositionedText[]));
    }
    return pages.join('\n');
  } finally {
    await doc.destroy();
  }
}