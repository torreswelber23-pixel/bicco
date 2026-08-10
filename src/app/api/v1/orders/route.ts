import { autenticar, ok, paginacao } from "@/lib/api-http";
import { listOrders } from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Pedidos captados pela conversa do WhatsApp.
 *
 * É o que faz a integração valer a pena para um CRM: o pedido nasce na
 * conversa e aparece aqui já estruturado, sem ninguém transcrever nada.
 */
export async function GET(request: Request): Promise<Response> {
  const auth = await autenticar(request, "orders:read");
  if ("resposta" in auth) return auth.resposta;

  const { limit, offset } = paginacao(request);
  const status = new URL(request.url).searchParams.get("status");

  const pedidos = await listOrders(limit + offset);
  const recortados = pedidos
    .filter((pedido) => !status || pedido.status === status)
    .slice(offset, offset + limit);

  return ok({ data: recortados, limit, offset });
}
