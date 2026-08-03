import { protocoloDe, resumoDe } from "./flow-handler";
import {
  openFlowSession,
  recordMessage,
  upsertContact,
} from "./repository";
import { markAsRead, newFlowToken, sendFlow, sendText } from "./whatsapp";

/**
 * Tradução do payload do webhook para ações de atendimento.
 *
 * Regra geral: qualquer mensagem de texto de quem ainda não tem uma demanda
 * aberta recebe o Flow; a resposta do Flow (nfm_reply) recebe a confirmação.
 */

interface WebhookMessage {
  from: string;
  id: string;
  type: string;
  text?: { body: string };
  interactive?: {
    type: string;
    nfm_reply?: { response_json?: string; name?: string; body?: string };
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
  profileName?: string,
): Promise<void> {
  const contact = await upsertContact(message.from, profileName);

  await recordMessage({
    contactId: contact.id,
    waMessageId: message.id,
    direction: "inbound",
    type: message.type,
    payload: message,
  });

  await markAsRead(message.id).catch(() => {
    /* marcar como lida é cosmético */
  });

  // Resposta final do Flow: chega como interactive/nfm_reply.
  if (message.type === "interactive" && message.interactive?.nfm_reply) {
    await confirmarRecebimento(message);
    return;
  }

  await abrirFlow(contact.id, message.from, profileName);
}

async function abrirFlow(
  contactId: string,
  to: string,
  profileName?: string,
): Promise<void> {
  const flowToken = newFlowToken();
  await openFlowSession(flowToken, contactId);

  const saudacao = profileName ? `Olá, ${profileName.split(" ")[0]}!` : "Olá!";

  await sendFlow({
    to,
    flowToken,
    initialScreen: "DEMANDA",
    header: "Atendimento",
    body:
      `${saudacao} Para te atender com precisão, toque no botão abaixo e ` +
      `responda três telas rápidas sobre o que você precisa.`,
    footer: "Leva menos de um minuto",
    cta: "Descrever demanda",
  });

  await recordMessage({
    contactId,
    direction: "outbound",
    type: "interactive_flow",
    payload: { flow_token: flowToken },
  });
}

async function confirmarRecebimento(message: WebhookMessage): Promise<void> {
  const responseJson = message.interactive?.nfm_reply?.response_json;
  let protocolo = "";
  let resumo = "";

  if (responseJson) {
    try {
      const parsed = JSON.parse(responseJson) as Record<string, unknown>;
      protocolo = String(parsed.protocolo ?? "");
      resumo = resumoDe(parsed);
    } catch (error) {
      console.error("[webhook] response_json inválido:", error);
    }
  }

  const linhas = [
    "Perfeito, sua solicitação está registrada. ✅",
    protocolo ? `Protocolo: *${protocolo}*` : "",
    resumo ? `Resumo: ${resumo}` : "",
    "",
    "Nossa equipe entra em contato no horário escolhido. Se precisar ajustar algo, é só responder por aqui.",
  ];

  await sendText(message.from, linhas.filter(Boolean).join("\n"));
}

// Reexportado para uso em scripts de teste.
export { protocoloDe };
