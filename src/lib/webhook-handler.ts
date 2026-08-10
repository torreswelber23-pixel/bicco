import { recordMessage, upsertContact } from "./repository";
import { markAsRead } from "./whatsapp";
import { emitirEvento } from "./webhooks-out";

/**
 * Recebimento de mensagens do WhatsApp.
 *
 * Não há resposta automática de nenhum tipo: o webhook só grava a mensagem e
 * dispara `message.received` para quem estiver escutando (a API não sabe, e
 * não decide, o que responder — isso é responsabilidade de quem consome o
 * evento e chama `POST /api/v1/messages` de volta).
 */

interface WebhookMessage {
  from: string;
  id: string;
  type: string;
  text?: { body: string };
  interactive?: {
    type: string;
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string; description?: string };
  };
  location?: {
    latitude: number;
    longitude: number;
    name?: string;
    address?: string;
  };
}

interface WebhookValue {
  contacts?: Array<{ wa_id: string; profile?: { name?: string } }>;
  messages?: WebhookMessage[];
  statuses?: unknown[];
}

export interface WebhookPayload {
  object?: string;
  entry?: Array<{ changes?: Array<{ field?: string; value?: WebhookValue }> }>;
}

export async function processWebhook(payload: WebhookPayload): Promise<void> {
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value?.messages?.length) continue; // status de entrega: ignorado

      const profileName = value.contacts?.[0]?.profile?.name;

      for (const message of value.messages) {
        try {
          await processMessage(message, profileName);
        } catch (error) {
          // Um erro numa mensagem não pode impedir as outras nem gerar
          // reentrega infinita: a Meta reenvia enquanto não receber 200.
          console.error("[webhook] falha ao processar mensagem:", error);
        }
      }
    }
  }
}

async function processMessage(
  message: WebhookMessage,
  profileName: string | undefined,
): Promise<void> {
  await markAsRead(message.id).catch(() => {
    /* marcar como lida é cosmético */
  });

  const contact = await upsertContact(message.from, profileName);

  await recordMessage({
    contactId: contact.id,
    waMessageId: message.id,
    direction: "inbound",
    type: message.type,
    payload: message,
  });

  await emitirEvento("message.received", {
    contact_id: contact.id,
    wa_id: message.from,
    profile_name: profileName ?? contact.profile_name,
    message,
  });
}
