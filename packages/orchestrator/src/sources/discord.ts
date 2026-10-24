// Discord source: messages in #bug-reports become Reports. Replies ("Tracking as PATCH-12", "Fixed in <sha>")
// go back through ChatService using external_ref = "discord:<message id>".
import type { ChatService } from '@patchline/core';
import type { Pipeline } from '../pipeline';

export async function startDiscordSource(chat: ChatService, pipeline: Pipeline) {
  await chat.start((msg) => {
    void pipeline.ingest({ source: 'discord', author: msg.author, text: msg.text, external_ref: `discord:${msg.id}` }).catch((e) => console.error('[discord] ingest failed', e));
  });
}
