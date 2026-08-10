import { NextResponse } from "next/server";
import { verificarChave, type ApiKey } from "./api-keys";

/**
 * Convenções da API pública.
 *
 * Erro sempre com a mesma forma (`{ error: { code, message } }`) porque quem
 * integra escreve o tratamento uma vez só; erro que muda de formato conforme
 * a rota obriga o cliente a adivinhar.
 */

export interface ErroApi {
  code: string;
  message: string;
  details?: unknown;
}

export function erro(
  status: number,
  code: string,
  message: string,
  details?: unknown,
): NextResponse {
  return NextResponse.json({ error: { code, message, details } as ErroApi }, { status });
}

export function ok(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

/**
 * Autentica pela chave em `Authorization: Bearer <chave>`.
 *
 * Devolve a chave OU uma resposta pronta de erro — quem chama testa qual dos
 * dois veio. É verboso de propósito: um guard que devolve `null` para "sem
 * acesso" convida a esquecer o `return`, e o endpoint responde como se
 * estivesse autenticado.
 */
export async function autenticar(
  request: Request,
  escopo?: string,
): Promise<{ chave: ApiKey } | { resposta: NextResponse }> {
  const header = request.headers.get("authorization");

  if (!header?.startsWith("Bearer ")) {
    return {
      resposta: erro(
        401,
        "unauthorized",
        "Envie a chave em Authorization: Bearer <chave>.",
      ),
    };
  }

  const chave = await verificarChave(header.slice("Bearer ".length).trim());

  if (!chave) {
    return {
      resposta: erro(401, "invalid_key", "Chave inválida ou revogada."),
    };
  }

  if (escopo && !chave.escopos.includes(escopo)) {
    return {
      resposta: erro(
        403,
        "forbidden",
        `Esta chave não tem o escopo "${escopo}".`,
      ),
    };
  }

  return { chave };
}

/** Lê e valida o corpo JSON, devolvendo erro pronto quando não dá. */
export async function corpoJson(
  request: Request,
): Promise<{ corpo: Record<string, unknown> } | { resposta: NextResponse }> {
  try {
    const corpo = await request.json();
    if (typeof corpo !== "object" || corpo === null || Array.isArray(corpo)) {
      return { resposta: erro(400, "invalid_body", "O corpo deve ser um objeto JSON.") };
    }
    return { corpo: corpo as Record<string, unknown> };
  } catch {
    return { resposta: erro(400, "invalid_json", "Corpo não é JSON válido.") };
  }
}

/** Paginação por limit/offset, com teto para não deixar varrer a base inteira. */
export function paginacao(request: Request): { limit: number; offset: number } {
  const params = new URL(request.url).searchParams;
  const limit = Math.min(Math.max(Number(params.get("limit") ?? 50) || 50, 1), 200);
  const offset = Math.max(Number(params.get("offset") ?? 0) || 0, 0);
  return { limit, offset };
}
