import { autenticar, corpoJson, erro, ok } from "@/lib/api-http";
import { getOrder, setOrderStatus } from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUS_VALIDOS = [
  "pendente",
  "buscando_motorista",
  "atribuido",
  "a_caminho",
  "concluido",
  "cancelado",
];

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await autenticar(request, "orders:read");
  if ("resposta" in auth) return auth.resposta;

  const { id } = await params;
  const pedido = await getOrder(id);

  if (!pedido) return erro(404, "not_found", "Pedido não encontrado.");
  return ok(pedido);
}

/**
 * Muda o status do pedido a partir de fora.
 *
 * É o que permite ao CRM ser a fonte da verdade quando a operação acontece
 * lá: um pedido cancelado no painel do cliente precisa refletir aqui, senão
 * o motorista continua recebendo um trabalho que não existe mais.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await autenticar(request, "orders:write");
  if ("resposta" in auth) return auth.resposta;

  const body = await corpoJson(request);
  if ("resposta" in body) return body.resposta;

  const status = body.corpo.status;

  if (typeof status !== "string" || !STATUS_VALIDOS.includes(status)) {
    return erro(
      400,
      "invalid_status",
      `status deve ser um de: ${STATUS_VALIDOS.join(", ")}.`,
    );
  }

  const { id } = await params;
  const pedido = await getOrder(id);
  if (!pedido) return erro(404, "not_found", "Pedido não encontrado.");

  await setOrderStatus(id, status);

  return ok({ ...pedido, status });
}
