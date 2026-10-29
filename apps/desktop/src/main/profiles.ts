import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';
import type { AppSettings, ServerProfile } from '../shared/types';

const cleanText = (value: unknown, max = 255): string => {
  if (typeof value !== 'string' || value.length > max || /[\x00-\x1f\x7f]/.test(value)) throw new Error('配置包含无效字符。');
  return value.trim();
};

export function validateProfile(value: unknown): ServerProfile {
  if (!value || typeof value !== 'object') throw new Error('服务器配置无效。');
  const input = value as Record<string, unknown>;
  const id = cleanText(input.id, 64);
  const name = cleanText(input.name, 80);
  const host = cleanText(input.host);
  const username = cleanText(input.username, 80);
  const identityFile = cleanText(input.identityFile, 4096);
  if (!/^[a-zA-Z0-9_-]+$/.test(id) || !name) throw new Error('请填写服务器名称。');
  if (!host || !/^[a-zA-Z0-9_.:[\]-]+$/.test(host) || host.startsWith('-')) throw new Error('请输入主机地址或 SSH 别名，不包含用户名、空格或命令。');
  if (username && (!/^[a-zA-Z0-9_.-]+$/.test(username) || username.startsWith('-'))) throw new Error('SSH 用户名无效。');
  if (identityFile && !isAbsolute(identityFile)) throw new Error('请选择私钥文件的绝对路径。');
  const validPort = (port: unknown): port is number => Number.isInteger(port) && Number(port) >= 1 && Number(port) <= 65535;
  if (input.port !== null && !validPort(input.port)) throw new Error('SSH 端口必须在 1–65535 之间。');
  if (!validPort(input.remotePort)) throw new Error('Pi Web 端口必须在 1–65535 之间。');
  return { id, name, host, username, identityFile, port: input.port as number | null, remotePort: input.remotePort };
}

export class SettingsStore {
  private settings: AppSettings = { profiles: [], theme: 'light' };
  private writes = Promise.resolve();
  constructor(private readonly path: string) {}
  async load(): Promise<AppSettings> {
    try {
      const value = JSON.parse(await readFile(this.path, 'utf8'));
      this.settings = { profiles: value.profiles.map(validateProfile), theme: value.theme === 'dark' ? 'dark' : 'light' };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('无法读取本地配置，请检查 settings.json。', { cause: error });
    }
    return this.get();
  }
  get(): AppSettings { return structuredClone(this.settings); }
  async saveProfile(value: unknown): Promise<ServerProfile> {
    const profile = validateProfile(value);
    this.settings.profiles = [...this.settings.profiles.filter((item) => item.id !== profile.id), profile];
    await this.persist();
    return profile;
  }
  async deleteProfile(id: string): Promise<void> {
    this.settings.profiles = this.settings.profiles.filter((item) => item.id !== id);
    await this.persist();
  }
  async setTheme(theme: unknown): Promise<void> {
    if (theme !== 'light' && theme !== 'dark') throw new Error('主题无效。');
    this.settings.theme = theme;
    await this.persist();
  }
  private persist(): Promise<void> {
    const content = JSON.stringify(this.settings, null, 2);
    this.writes = this.writes.catch(() => {}).then(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      await writeFile(`${this.path}.tmp`, content, { mode: 0o600 });
      await rename(`${this.path}.tmp`, this.path);
    });
    return this.writes;
  }
}
