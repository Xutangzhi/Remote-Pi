import type { AskRequest, SessionEvent, TranscriptSnapshot, WireMessage } from './pi';

export interface ImagePart { mimeType?: string; data?: string; mediaId?: string; }
export interface MessageItem { kind: 'message'; id: string; role: 'user' | 'assistant' | 'notice'; text: string; thinking: string; images: ImagePart[]; streamId?: string; entryId?: string; timestamp?: number | string; model?: string; live?: boolean; }
export interface ToolItem { kind: 'tool'; id: string; name: string; summary: string; args?: unknown; output: string; state: 'running' | 'success' | 'error'; details?: Record<string, unknown>; images?: ImagePart[]; ask?: AskRequest; }
export type TranscriptItem = MessageItem | ToolItem;
export interface TranscriptState { items: TranscriptItem[]; active?: string; shell?: string; }
const blocks = (message: WireMessage) => Array.isArray(message.content) ? message.content : Array.isArray(message.parts) ? message.parts : [];
const string = (value: unknown) => typeof value === 'string' ? value : '';
const extractText = (content: unknown): string => typeof content === 'string' ? content : Array.isArray(content) ? content.map((part) => string(part?.text)).filter(Boolean).join('\n') : '';
const images = (content: Record<string, unknown>[]): ImagePart[] => content.filter((part) => part.type === 'image').map((part) => ({ mimeType: string(part.mimeType), data: string(part.data) || undefined, mediaId: string(part.mediaId) || undefined }));
export const toolSummary = (args: unknown): string => {
  if (!args || typeof args !== 'object') return '';
  const value = args as Record<string, unknown>;
  return string(value.command) || string(value.path) || string(value.file_path) || string(value.pattern) || '';
};

function appendNative(state: TranscriptState, raw: WireMessage, fallback: string, final = false): TranscriptState {
  if (!raw || typeof raw !== 'object' || (raw.role === 'custom' && raw.display === false)) return state;
  let items = [...state.items];
  const content = blocks(raw);
  if (raw.role === 'toolResult') {
    const id = raw.toolCallId || raw.entryId || fallback;
    const existing = items.find((item): item is ToolItem => item.kind === 'tool' && item.id === id);
    const tool: ToolItem = { kind: 'tool', id, name: raw.toolName || existing?.name || 'tool', summary: existing?.summary ?? '', args: existing?.args,
      output: extractText(raw.content), state: raw.isError ? 'error' : 'success', details: raw.details, images: images(content),
      ...(raw.toolName === 'ask_user' && !raw.isError && raw.details?.ask ? { ask: raw.details.ask as AskRequest } : {}) };
    items = existing ? items.map((item) => item === existing ? tool : item) : [...items, tool];
    return { ...state, items };
  }
  if (raw.role === 'bashExecution') {
    const id = raw.entryId || fallback;
    const tool: ToolItem = { kind: 'tool', id, name: 'bash', summary: raw.command || '', output: raw.output || '', state: raw.isError ? 'error' : 'success' };
    return { ...state, items: [...items.filter((item) => item.id !== id), tool] };
  }
  // Native system entries containing prompt sections/tool declarations are not
  // conversational messages. Summaries and displayable custom messages are.
  if (raw.role === 'system' && typeof raw.content !== 'string') return state;
  const id = raw.entryId || raw.streamId || (raw.timestamp !== undefined ? `${raw.role}-${raw.timestamp}` : fallback);
  const role = raw.role === 'user' ? 'user' : raw.role === 'assistant' ? 'assistant' : 'notice';
  const item: MessageItem = { kind: 'message', id, role, text: typeof raw.content === 'string' ? raw.content : raw.summary || content.filter((part) => part.type === 'text').map((part) => string(part.text)).join('\n'),
    thinking: content.filter((part) => part.type === 'thinking').map((part) => string(part.thinking) || string(part.text)).join('\n'), images: images(content), streamId: raw.streamId, entryId: raw.entryId, timestamp: raw.timestamp, model: raw.model, live: !final && role === 'assistant' };
  let index = items.findIndex((existing) => existing.kind === 'message' && (existing.id === id || Boolean(raw.streamId && existing.streamId === raw.streamId)
    || Boolean(role === 'user' && raw.entryId && !existing.entryId && existing.role === role && raw.timestamp !== undefined && existing.timestamp === raw.timestamp)));
  // The server echoes a prompt before the SDK gives it a timestamp/entry ID.
  // Consume only one matching unconfirmed echo; equal confirmed sends are distinct.
  if (index < 0 && role === 'user' && (raw.entryId || raw.timestamp !== undefined)) index = items.findIndex((existing) => existing.kind === 'message' && existing.role === 'user'
    && !existing.entryId && !existing.streamId && existing.timestamp === undefined && existing.text === item.text && JSON.stringify(existing.images) === JSON.stringify(item.images));
  if (index < 0 && final && raw.role === 'assistant' && state.active) index = items.findIndex((existing) => existing.id === state.active);
  if (item.text || item.thinking || item.images.length || role === 'assistant') {
    if (index >= 0) items[index] = item;
    else items.push(item);
  }
  for (const part of content) if (part.type === 'toolCall') {
    const toolId = string(part.id) || string(part.toolCallId) || `${id}-tool-${items.length}`;
    if (!items.some((existing) => existing.kind === 'tool' && existing.id === toolId)) items.push({ kind: 'tool', id: toolId, name: string(part.name) || string(part.toolName) || 'tool', args: part.arguments ?? part.args,
      summary: toolSummary(part.arguments ?? part.args), output: '', state: 'running' });
  }
  if (raw.errorMessage) items.push({ kind: 'message', id: `${id}-error`, role: 'notice', text: raw.errorMessage, thinking: '', images: [] });
  return { ...state, items, ...(!final && role === 'assistant' ? { active: id } : final && role === 'assistant' ? { active: undefined } : {}) };
}

export function fromSnapshot(snapshot: TranscriptSnapshot): TranscriptState {
  let state: TranscriptState = { items: [] };
  snapshot.page.messages.forEach((message, index) => { state = appendNative(state, message, `history-${snapshot.page.start + index}`, true); });
  if (snapshot.partial) state = appendNative(state, snapshot.partial, 'stream-partial');
  return state;
}

export function prependHistory(state: TranscriptState, messages: WireMessage[], start: number): TranscriptState {
  let before: TranscriptState = { items: [] };
  messages.forEach((message, index) => { before = appendNative(before, message, `history-${start + index}`, true); });
  const current = new Map(state.items.map((item) => [item.id, item]));
  const ids = new Set(before.items.map((item) => item.id));
  const merged = before.items.map((item) => {
    const existing = current.get(item.id);
    if (item.kind === 'tool' && existing?.kind === 'tool') return { ...item, ...existing, args: existing.args ?? item.args, summary: existing.summary || item.summary };
    return existing || item;
  });
  return { ...state, items: [...merged, ...state.items.filter((item) => !ids.has(item.id))] };
}

export function applyEvent(state: TranscriptState, event: SessionEvent): TranscriptState {
  if ((event.type === 'message.append' || event.type === 'message.end' || event.type === 'assistant.start') && event.message && typeof event.message === 'object') return appendNative(state, event.message, `event-${event.seq ?? state.items.length}`, event.type !== 'assistant.start');
  if (event.type === 'assistant.delta' || event.type === 'assistant.thinking.delta') {
    let index = state.items.findIndex((item) => item.kind === 'message' && (event.streamId ? item.streamId === event.streamId : item.id === state.active));
    let next = state;
    if (index < 0) {
      next = appendNative(state, { role: 'assistant', streamId: event.streamId, content: [] }, event.streamId || `live-${event.seq ?? state.items.length}`);
      index = next.items.length - 1;
    }
    const item = next.items[index] as MessageItem;
    const field = event.type === 'assistant.delta' ? 'text' : 'thinking';
    return { ...next, items: next.items.map((existing, at) => at === index ? { ...item, [field]: item[field] + (event.text ?? ''), live: true } : existing) };
  }
  if (event.type.startsWith('tool.') && event.toolCallId) {
    const id = event.toolCallId;
    const existing = state.items.find((item): item is ToolItem => item.kind === 'tool' && item.id === id);
    const tool: ToolItem = { kind: 'tool', id, name: event.toolName || existing?.name || 'tool', summary: event.summary || existing?.summary || toolSummary(event.args), args: event.args ?? existing?.args,
      output: event.type === 'tool.start' ? existing?.output ?? '' : event.text ?? existing?.output ?? '',
      state: event.type === 'tool.end' ? event.isError ? 'error' : 'success' : 'running', details: event.details ?? existing?.details,
      images: Array.isArray(event.content) ? images(event.content) : existing?.images,
      ...((event.toolName || existing?.name) === 'ask_user' && !event.isError && event.details?.ask ? { ask: event.details.ask as AskRequest } : {}) };
    return { ...state, items: existing ? state.items.map((item) => item === existing ? tool : item) : [...state.items, tool] };
  }
  if (event.type === 'shell.start') {
    const shell = `shell-${event.seq ?? state.items.length}`;
    return { ...state, shell, items: [...state.items, { kind: 'tool', id: shell, name: 'bash', summary: event.command ?? '', output: '', state: 'running' }] };
  }
  if (event.type === 'shell.chunk' || event.type === 'shell.end') return { ...state, items: state.items.map((item) => item.kind === 'tool' && item.id === state.shell ? { ...item, output: event.type === 'shell.chunk' ? item.output + (event.chunk ?? '') : event.output ?? item.output, state: event.type === 'shell.end' ? event.isError ? 'error' : 'success' : 'running' } : item) };
  if (event.type === 'session.error' || event.type === 'command.output') return { ...state, items: [...state.items, { kind: 'message', role: 'notice', id: `notice-${event.seq ?? state.items.length}`, text: typeof event.message === 'string' ? event.message : '', thinking: '', images: [] }] };
  return state;
}
