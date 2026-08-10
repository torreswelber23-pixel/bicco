import { autenticar, erro } from "@/lib/api-http";
import { downloadMedia, WhatsAppNaoConfiguradoError } from "@/lib/whatsapp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Baixa os bytes de uma mídia (enviada ou recebida) e devolve com o
 * content-type correto.
 *
 * A URL que a Meta dá para uma mídia expira em poucos minutos e exige o
 * mesmo Bearer token da conta — por isso o proxy aqui, em vez de devolver
 * essa URL crua: o token nunca sai do servidor.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await autenticar(request, "messages:read");
  if ("resposta" in auth) return auth.resposta;

  const { id } = await params;

  try {
    const { bytes, mimeType } = await downloadMedia(id);
    return new Response(bytes, {
      headers: { "Content-Type": mimeType, "Cache-Control": "private, max-age=300" },
    });
  } catch (falha) {
    if (falha instanceof WhatsAppNaoConfiguradoError) {
      return erro(503, "whatsapp_not_connected", falha.message);
    }
    console.error("[api] falha ao baixar mídia:", falha);
    return erro(502, "download_failed", "Não foi possível baixar a mídia.");
  }
}
