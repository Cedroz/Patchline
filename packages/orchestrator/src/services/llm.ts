// Claude client (real) and the offline mock. Real calls are recorded so USE_MOCKS=1 can replay them.
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { LLM, LLMRequest } from '@patchline/core';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { ZodType } from 'zod/v4';
import { MOCK_HANDLERS } from './mock-brain';

function recordingKey(task: string, user: string) {
  return `${task}-${createHash('sha1').update(user).digest('hex').slice(0, 12)}`;
}

export class ClaudeLLM implements LLM {
  readonly name = 'claude';
  private client: Anthropic;

  constructor(
    apiKey: string,
    private model: string,
    private recordDir: string,
  ) {
    this.client = new Anthropic({ apiKey });
  }

  private record(task: string, user: string, output: unknown) {
    fs.mkdirSync(this.recordDir, { recursive: true });
    fs.writeFileSync(path.join(this.recordDir, `${recordingKey(task, user)}.json`), JSON.stringify({ task, output }, null, 2));
  }

  async json<T>(req: LLMRequest<T>): Promise<T> {
    const res = await this.client.beta.messages.parse({
      model: this.model,
      max_tokens: req.maxTokens ?? 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: req.effort ?? 'medium', format: betaZodOutputFormat(req.schema as unknown as ZodType) },
      system: req.system,
      messages: [{ role: 'user', content: req.user }],
    });
    if (res.stop_reason === 'refusal') throw new Error(`Claude declined task ${req.task}`);
    if (!res.parsed_output) throw new Error(`Claude returned unparseable output for ${req.task}`);
    const out = req.schema.parse(res.parsed_output);
    this.record(req.task, req.user, out);
    return out;
  }

  async text(req: Omit<LLMRequest<string>, 'schema'>): Promise<string> {
    const res = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: req.maxTokens ?? 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: req.effort ?? 'low' },
      system: req.system,
      messages: [{ role: 'user', content: req.user }],
    });
    if (res.stop_reason === 'refusal') throw new Error(`Claude declined task ${req.task}`);
    const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
    this.record(req.task, req.user, text);
    return text;
  }
}

/** Offline stand-in: replays a recorded real answer if one exists, else a deterministic canned answer. */
export class MockLLM implements LLM {
  readonly name = 'mock-claude';
  constructor(private recordDir: string) {}

  private recorded(task: string, user: string): unknown {
    const p = path.join(this.recordDir, `${recordingKey(task, user)}.json`);
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')).output : undefined;
  }

  async json<T>(req: LLMRequest<T>): Promise<T> {
    const rec = this.recorded(req.task, req.user);
    if (rec !== undefined) {
      try {
        return req.schema.parse(rec);
      } catch {
        // Recorded before a schema change; fall through to the handler.
      }
    }
    const handler = MOCK_HANDLERS[req.task];
    if (!handler) throw new Error(`MockLLM has no handler for task ${req.task}`);
    await new Promise((r) => setTimeout(r, 300 + Math.random() * 500)); // feel like a model call on the board
    return req.schema.parse(await handler(req.input));
  }

  async text(req: Omit<LLMRequest<string>, 'schema'>): Promise<string> {
    const rec = this.recorded(req.task, req.user);
    if (typeof rec === 'string') return rec;
    const handler = MOCK_HANDLERS[req.task];
    if (!handler) throw new Error(`MockLLM has no handler for task ${req.task}`);
    return String(await handler(req.input));
  }
}
