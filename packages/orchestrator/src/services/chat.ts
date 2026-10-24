// Discord bot (reads #bug-reports, replies with tracking + fixed messages) and a mock that just logs.
import type { ChatService } from '@patchline/core';

export class DiscordChat implements ChatService {
  readonly name = 'discord';
  private client: import('discord.js').Client | null = null;

  constructor(
    private token: string,
    private channelId: string,
  ) {}

  async start(onMessage: (msg: { id: string; author: string; text: string; at: number }) => void) {
    const { Client, GatewayIntentBits, Events } = await import('discord.js');
    const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
    client.on(Events.MessageCreate, (m) => {
      if (m.author.bot || m.channelId !== this.channelId) return;
      onMessage({ id: m.id, author: m.author.username, text: m.content, at: m.createdTimestamp });
    });
    await client.login(this.token);
    this.client = client;
  }

  async reply(externalRef: string, text: string) {
    if (!this.client || !externalRef.startsWith('discord:')) return;
    const channel = await this.client.channels.fetch(this.channelId);
    if (!channel?.isTextBased()) return;
    const msg = await channel.messages.fetch(externalRef.slice('discord:'.length));
    await msg.reply(text);
  }
}

export class MockChat implements ChatService {
  readonly name = 'mock-discord';
  readonly sent: { ref: string; text: string; at: number }[] = [];
  onSend?: (m: { ref: string; text: string; at: number }) => void;

  async start() {}

  async reply(ref: string, text: string) {
    const m = { ref, text, at: Date.now() };
    this.sent.push(m);
    this.onSend?.(m);
  }
}
