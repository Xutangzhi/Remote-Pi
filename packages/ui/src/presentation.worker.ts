import { getSlides, loadPresentation, type PresentationData } from '@office-kit/pptx';
import { renderSlideToSvg } from '@office-kit/pptx-preview';

let presentation: PresentationData | undefined;
self.onmessage = async (event: MessageEvent<{ data?: ArrayBuffer; page: number }>) => {
  try {
    if (event.data.data) presentation = await loadPresentation(new Uint8Array(event.data.data), { limits: { maxEntries: 5000, maxTotalUncompressedBytes: 100 * 1024 * 1024, maxXmlPartBytes: 10 * 1024 * 1024, maxTotalXmlBytes: 30 * 1024 * 1024 } });
    if (!presentation) throw new Error('无法读取演示文稿');
    const slides = getSlides(presentation);
    if (!slides.length || slides.length > 200) throw new Error('演示文稿需包含 1–200 页，请拆分后预览。');
    const svg = renderSlideToSvg(presentation, slides[event.data.page - 1]!);
    self.postMessage({ svg, pages: slides.length, page: event.data.page });
  } catch (reason) { self.postMessage({ error: `无法解析 PPTX，请检查文件是否损坏、加密或超过预览限制。${(reason as Error).message}` }); }
};
