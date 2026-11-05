import { expect, type Page } from '@playwright/test';

export async function checkPreviewIsolation(page: Page, open: (path: string) => Promise<unknown>) {
  const composer = page.getByLabel('发送消息', { exact: true });
  await composer.fill('预览出错也要保留的草稿');
  const recover = async () => {
    await expect(page.locator('.rich-file-preview [role="alert"]')).toContainText('预览组件发生错误');
    await page.getByLabel('关闭面板', { exact: true }).click();
    await expect(page.locator('.inspector')).toHaveCount(0);
    await expect(composer).toHaveValue('预览出错也要保留的草稿');
    await open('healthy.csv');
    await expect(page.getByRole('cell', { name: '仍能预览', exact: true })).toBeVisible();
    await page.getByLabel('关闭面板', { exact: true }).click();
    await expect(page.locator('.inspector')).toHaveCount(0);
  };
  for (const [path, module] of [['preview.pdf', 'PdfPreview'], ['preview.docx', 'WordPreview']]) {
    const route = `**/${module}-*.js`;
    await page.route(route, (request) => request.abort('failed'));
    await open(path!);
    await recover();
    await page.unroute(route);
  }
  await page.evaluate(() => {
    const Original = window.Worker;
    (window as any).__originalWorker = Original;
    window.Worker = class extends Original {
      constructor(url: string | URL, options?: WorkerOptions) {
        if (String(url).includes('presentation.worker')) throw new Error('Injected preview worker startup failure');
        super(url, options);
      }
    };
  });
  await open('preview.pptx');
  await recover();
  await page.evaluate(() => { window.Worker = (window as any).__originalWorker; });
  await open('preview.pptx');
  await expect(page.locator('.presentation-preview img')).toHaveAttribute('alt', 'PPT 第 1 页');
  await page.getByLabel('关闭面板', { exact: true }).click();
  await expect(page.locator('.inspector')).toHaveCount(0);
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.getByTestId('message-user').last()).toContainText('预览出错也要保留的草稿');
}
