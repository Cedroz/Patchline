// Jira Cloud REST v3 client (create, comment, label, transition) and an in-memory mock with the same surface.
import type { JiraIssueRef, JiraService } from '@patchline/core';

type Adf = { type: string; version?: number; attrs?: Record<string, unknown>; content?: Adf[]; text?: string };

/** Plain text -> Atlassian Document Format. ```diff fences become code blocks. */
export function toAdf(text: string): Adf {
  const content: Adf[] = [];
  const parts = text.split(/```(\w*)\n([\s\S]*?)```/g);
  for (let i = 0; i < parts.length; i++) {
    if (i % 3 === 0) {
      for (const para of parts[i].split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)) {
        content.push({ type: 'paragraph', content: [{ type: 'text', text: para }] });
      }
    } else if (i % 3 === 1) {
      content.push({ type: 'codeBlock', attrs: { language: parts[i] || 'text' }, content: [{ type: 'text', text: parts[i + 1].slice(0, 30_000) }] });
      i++;
    }
  }
  return { type: 'doc', version: 1, content: content.length ? content : [{ type: 'paragraph', content: [{ type: 'text', text: ' ' }] }] };
}

export class RestJira implements JiraService {
  readonly name = 'jira';
  private auth: string;

  constructor(
    private baseUrl: string,
    email: string,
    token: string,
    private project: string,
  ) {
    this.auth = 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64');
  }

  private async call(method: string, path: string, body?: unknown) {
    const res = await fetch(`${this.baseUrl}/rest/api/3${path}`, {
      method,
      headers: { authorization: this.auth, accept: 'application/json', 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`Jira ${method} ${path} -> ${res.status}: ${await res.text()}`);
    return res.status === 204 ? null : res.json();
  }

  async createIssue(input: { summary: string; description: string; labels: string[]; severity: string }): Promise<JiraIssueRef> {
    const fields = {
      project: { key: this.project },
      summary: input.summary.slice(0, 250),
      description: toAdf(input.description),
      labels: [...input.labels, `severity-${input.severity}`],
    };
    let out: { key: string };
    try {
      out = await this.call('POST', '/issue', { fields: { ...fields, issuetype: { name: 'Bug' } } });
    } catch {
      out = await this.call('POST', '/issue', { fields: { ...fields, issuetype: { name: 'Task' } } }); // project without a Bug type
    }
    return { key: out.key, url: this.issueUrl(out.key) };
  }

  async comment(key: string, body: string) {
    await this.call('POST', `/issue/${key}/comment`, { body: toAdf(body) });
  }

  async addLabel(key: string, label: string) {
    await this.call('PUT', `/issue/${key}`, { update: { labels: [{ add: label }] } });
  }

  async transition(key: string, to: 'In Progress' | 'Done') {
    const { transitions } = (await this.call('GET', `/issue/${key}/transitions`)) as { transitions: { id: string; name: string; to: { name: string } }[] };
    const t = transitions.find((x) => x.to.name.toLowerCase() === to.toLowerCase() || x.name.toLowerCase() === to.toLowerCase());
    if (t) await this.call('POST', `/issue/${key}/transitions`, { transition: { id: t.id } });
  }

  issueUrl(key: string) {
    return `${this.baseUrl}/browse/${key}`;
  }
}

export interface MockIssue {
  key: string;
  summary: string;
  description: string;
  labels: string[];
  status: string;
  comments: { at: number; body: string }[];
}

export class MockJira implements JiraService {
  readonly name = 'mock-jira';
  readonly issues = new Map<string, MockIssue>();
  private n = 0;
  onChange?: (issue: MockIssue) => void;

  constructor(
    private project: string,
    private dashboardUrl: string,
  ) {}

  private touch(i: MockIssue) {
    this.onChange?.(i);
  }

  async createIssue(input: { summary: string; description: string; labels: string[]; severity: string }) {
    const key = `${this.project}-${++this.n}`;
    const issue = { key, summary: input.summary, description: input.description, labels: [...input.labels, `severity-${input.severity}`], status: 'To Do', comments: [] };
    this.issues.set(key, issue);
    this.touch(issue);
    return { key, url: this.issueUrl(key) };
  }

  async comment(key: string, body: string) {
    const i = this.issues.get(key);
    if (i) {
      i.comments.push({ at: Date.now(), body });
      this.touch(i);
    }
  }

  async addLabel(key: string, label: string) {
    const i = this.issues.get(key);
    if (i && !i.labels.includes(label)) {
      i.labels.push(label);
      this.touch(i);
    }
  }

  async transition(key: string, to: string) {
    const i = this.issues.get(key);
    if (i) {
      i.status = to;
      this.touch(i);
    }
  }

  issueUrl(key: string) {
    return `${this.dashboardUrl}/?jira=${key}`;
  }

  reset() {
    this.issues.clear();
    this.n = 0;
  }
}
