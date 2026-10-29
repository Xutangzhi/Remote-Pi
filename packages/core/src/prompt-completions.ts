import type { Model, SlashCommand } from './pi';

export interface CompletionTrigger { kind: 'command' | 'file' | 'model'; query: string; from: number; to: number; scope?: 'tracked' | 'all'; prefix?: '@' | '@ ' | '!@'; }
export interface PromptCompletion { text: string; label: string; detail?: string; description?: string; directory?: boolean; }

// Pi Web's @ / @<space> / !@ and quoted-path conventions (MIT; see vendor/pi-web/LICENSE).
export function completionTrigger(value: string, cursor: number): CompletionTrigger | undefined {
  const before = value.slice(0, cursor);
  const tokenEnd = cursor + (value.slice(cursor).match(/^[^\s"]*/)?.[0].length || 0);
  const command = before.match(/^\s*\/([^\s]*)$/);
  if (command) return { kind: 'command', query: command[1]!, from: before.indexOf('/'), to: tokenEnd };
  const quoted = before.match(/(?:^|\s)(@ |!@|@)"([^"\n]*)$/);
  const all = before.match(/(?:^|[\t ])(@ |!@)([^"\n]*)$/);
  const token = before.match(/(?:^|\s)(@|#)([^\s"]*)$/);
  const file = quoted || all || (token?.[1] === '@' ? token : null);
  if (file) {
    const prefix = file[1] as '@' | '@ ' | '!@';
    const to = quoted ? cursor + (value.slice(cursor).match(/^[^"\n]*/)?.[0].length || 0) : all ? cursor : tokenEnd;
    return { kind: 'file', query: file[2]!, from: before.length - file[0].trimStart().length, to, scope: prefix === '@' ? 'tracked' : 'all', prefix };
  }
  if (token?.[1] === '#') return { kind: 'model', query: token[2]!, from: before.length - token[0].trimStart().length, to: tokenEnd };
  return undefined;
}

const sources = { builtin: '内置命令', extension: '扩展', prompt: '提示词模板', skill: 'Skill' };
export function commandCompletions(commands: SlashCommand[], query: string): PromptCompletion[] {
  const needle = query.toLowerCase();
  return commands.filter((command) => command.name.toLowerCase().includes(needle)).map((command) => ({
    text: `/${command.name}`, label: `/${command.name}`, detail: [sources[command.source], command.argumentHint].filter(Boolean).join(' · '), description: command.description,
  }));
}

export function fileCompletion(path: string, trigger: CompletionTrigger): PromptCompletion {
  const directory = path.endsWith('/');
  const prefix = directory ? trigger.prefix || '@' : '@';
  const reference = /[\s"]/.test(path) ? `${prefix}"${path}"` : `${prefix}${path}`;
  return { text: reference, label: path, directory };
}

export function modelCompletions(models: Model[], query: string): PromptCompletion[] {
  return models.filter((model) => model.provider && model.id && `${model.provider}/${model.id} ${model.name || ''}`.toLowerCase().includes(query.toLowerCase())).map((model) => ({ text: `#${model.provider}/${model.id}`, label: `#${model.provider}/${model.id}`, description: model.name }));
}

export function applyCompletion(value: string, trigger: CompletionTrigger, item: PromptCompletion): { text: string; cursor: number } {
  // Leave the closing quote to the right of the cursor when completing a folder.
  const inserted = item.directory ? item.text : `${item.text} `;
  const after = value.slice(trigger.to + (trigger.kind === 'file' && value[trigger.to] === '"' ? 1 : 0));
  const text = value.slice(0, trigger.from) + inserted + after;
  return { text, cursor: trigger.from + inserted.length - (item.directory && inserted.endsWith('"') ? 1 : 0) };
}
