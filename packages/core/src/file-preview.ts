export type PreviewKind = 'table' | 'video' | 'audio' | 'image' | 'pdf' | 'word' | 'presentation' | 'legacy-office';
const formats: Record<string, [PreviewKind, string]> = {
  pdf: ['pdf', 'application/pdf'], docx: ['word', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  pptx: ['presentation', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  doc: ['legacy-office', 'application/msword'], ppt: ['legacy-office', 'application/vnd.ms-powerpoint'],
  csv: ['table', 'text/csv'], tsv: ['table', 'text/tab-separated-values'],
  xlsx: ['table', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'], xls: ['table', 'application/vnd.ms-excel'], ods: ['table', 'application/vnd.oasis.opendocument.spreadsheet'],
  mp4: ['video', 'video/mp4'], m4v: ['video', 'video/mp4'], webm: ['video', 'video/webm'], ogv: ['video', 'video/ogg'], mov: ['video', 'video/quicktime'],
  mp3: ['audio', 'audio/mpeg'], wav: ['audio', 'audio/wav'], m4a: ['audio', 'audio/mp4'], aac: ['audio', 'audio/aac'], ogg: ['audio', 'audio/ogg'], opus: ['audio', 'audio/ogg'], flac: ['audio', 'audio/flac'],
  png: ['image', 'image/png'], jpg: ['image', 'image/jpeg'], jpeg: ['image', 'image/jpeg'], gif: ['image', 'image/gif'], webp: ['image', 'image/webp'], svg: ['image', 'image/svg+xml'], bmp: ['image', 'image/bmp'],
};
export function filePreviewFormat(path: string) {
  const format = formats[path.split('.').at(-1)?.toLowerCase() || ''];
  if (!format) return;
  const [kind, mime] = format;
  const limitMiB = kind === 'table' ? 10 : ['image', 'pdf', 'word', 'presentation', 'legacy-office'].includes(kind) ? 20 : 128;
  return { kind, mime, limit: limitMiB * 1024 * 1024, limitMiB };
}
export interface PreviewSheet { name: string; rows: string[][]; columns: string[]; truncated: boolean; }
export interface TablePreview { sheets: PreviewSheet[]; truncated: boolean; }
