import { autenticar, erro, ok } from "@/lib/api-http";
import { listTemplates, WhatsAppNaoConfiguradoError } from "@/lib/whatsapp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Templates cadastrados na conta, com status de aprovação.
 *
 * A mesma lista do WhatsApp Manager — existe pra quem vai montar
 * `POST /api/v1/messages` com `type: "template"` e precisa saber o `name`/
 * `language` exatos de um template já aprovado, sem abrir o painel da Meta.
 */
export async function GET(request: Request): Promise<Response> {
  const auth = await autenticar(request, "messages:read");
  if ("resposta" in auth) return auth.resposta;

  const params = new URL(request.url).searchParams;
  const status = params.get("status") ?? undefined;
  const limit = params.get("limit") ? Number(params.get("limit")) : undefined;

  try {
    const templates = await listTemplates({ status, limit });
    return ok({ data: templates });
  } catch (falha) {
    if (falha instanceof WhatsAppNaoConfiguradoError) {
      return erro(503, "whatsapp_not_connected", falha.message);
    }
    console.error("[api] falha ao listar templates:", falha);
    return erro(
      502,
      "templates_fetch_failed",
      "A Meta recusou a consulta de templates.",
      falha instanceof Error ? falha.message : undefined,
    );
  }
}
