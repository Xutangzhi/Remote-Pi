import { createServer, type Server, type ServerResponse } from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { AuthChallenge } from '../shared/types';

export class AuthBroker {
  private server?: Server;
  private pending = new Map<string, { response: ServerResponse; timeout: NodeJS.Timeout }>();
  readonly token = randomBytes(32).toString('hex');
  port = 0;
  constructor(private readonly onChallenge: (challenge: AuthChallenge | null) => void) {}
  async start(): Promise<void> {
    this.server = createServer((request, response) => {
      const authorization = Buffer.from(request.headers.authorization ?? '');
      const expected = Buffer.from(`Bearer ${this.token}`);
      if (request.method !== 'POST' || request.url !== '/challenge' || authorization.length !== expected.length || !timingSafeEqual(authorization, expected)) {
        response.writeHead(403).end(); return;
      }
      let body = '';
      request.on('data', (chunk: Buffer) => {
        body += chunk.toString();
        if (body.length > 16384) request.destroy();
      });
      request.on('end', () => {
        let prompt: unknown;
        try { prompt = JSON.parse(body).prompt; } catch { response.writeHead(400).end(); return; }
        if (typeof prompt !== 'string') { response.writeHead(400).end(); return; }
        const id = randomUUID();
        const timeout = setTimeout(() => this.answer(id, null), 120_000);
        this.pending.set(id, { response, timeout });
        response.on('close', () => { clearTimeout(timeout); this.pending.delete(id); this.onChallenge(null); });
        this.onChallenge({ id, prompt, kind: /authenticity|fingerprint|continue connecting|yes\/no/i.test(prompt) ? 'host' : 'secret' });
      });
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(0, '127.0.0.1', () => resolve());
    });
    this.port = (this.server.address() as { port: number }).port;
  }
  answer(id: string, answer: string | null): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pending.delete(id);
    pending.response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    pending.response.end(JSON.stringify({ answer: answer ?? '' }));
    this.onChallenge(null);
  }
  cancelAll(): void { for (const id of this.pending.keys()) this.answer(id, null); }
  async close(): Promise<void> {
    this.cancelAll();
    await new Promise<void>((resolve) => this.server ? this.server.close(() => resolve()) : resolve());
  }
}
