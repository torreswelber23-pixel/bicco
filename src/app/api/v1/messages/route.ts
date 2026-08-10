import { autenticar, corpoJson, erro, ok, paginacao } from "@/lib/api-http";
import {
  findContactByWaId,
  listMessages,
  recordMessage,
  upsertContact,
} from "@/lib/repository";
import {
  WhatsAppNaoConfiguradoError,
  sendAudio,
  sendButtons,
  sendContacts,
  sendCtaUrl,
  sendDocument,
  sendImage,
  sendList,
  sendLocation,
  sendLocationRequest,
  sendReaction,
  sendSticker,
  sendTemplate,
  sendText,
  sendVideo,
} from "@/lib/whatsapp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Envio de mensagem pelo número conectado.
 *
 * Cobre todos os tipos da Cloud API disponíveis fora de template aprovado:
 * texto, mídia (imagem/áudio/vídeo/documento/figurinha), localização,
 * contato, botões, lista, pedido de localização, botão de link (cta_url) e
 * reação — além de template, que exige aprovação prévia no WhatsApp Manager.
 * `reply_to` (opcional, em qualquer tipo) cita uma mensagem anterior pelo
 * wamid.
 *
 * Não existe endpoint para editar uma mensagem já enviada — a Cloud API não
 * oferece essa operação; só é possível reagir ou enviar uma nova mensagem.
 */
export async function POST(request: Request): Promise<Response> {
  const auth = await autenticar(request, "messages:send");
  if ("resposta" in auth) return auth.resposta;

  const body = await corpoJson(request);
  if ("resposta" in body) return body.resposta;

  const { corpo } = body;
  const to = typeof corpo.to === "string" ? corpo.to.replace(/\D/g, "") : "";
  const tipo = typeof corpo.type === "string" ? corpo.type : "text";
  const replyTo = textoDe(corpo.reply_to);

  if (!to && tipo !== "reaction") {
    return erro(400, "invalid_to", 'Informe "to" com o telefone em formato E.164 (só dígitos).');
  }

  let sentId: string | undefined;

  try {
    switch (tipo) {
      case "text": {
        const texto = textoDe(corpo.text ?? corpo.body);
        if (!texto) return erro(400, "invalid_text", 'Informe "text" com o conteúdo.');
        sentId = await sendText(to, texto, replyTo);
        break;
      }

      case "image":
      case "audio":
      case "video":
      case "document":
      case "sticker": {
        const midia = midiaDe(corpo);
        if (!midia) {
          return erro(400, "invalid_media", 'Informe "link" (URL pública) ou "media_id".');
        }
        const enviar = { image: sendImage, audio: sendAudio, video: sendVideo, document: sendDocument, sticker: sendSticker }[tipo];
        sentId = await enviar(to, midia, replyTo);
        break;
      }

      case "location": {
        const latitude = Number(corpo.latitude);
        const longitude = Number(corpo.longitude);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          return erro(400, "invalid_location", '"latitude" e "longitude" são obrigatórios.');
        }
        sentId = await sendLocation(
          to,
          { latitude, longitude, name: textoDe(corpo.name), address: textoDe(corpo.address) },
          replyTo,
        );
        break;
      }

      case "contacts": {
        const contatos = Array.isArray(corpo.contacts) ? corpo.contacts : [];
        if (contatos.length === 0) {
          return erro(400, "invalid_contacts", 'Informe "contacts": [{ "name", "phone" }].');
        }
        sentId = await sendContacts(
          to,
          contatos.map((c) => {
            const item = c as Record<string, unknown>;
            return { nome: String(item.name ?? ""), telefone: String(item.phone ?? "") };
          }),
          replyTo,
        );
        break;
      }

      case "buttons": {
        const textoBody = textoDe(corpo.body);
        const botoes = Array.isArray(corpo.buttons) ? corpo.buttons : [];
        if (!textoBody) return erro(400, "invalid_body_text", 'Informe "body".');
        if (botoes.length === 0 || botoes.length > 3) {
          return erro(400, "invalid_buttons", "Envie de 1 a 3 botões — limite da Meta.");
        }
        sentId = await sendButtons(
          to,
          textoBody,
          botoes.map((b) => ({
            id: String((b as Record<string, unknown>).id ?? ""),
            title: String((b as Record<string, unknown>).title ?? ""),
          })),
          replyTo,
        );
        break;
      }

      case "list": {
        const textoBody = textoDe(corpo.body);
        const itens = Array.isArray(corpo.items) ? corpo.items : [];
        if (!textoBody) return erro(400, "invalid_body_text", 'Informe "body".');
        if (itens.length === 0 || itens.length > 10) {
          return erro(400, "invalid_items", "Envie de 1 a 10 itens — limite da Meta.");
        }
        sentId = await sendList(
          to,
          textoBody,
          textoDe(corpo.button) ?? "Ver opções",
          itens.map((i) => {
            const item = i as Record<string, unknown>;
            return {
              id: String(item.id ?? ""),
              title: String(item.title ?? ""),
              ...(item.description ? { description: String(item.description) } : {}),
            };
          }),
          replyTo,
        );
        break;
      }

      case "location_request": {
        const textoBody = textoDe(corpo.body);
        if (!textoBody) return erro(400, "invalid_body_text", 'Informe "body".');
        sentId = await sendLocationRequest(to, textoBody, replyTo);
        break;
      }

      case "cta_url": {
        const textoBody = textoDe(corpo.body);
        const buttonText = textoDe(corpo.button_text);
        const url = textoDe(corpo.url);
        if (!textoBody || !buttonText || !url) {
          return erro(400, "invalid_cta", 'Informe "body", "button_text" e "url".');
        }
        sentId = await sendCtaUrl(to, textoBody, buttonText, url, replyTo);
        break;
      }

      case "template": {
        const name = textoDe(corpo.name);
        const language = textoDe(corpo.language) ?? "pt_BR";
        if (!name) return erro(400, "invalid_template", 'Informe "name" do template aprovado.');
        sentId = await sendTemplate(
          to,
          name,
          language,
          Array.isArray(corpo.components) ? (corpo.components as never[]) : undefined,
          replyTo,
        );
        break;
      }

      case "reaction": {
        const messageId = textoDe(corpo.message_id);
        const emoji = typeof corpo.emoji === "string" ? corpo.emoji : "";
        if (!to) return erro(400, "invalid_to", 'Informe "to".');
        if (!messageId) {
          return erro(400, "invalid_message_id", 'Informe "message_id" da mensagem a reagir.');
        }
        sentId = await sendReaction(to, messageId, emoji);
        break;
      }

      default:
        return erro(
          400,
          "unsupported_type",
          `Tipo "${tipo}" não suportado. Veja docs/API.md para a lista completa.`,
        );
    }
  } catch (falha) {
    if (falha instanceof WhatsAppNaoConfiguradoError) {
      return erro(503, "whatsapp_not_connected", falha.message);
    }
    console.error("[api] falha ao enviar mensagem:", falha);
    return erro(
      502,
      "send_failed",
      "A Meta recusou o envio.",
      falha instanceof Error ? falha.message : undefined,
    );
  }

  // Registra a saída no mesmo histórico das mensagens recebidas, para que a
  // conversa lida pela API seja a conversa inteira, não só metade dela.
  const contato = await upsertContact(to || "sistema");
  await recordMessage({
    contactId: contato.id,
    waMessageId: sentId,
    direction: "outbound",
    type: tipo,
    payload: corpo,
  });

  return ok({ sent: true, to, type: tipo, wa_message_id: sentId, contact_id: contato.id }, 201);
}

/**
 * Histórico de conversa. Exige `contact_id` ou `wa_id`: sem recorte a
 * resposta seria a caixa de entrada inteira, que não serve para nada.
 */
export async function GET(request: Request): Promise<Response> {
  const auth = await autenticar(request, "messages:read");
  if ("resposta" in auth) return auth.resposta;

  const params = new URL(request.url).searchParams;
  const { limit, offset } = paginacao(request);

  let contactId = params.get("contact_id") ?? "";
  const waId = params.get("wa_id");

  if (!contactId && waId) {
    const contato = await findContactByWaId(waId.replace(/\D/g, ""));
    if (!contato) return ok({ data: [], limit, offset });
    contactId = contato.id;
  }

  if (!contactId) {
    return erro(400, "missing_contact", "Informe contact_id ou wa_id.");
  }

  const mensagens = await listMessages({ contactId, limit, offset });
  return ok({ data: mensagens, limit, offset });
}

function textoDe(valor: unknown): string | undefined {
  if (typeof valor !== "string") return undefined;
  const texto = valor.trim();
  return texto.length > 0 ? texto : undefined;
}

function midiaDe(corpo: Record<string, unknown>) {
  const link = textoDe(corpo.link);
  const id = textoDe(corpo.media_id);
  if (!link && !id) return null;
  return {
    link,
    id,
    caption: textoDe(corpo.caption),
    filename: textoDe(corpo.filename),
  };
}
