import { autenticar, corpoJson, erro, ok, paginacao } from "@/lib/api-http";
import {
  findContactByWaId,
  listMessages,
  recordMessage,
  upsertContact,
} from "@/lib/repository";
import {
  WhatsAppNaoConfiguradoError,
  sendButtons,
  sendList,
  sendLocationRequest,
  sendText,
} from "@/lib/whatsapp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Envio de mensagem pelo número conectado.
 *
 * Cobre os quatro tipos que o WhatsApp aceita sem aprovação prévia: texto,
 * botões, lista e pedido de localização. Template não entra aqui — exige
 * cadastro na Meta e tem regra própria de janela de 24h.
 */
export async function POST(request: Request): Promise<Response> {
  const auth = await autenticar(request, "messages:send");
  if ("resposta" in auth) return auth.resposta;

  const body = await corpoJson(request);
  if ("resposta" in body) return body.resposta;

  const { corpo } = body;
  const to = typeof corpo.to === "string" ? corpo.to.replace(/\D/g, "") : "";
  const tipo = typeof corpo.type === "string" ? corpo.type : "text";

  if (!to) {
    return erro(400, "invalid_to", 'Informe "to" com o telefone em formato E.164 (só dígitos).');
  }

  try {
    switch (tipo) {
      case "text": {
        const texto = textoDe(corpo.text ?? corpo.body);
        if (!texto) return erro(400, "invalid_text", 'Informe "text" com o conteúdo.');
        await sendText(to, texto);
        break;
      }

      case "buttons": {
        const textoBody = textoDe(corpo.body);
        const botoes = Array.isArray(corpo.buttons) ? corpo.buttons : [];
        if (!textoBody) return erro(400, "invalid_body_text", 'Informe "body".');
        if (botoes.length === 0 || botoes.length > 3) {
          return erro(400, "invalid_buttons", "Envie de 1 a 3 botões — limite da Meta.");
        }
        await sendButtons(
          to,
          textoBody,
          botoes.map((b) => ({
            id: String((b as Record<string, unknown>).id ?? ""),
            title: String((b as Record<string, unknown>).title ?? ""),
          })),
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
        await sendList(
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
        );
        break;
      }

      case "location_request": {
        const textoBody = textoDe(corpo.body);
        if (!textoBody) return erro(400, "invalid_body_text", 'Informe "body".');
        await sendLocationRequest(to, textoBody);
        break;
      }

      default:
        return erro(
          400,
          "unsupported_type",
          `Tipo "${tipo}" não suportado. Use text, buttons, list ou location_request.`,
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
  const contato = await upsertContact(to);
  await recordMessage({
    contactId: contato.id,
    direction: "outbound",
    type: tipo,
    payload: corpo,
  });

  return ok({ sent: true, to, type: tipo, contact_id: contato.id }, 201);
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
