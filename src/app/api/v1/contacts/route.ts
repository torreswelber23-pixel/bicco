import { autenticar, ok, paginacao } from "@/lib/api-http";
import { listContacts } from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Quem já falou com o número, do contato mais recente para o mais antigo. */
export async function GET(request: Request): Promise<Response> {
  const auth = await autenticar(request, "contacts:read");
  if ("resposta" in auth) return auth.resposta;

  const { limit, offset } = paginacao(request);
  const busca = new URL(request.url).searchParams.get("q") ?? undefined;

  const contatos = await listContacts({ limit, offset, busca });

  return ok({ data: contatos, limit, offset });
}
