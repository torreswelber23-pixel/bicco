import crypto from "node:crypto";
import { env } from "./env";

/**
 * Wrapper mínimo sobre a WhatsApp Cloud API (Graph API).
 *
 * Só o que o atendimento precisa: mandar texto, mandar a mensagem que abre o
 * Flow e marcar mensagem como lida.
 */

function graphUrl(path: string): string {
  return `https://graph.facebook.com/${env.graphApiVersion}/${path}`;
}

async function callGraph(path: string, body: unknown): Promise<unknown> {
  const response = await fetch(graphUrl(path), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.whatsappToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      `Graph API ${response.status}: ${JSON.stringify(payload)}`,
    );
  }

  return payload;
}

export async function sendText(to: string, text: string): Promise<void> {
  await callGraph(`${env.phoneNumberId}/messages`, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: { preview_url: false, body: text },
  });
}

export async function markAsRead(messageId: string): Promise<void> {
  await callGraph(`${env.phoneNumberId}/messages`, {
    messaging_product: "whatsapp",
    status: "read",
    message_id: messageId,
  });
}

/** Token opaco que amarra a sessão do Flow ao contato do nosso banco. */
export function newFlowToken(): string {
  return crypto.randomUUID();
}

export interface SendFlowOptions {
  to: string;
  flowToken: string;
  /** Tela inicial. Precisa bater com o id no Flow JSON. */
  initialScreen?: string;
  header?: string;
  body: string;
  footer?: string;
  cta: string;
}

/**
 * Envia a mensagem interativa que abre o Flow.
 *
 * `flow_action: "navigate"` faz o cliente abrir direto na tela informada;
 * como as telas puxam dados do servidor, o payload inicial vai vazio e o
 * INIT/data_exchange preenche o resto.
 */
export async function sendFlow(options: SendFlowOptions): Promise<void> {
  await callGraph(`${env.phoneNumberId}/messages`, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: options.to,
    type: "interactive",
    interactive: {
      type: "flow",
      ...(options.header
        ? { header: { type: "text", text: options.header } }
        : {}),
      body: { text: options.body },
      ...(options.footer ? { footer: { text: options.footer } } : {}),
      action: {
        name: "flow",
        parameters: {
          flow_message_version: "3",
          flow_token: options.flowToken,
          flow_id: env.flowId,
          flow_cta: options.cta,
          mode: process.env.FLOW_MODE === "draft" ? "draft" : "published",
          flow_action: "navigate",
          flow_action_payload: {
            screen: options.initialScreen ?? "DEMANDA",
          },
        },
      },
    },
  });
}
