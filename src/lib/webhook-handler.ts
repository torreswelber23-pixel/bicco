import { resumoPedido } from "./dispatch";
import { protocoloDe } from "./flow-handler";
import {
  claimOrder,
  completeOrder,
  findDriverByPhone,
  openFlowSession,
  recordMessage,
  upsertContact,
} from "./repository";
import { markAsRead, newFlowToken, sendButtons, sendFlow, sendText } from "./whatsapp";

/**
 * Tradução do payload do webhook para ações de atendimento.
 *
 * Três caminhos, pela forma da mensagem:
 *  - texto solto de quem não é motorista → abre o Flow de novo pedido;
 *  - nfm_reply (Flow concluído) → confirmação pro cliente;
 *  - button_reply de um motorista cadastrado → aceitar/recusar/concluir.
 */

interface WebhookMessage {
  from: string;
  id: string;
  type: string;
  text?: { body: string };
  interactive?: {
    type: string;
    nfm_reply?: { response_json?: string; name?: string; body?: string };
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
    initialScreen: "SERVICO",
    header: "Pedir corrida ou entrega",
    body:
      `${saudacao} Toque no botão abaixo pra pedir uma corrida ou uma entrega. ` +
      `Leva menos de um minuto.`,
    footer: "Corrida ou entrega",
    cta: "Fazer pedido",
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
      resumo = String(parsed.resumo ?? "");
    } catch (error) {
      console.error("[webhook] response_json inválido:", error);
    }
  }

  const linhas = [
    "Pedido registrado! ✅",
    protocolo ? `Protocolo: *${protocolo}*` : "",
    resumo ? resumo : "",
    "",
    "Estamos buscando um motorista disponível. Assim que alguém aceitar, avisamos por aqui.",
  ];

  await sendText(message.from, linhas.filter(Boolean).join("\n"));
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
