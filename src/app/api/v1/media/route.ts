import { autenticar, corpoJson, erro, ok } from "@/lib/api-http";
import { uploadMedia, WhatsAppNaoConfiguradoError } from "@/lib/whatsapp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Upload de mídia para os servidores da Meta, devolvendo um `media_id`.
 *
 * Só é necessário quando o arquivo não tem URL pública — enviar por `link`
 * direto em `POST /api/v1/messages` é mais simples e evita este passo.
 * Reaproveita o escopo `messages:send`: subir mídia só faz sentido para
 * quem já pode mandar mensagem.
 */
export async function POST(request: Request): Promise<Response> {
  const auth = await autenticar(request, "messages:send");
  if ("resposta" in auth) return auth.resposta;

  const body = await corpoJson(request);
  if ("resposta" in body) return body.resposta;

  const { corpo } = body;
  const dataBase64 = typeof corpo.data === "string" ? corpo.data : "";
  const mimeType = typeof corpo.mime_type === "string" ? corpo.mime_type : "";
  const filename = typeof corpo.filename === "string" ? corpo.filename : undefined;

  if (!dataBase64 || !mimeType) {
    return erro(400, "invalid_media", 'Informe "data" (base64) e "mime_type".');
  }

  let bytes: Buffer;
  try {
    bytes = Buffer.from(dataBase64, "base64");
  } catch {
    return erro(400, "invalid_base64", '"data" não é base64 válido.');
  }

  try {
    const id = await uploadMedia(bytes, mimeType, filename);
    return ok({ id, mime_type: mimeType }, 201);
  } catch (falha) {
    if (falha instanceof WhatsAppNaoConfiguradoError) {
      return erro(503, "whatsapp_not_connected", falha.message);
    }
    console.error("[api] falha ao subir mídia:", falha);
    return erro(
      502,
      "upload_failed",
      "A Meta recusou o upload.",
      falha instanceof Error ? falha.message : undefined,
    );
  }
}
