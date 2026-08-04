import crypto from "node:crypto";
import { env } from "./env";
import { loadWhatsAppConfig } from "./whatsapp-config";

/**
 * Wrapper mínimo sobre a WhatsApp Cloud API (Graph API).
 *
 * As credenciais vêm de `loadWhatsAppConfig()`, não de variável de ambiente
 * direto: com o OAuth, o token é renovado periodicamente e gravado no banco,
 * e ler do lugar errado significaria usar um token vencido.
 */

export class WhatsAppNaoConfiguradoError extends Error {
  constructor() {
    super(
      "WhatsApp não configurado. Conecte a conta da Meta em /admin " +
        "ou defina WHATSAPP_TOKEN e WHATSAPP_PHONE_NUMBER_ID.",
    );
    this.name = "WhatsAppNaoConfiguradoError";
  }
}

async function callGraph(
  caminho: (phoneNumberId: string) => string,
  body: unknown,
): Promise<unknown> {
  const config = await loadWhatsAppConfig();
  if (!config) throw new WhatsAppNaoConfiguradoError();

  const versao = config.graphVersion ?? env.graphApiVersion;
  const url = `https://graph.facebook.com/${versao}/${caminho(config.phoneNumberId)}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(`Graph API ${response.status}: ${JSON.stringify(payload)}`);
  }

  return payload;
}

export async function sendText(to: string, text: string): Promise<void> {
  await callGraph((id) => `${id}/messages`, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: { preview_url: false, body: text },
  });
}

export async function markAsRead(messageId: string): Promise<void> {
  await callGraph((id) => `${id}/messages`, {
    messaging_product: "whatsapp",
    status: "read",
    message_id: messageId,
  });
}

/** Token opaco que amarra a sessão do pedido ao contato do nosso banco. */
export function newFlowToken(): string {
  return crypto.randomUUID();
}

export interface BotaoInterativo {
  /** Vai e volta em interactive.button_reply.id — carrega a ação e o pedido. */
  id: string;
  /** Máximo de 20 caracteres, limite da Meta para o texto do botão. */
  title: string;
}

/**
 * Mensagem com até 3 botões de resposta rápida.
 *
 * É o que dispara para os motoristas ("Aceitar" / "Recusar") e para
 * confirmar a conclusão de um pedido — mais leve que abrir outro Flow para
 * uma decisão binária.
 */
export async function sendButtons(
  to: string,
  body: string,
  buttons: BotaoInterativo[],
): Promise<void> {
  await callGraph((id) => `${id}/messages`, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: body },
      action: {
        buttons: buttons.map((botao) => ({
          type: "reply",
          reply: { id: botao.id, title: botao.title },
        })),
      },
    },
  });
}

export interface ItemLista {
  /** Vai e volta em interactive.list_reply.id. Máximo de 200 caracteres. */
  id: string;
  /** Máximo de 24 caracteres, limite da Meta. */
  title: string;
  /** Máximo de 72 caracteres. */
  description?: string;
}

/**
 * Mensagem com um menu de até 10 opções (lista nativa do WhatsApp).
 *
 * Usada pra escolhas com mais de 3 alternativas — botões só aguentam 3.
 * `buttonText` é o rótulo que abre o menu (ex.: "Ver opções"), não uma opção
 * em si.
 */
export async function sendList(
  to: string,
  body: string,
  buttonText: string,
  itens: ItemLista[],
): Promise<void> {
  await callGraph((id) => `${id}/messages`, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: body },
      action: {
        button: buttonText,
        sections: [{ rows: itens }],
      },
    },
  });
}

/**
 * Pede pro cliente compartilhar uma localização — o seletor nativo de mapa
 * do WhatsApp, sem sair do app.
 *
 * A resposta chega como uma mensagem type: "location", com latitude/longitude
 * e, se o cliente pesquisou um lugar em vez de mandar a posição atual,
 * name/address preenchidos.
 */
export async function sendLocationRequest(to: string, body: string): Promise<void> {
  await callGraph((id) => `${id}/messages`, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "interactive",
    interactive: {
      type: "location_request_message",
      body: { text: body },
      action: { name: "send_location" },
    },
  });
}
