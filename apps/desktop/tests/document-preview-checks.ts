import { expect, type Page } from '@playwright/test';

export async function checkDocumentPreviews(page: Page, open: (path: string) => Promise<unknown>, capture?: (name: string) => Promise<unknown>) {
  await open('preview.pdf');
  const pdf = page.locator('.pdf-preview canvas');
  await expect(pdf).toHaveAttribute('data-rendered', 'true');
  await expect(page.locator('.document-controls')).toContainText('第 1 / 2 页');
  await capture?.('pdf');
  const firstPixels = await pdf.evaluate((node: HTMLCanvasElement) => node.toDataURL());
  expect(firstPixels.length).toBeGreaterThan(5000);
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(pdf).toHaveAttribute('aria-label', 'PDF 第 2 页');
  await expect(pdf).toHaveAttribute('data-rendered', 'true');
  expect(await pdf.evaluate((node: HTMLCanvasElement) => node.toDataURL())).not.toBe(firstPixels);
  await page.getByLabel('预览缩放').selectOption('1.5');
  await expect(pdf).toHaveAttribute('data-rendered', 'true');
  await open('locked.pdf');
  await expect(page.locator('.rich-file-preview [role="alert"]')).toContainText('加密');

  await open('preview.docx');
  const word = page.frameLocator('iframe[title="Word 文档预览"]');
  await expect(word.getByText('中文 Word 第一页', { exact: true })).toBeVisible();
  await expect(word.getByRole('cell', { name: '文档表格', exact: true })).toBeVisible();
  await expect.poll(() => word.locator('img').first().evaluate((node: HTMLImageElement) => node.naturalWidth)).toBe(180);
  await expect(page.locator('.document-controls')).toContainText('第 1 / 2 页');
  await capture?.('word');
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(word.getByText('中文 Word 第二页', { exact: true })).toBeVisible();
  await expect(word.getByText('中文 Word 第一页', { exact: true })).not.toBeVisible();
  await page.getByLabel('预览缩放').selectOption('2');
  await expect(word.getByText('第二页正文', { exact: true })).toBeVisible();
  await expect(page.locator('iframe')).toHaveAttribute('sandbox', 'allow-same-origin');

  await page.evaluate(() => {
    const original = URL.createObjectURL;
    URL.createObjectURL = (blob) => { if (blob instanceof Blob && blob.type === 'image/svg+xml') void blob.text().then((text) => { (window as any).__slideText = text; }); return original(blob); };
  });
  await open('preview.pptx');
  const slide = page.locator('.presentation-preview img');
  await expect(slide).toHaveAttribute('alt', 'PPT 第 1 页');
  await expect.poll(() => slide.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBeGreaterThan(0);
  const svg = () => page.evaluate(() => (window as any).__slideText as string);
  await capture?.('ppt');
  await expect.poll(svg).toContain('中文 PPT 第1页');
  expect(await svg()).toContain('data:image/png;base64,');
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(slide).toHaveAttribute('alt', 'PPT 第 2 页');
  await expect.poll(svg).toContain('中文 PPT 第2页');
  await page.getByLabel('预览缩放').selectOption('2');
  await expect(slide).toHaveAttribute('style', /200%/);

  for (const path of ['broken.pdf', 'broken.docx', 'broken.pptx']) {
    await open(path);
    await expect(page.locator('.rich-file-preview [role="alert"]')).toContainText('无法解析');
  }
  for (const path of ['legacy.doc', 'legacy.ppt']) {
    await open(path);
    await expect(page.locator('.rich-file-preview [role="alert"]')).toContainText('转换');
  }
  await open('preview.pdf');
  await expect(pdf).toHaveAttribute('data-rendered', 'true');
  await expect(page.locator('.document-controls')).toContainText('第 1 / 2 页');
}
