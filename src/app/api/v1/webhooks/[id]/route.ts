import { autenticar, erro, ok } from "@/lib/api-http";
import { removerWebhook } from "@/lib/webhooks-out";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await autenticar(request);
  if ("resposta" in auth) return auth.resposta;

  const { id } = await params;
  const removido = await removerWebhook(id);

  if (!removido) return erro(404, "not_found", "Webhook não encontrado.");
  return ok({ deleted: true, id });
}
