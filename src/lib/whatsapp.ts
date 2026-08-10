import crypto from "node:crypto";
import { env } from "./env";
import { loadWhatsAppConfig } from "./whatsapp-config";

/**
 * Wrapper sobre a WhatsApp Cloud API (Graph API): todos os tipos de mensagem
 * que a Meta aceita sem Flow — texto, mídia, interativos, template, reação —
 * mais upload/download de mídia.
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

async function configOuErro() {
  const config = await loadWhatsAppConfig();
  if (!config) throw new WhatsAppNaoConfiguradoError();
  return config;
}

async function callGraph(
  caminho: (phoneNumberId: string) => string,
  body: unknown,
): Promise<unknown> {
  const config = await configOuErro();
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

/**
 * Monta e envia o envelope comum a toda mensagem de saída.
 *
 * `campos` carrega a chave específica do tipo (`text`, `image`, `interactive`,
 * ...) — cada função pública abaixo só decide o que vai dentro dela. Devolve
 * o wamid que a Meta atribuiu, para quem chama poder correlacionar depois
 * (ex.: uma reação numa mensagem enviada por aqui mesmo).
 */
async function enviarMensagem(
  to: string,
  type: string,
  campos: Record<string, unknown>,
  replyTo?: string,
): Promise<string | undefined> {
  const body: Record<string, unknown> = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type,
    ...campos,
  };
  if (replyTo) body.context = { message_id: replyTo };

  const resposta = (await callGraph((id) => `${id}/messages`, body)) as {
    messages?: { id: string }[];
  };
  return resposta.messages?.[0]?.id;
}

export async function sendText(
  to: string,
  text: string,
  replyTo?: string,
): Promise<string | undefined> {
  return enviarMensagem(to, "text", { text: { preview_url: false, body: text } }, replyTo);
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

// ------------------------------------------------------------------ mídia

export interface MidiaEnvio {
  /** URL pública — a Meta busca e hospeda; mais simples quando o arquivo já está acessível. */
  link?: string;
  /** Id devolvido por `uploadMedia()` — necessário quando o arquivo não tem URL pública. */
  id?: string;
  /** Ignorado por áudio e figurinha — a Meta não aceita legenda nesses dois tipos. */
  caption?: string;
  /** Só documento usa; vira o nome do arquivo que o destinatário vê. */
  filename?: string;
}

function corpoMidia(midia: MidiaEnvio): Record<string, unknown> {
  if (!midia.link && !midia.id) {
    throw new Error("Informe link ou id da mídia.");
  }
  return {
    ...(midia.link ? { link: midia.link } : { id: midia.id }),
    ...(midia.caption ? { caption: midia.caption } : {}),
    ...(midia.filename ? { filename: midia.filename } : {}),
  };
}

export async function sendImage(
  to: string,
  midia: MidiaEnvio,
  replyTo?: string,
): Promise<string | undefined> {
  return enviarMensagem(to, "image", { image: corpoMidia(midia) }, replyTo);
}

export async function sendAudio(
  to: string,
  midia: MidiaEnvio,
  replyTo?: string,
): Promise<string | undefined> {
  return enviarMensagem(to, "audio", { audio: corpoMidia(midia) }, replyTo);
}

export async function sendVideo(
  to: string,
  midia: MidiaEnvio,
  replyTo?: string,
): Promise<string | undefined> {
  return enviarMensagem(to, "video", { video: corpoMidia(midia) }, replyTo);
}

export async function sendDocument(
  to: string,
  midia: MidiaEnvio,
  replyTo?: string,
): Promise<string | undefined> {
  return enviarMensagem(to, "document", { document: corpoMidia(midia) }, replyTo);
}

export async function sendSticker(
  to: string,
  midia: MidiaEnvio,
  replyTo?: string,
): Promise<string | undefined> {
  return enviarMensagem(to, "sticker", { sticker: corpoMidia(midia) }, replyTo);
}

/**
 * Envia um upload de arquivo local para os servidores da Meta e devolve o
 * `media_id`. Necessário quando o arquivo não tem URL pública — do contrário
 * `link` em `MidiaEnvio` é mais simples e evita esta chamada.
 *
 * O id expira depois de ~30 dias sem uso ou quando a mensagem que o usa é
 * apagada; não é permanente.
 */
export async function uploadMedia(
  bytes: Uint8Array,
  mimeType: string,
  filename = "arquivo",
): Promise<string> {
  const config = await configOuErro();
  const versao = config.graphVersion ?? env.graphApiVersion;

  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("file", new Blob([bytes as BlobPart], { type: mimeType }), filename);

  const resposta = await fetch(
    `https://graph.facebook.com/${versao}/${config.phoneNumberId}/media`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${config.accessToken}` },
      body: form,
    },
  );

  const payload = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    throw new Error(`Graph API ${resposta.status}: ${JSON.stringify(payload)}`);
  }

  return (payload as { id: string }).id;
}

/**
 * Metadados de uma mídia já enviada ou recebida, incluindo a URL temporária
 * de download — expira em poucos minutos e exige o mesmo Bearer token para
 * ser buscada, por isso `downloadMedia()` existe em vez de devolver a URL crua.
 */
export async function mediaInfo(
  mediaId: string,
): Promise<{ url: string; mimeType: string; sizeBytes?: number }> {
  const config = await configOuErro();
  const versao = config.graphVersion ?? env.graphApiVersion;

  const resposta = await fetch(`https://graph.facebook.com/${versao}/${mediaId}`, {
    headers: { Authorization: `Bearer ${config.accessToken}` },
  });

  const payload = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    throw new Error(`Graph API ${resposta.status}: ${JSON.stringify(payload)}`);
  }

  const dados = payload as { url: string; mime_type: string; file_size?: number };
  return { url: dados.url, mimeType: dados.mime_type, sizeBytes: dados.file_size };
}

export async function downloadMedia(
  mediaId: string,
): Promise<{ bytes: ArrayBuffer; mimeType: string }> {
  const config = await configOuErro();
  const info = await mediaInfo(mediaId);

  const resposta = await fetch(info.url, {
    headers: { Authorization: `Bearer ${config.accessToken}` },
  });

  if (!resposta.ok) {
    throw new Error(`Falha ao baixar mídia: HTTP ${resposta.status}`);
  }

  return { bytes: await resposta.arrayBuffer(), mimeType: info.mimeType };
}

// -------------------------------------------------------------- interativos

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
  replyTo?: string,
): Promise<string | undefined> {
  return enviarMensagem(
    to,
    "interactive",
    {
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
    },
    replyTo,
  );
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
  replyTo?: string,
): Promise<string | undefined> {
  return enviarMensagem(
    to,
    "interactive",
    {
      interactive: {
        type: "list",
        body: { text: body },
        action: { button: buttonText, sections: [{ rows: itens }] },
      },
    },
    replyTo,
  );
}

/**
 * Pede pro cliente compartilhar uma localização — o seletor nativo de mapa
 * do WhatsApp, sem sair do app.
 *
 * A resposta chega como uma mensagem type: "location", com latitude/longitude
 * e, se o cliente pesquisou um lugar em vez de mandar a posição atual,
 * name/address preenchidos.
 */
export async function sendLocationRequest(
  to: string,
  body: string,
  replyTo?: string,
): Promise<string | undefined> {
  return enviarMensagem(
    to,
    "interactive",
    {
      interactive: {
        type: "location_request_message",
        body: { text: body },
        action: { name: "send_location" },
      },
    },
    replyTo,
  );
}

/**
 * Botão único que abre um link — diferente de `location_request_message`,
 * este tipo (`cta_url`) existe só para levar o cliente a uma URL.
 */
export async function sendCtaUrl(
  to: string,
  body: string,
  buttonText: string,
  url: string,
  replyTo?: string,
): Promise<string | undefined> {
  return enviarMensagem(
    to,
    "interactive",
    {
      interactive: {
        type: "cta_url",
        body: { text: body },
        action: {
          name: "cta_url",
          parameters: { display_text: buttonText, url },
        },
      },
    },
    replyTo,
  );
}

// ---------------------------------------------------------------- location

export interface LocalizacaoEnvio {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
}

/** Envia uma localização (pino no mapa), diferente de pedir para o cliente enviar a dele. */
export async function sendLocation(
  to: string,
  local: LocalizacaoEnvio,
  replyTo?: string,
): Promise<string | undefined> {
  return enviarMensagem(to, "location", { location: local }, replyTo);
}

// ---------------------------------------------------------------- contacts

export interface ContatoEnvio {
  nome: string;
  /** E.164 sem "+", igual ao formato usado em todo o resto da API. */
  telefone: string;
}

/** Envia um ou mais cartões de contato (vCard simplificado). */
export async function sendContacts(
  to: string,
  contatos: ContatoEnvio[],
  replyTo?: string,
): Promise<string | undefined> {
  const payload = contatos.map((c) => ({
    name: { formatted_name: c.nome, first_name: c.nome },
    phones: [{ phone: c.telefone, type: "CELL" }],
  }));
  return enviarMensagem(to, "contacts", { contacts: payload }, replyTo);
}

// ----------------------------------------------------------------- template

export interface ComponenteTemplate {
  type: "header" | "body" | "button";
  sub_type?: string;
  index?: number;
  parameters?: unknown[];
}

/**
 * Mensagem de template — o único tipo que a Meta permite fora da janela de
 * 24h, e só depois de o template ser aprovado no WhatsApp Manager. Sem
 * aprovação prévia, a Meta recusa o envio com erro próprio.
 */
export async function sendTemplate(
  to: string,
  name: string,
  languageCode: string,
  components?: ComponenteTemplate[],
  replyTo?: string,
): Promise<string | undefined> {
  return enviarMensagem(
    to,
    "template",
    {
      template: {
        name,
        language: { code: languageCode },
        ...(components?.length ? { components } : {}),
      },
    },
    replyTo,
  );
}

export interface TemplateAprovado {
  id: string;
  name: string;
  /** APPROVED, PENDING, REJECTED ou PAUSED — só APPROVED pode ser enviado. */
  status: string;
  category: string;
  language: string;
  components: unknown[];
}

/**
 * Lista os templates cadastrados na conta (WABA), com o status de aprovação
 * de cada um. É a mesma lista que aparece no WhatsApp Manager — útil para
 * quem vai montar `sendTemplate()` e precisa saber o `name`/`language`
 * exatos de um template já aprovado, sem abrir o painel da Meta.
 */
export async function listTemplates(params?: {
  status?: string;
  limit?: number;
}): Promise<TemplateAprovado[]> {
  const config = await configOuErro();
  if (!config.wabaId) {
    throw new Error(
      "Nenhum WABA ID associado à conexão. Reconecte pelo painel /admin.",
    );
  }

  const versao = config.graphVersion ?? env.graphApiVersion;
  const query = new URLSearchParams({
    fields: "id,name,status,category,language,components",
    limit: String(params?.limit ?? 100),
  });
  if (params?.status) query.set("status", params.status);

  const resposta = await fetch(
    `https://graph.facebook.com/${versao}/${config.wabaId}/message_templates?${query}`,
    { headers: { Authorization: `Bearer ${config.accessToken}` } },
  );

  const payload = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    throw new Error(`Graph API ${resposta.status}: ${JSON.stringify(payload)}`);
  }

  return ((payload as { data?: TemplateAprovado[] }).data ?? []);
}

// ----------------------------------------------------------------- reaction

/**
 * Reage a uma mensagem já trocada com um emoji. `emoji: ""` remove uma
 * reação enviada antes — é o único jeito de "desfazer" que a Cloud API
 * oferece; não existe editar ou apagar o texto de uma mensagem já enviada.
 */
export async function sendReaction(
  to: string,
  messageId: string,
  emoji: string,
): Promise<string | undefined> {
  return enviarMensagem(to, "reaction", { reaction: { message_id: messageId, emoji } });
}
