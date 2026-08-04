import { resumoPedido } from "./dispatch";
import { protocoloDe } from "./order-handler";
import {
  claimOrder,
  completeOrder,
  findDriverByPhone,
  openFlowSession,
  recordMessage,
  upsertContact,
} from "./repository";
import { markAsRead, newFlowToken, sendButtons, sendCtaUrl, sendText } from "./whatsapp";

/**
 * Tradução do payload do webhook para ações de atendimento.
 *
 * Dois caminhos, pela forma da mensagem:
 *  - texto solto de quem não é motorista → manda o link do formulário de pedido;
 *  - button_reply de um motorista cadastrado → aceitar/recusar/concluir.
 *
 * A resposta do cliente ao formulário não passa mais por aqui: ele preenche
 * numa página normal (/pedido) que fala direto com /api/pedido.
 */

interface WebhookMessage {
  from: string;
  id: string;
  type: string;
  text?: { body: string };
  interactive?: {
    type: string;
    button_reply?: { id: string; title: string };
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

export async function processWebhook(
  payload: WebhookPayload,
  baseUrl: string,
): Promise<void> {
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value?.messages?.length) continue; // status de entrega: ignorado

      const profileName = value.contacts?.[0]?.profile?.name;

      for (const message of value.messages) {
        try {
          await processMessage(message, profileName, baseUrl);
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
  baseUrl: string,
): Promise<void> {
  await markAsRead(message.id).catch(() => {
    /* marcar como lida é cosmético */
  });

  // Resposta de motorista aos botões de Aceitar/Recusar/Concluir: não passa
  // pelo cadastro de contato de cliente, é tratada à parte.
  if (message.type === "interactive" && message.interactive?.button_reply) {
    await processarRespostaMotorista(message);
    return;
  }

  const contact = await upsertContact(message.from, profileName);

  await recordMessage({
    contactId: contact.id,
    waMessageId: message.id,
    direction: "inbound",
    type: message.type,
    payload: message,
  });

  await enviarLinkDoPedido(contact.id, message.from, profileName, baseUrl);
}

async function enviarLinkDoPedido(
  contactId: string,
  to: string,
  profileName: string | undefined,
  baseUrl: string,
): Promise<void> {
  const token = newFlowToken();
  await openFlowSession(token, contactId);

  const saudacao = profileName ? `Olá, ${profileName.split(" ")[0]}!` : "Olá!";
  const url = `${baseUrl}/pedido?t=${token}`;

  await sendCtaUrl({
    to,
    url,
    displayText: "Fazer pedido",
    header: "Pedir corrida ou entrega",
    body:
      `${saudacao} Toque no botão abaixo pra pedir uma corrida ou uma entrega. ` +
      `Leva menos de um minuto.`,
    footer: "Corrida ou entrega",
  });

  await recordMessage({
    contactId,
    direction: "outbound",
    type: "cta_url",
    payload: { token, url },
  });
}

async function processarRespostaMotorista(message: WebhookMessage): Promise<void> {
  const buttonId = message.interactive?.button_reply?.id ?? "";
  const [acao, orderId] = buttonId.split(":");
  if (!orderId) return;

  const motorista = await findDriverByPhone(message.from);
  if (!motorista) {
    console.error(
      "[webhook] resposta de botão de número não cadastrado como motorista:",
      message.from,
    );
    return;
  }

  if (acao === "aceitar") {
    const order = await claimOrder(orderId, motorista.id);

    if (!order) {
      await sendText(
        message.from,
        "Esse pedido já foi atendido por outro motorista. Obrigado por responder!",
      );
      return;
    }

    await sendButtons(
      message.from,
      `Você aceitou! Protocolo ${protocoloDe(order.id)}\n\n${resumoPedido(order)}`,
      [{ id: `concluir:${order.id}`, title: "Marcar concluído" }],
    );

    const clienteWaId = order.contacts?.wa_id;
    if (clienteWaId) {
      await sendText(
        clienteWaId,
        `Seu pedido foi aceito! ✅\nMotorista: ${motorista.nome}\nContato: ${motorista.telefone}`,
      );
    }
    return;
  }

  if (acao === "concluir") {
    const order = await completeOrder(orderId, motorista.id);

    if (!order) {
      await sendText(message.from, "Não encontrei esse pedido em aberto pra você.");
      return;
    }

    await sendText(message.from, "Marcado como concluído. Obrigado!");

    const clienteWaId = order.contacts?.wa_id;
    if (clienteWaId) {
      await sendText(clienteWaId, "Serviço concluído. Obrigado por usar o bicco!");
    }
    return;
  }

  // "recusar": só reconhece, não muda o pedido — outro motorista ainda pode aceitar.
}
