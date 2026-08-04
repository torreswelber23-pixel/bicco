import crypto from "node:crypto";
import { cookies } from "next/headers";
import { env } from "./env";

/**
 * Sessão do painel administrativo.
 *
 * Vive separado da página porque as rotas de OAuth também precisam checar:
 * iniciar uma autorização ou renovar credencial são ações de administrador,
 * não endpoints públicos.
 */

export const ADMIN_COOKIE = "bicco_admin";

/** Valor esperado no cookie: derivado da senha, para não guardá-la em claro. */
export function sessionValue(): string {
  return crypto.createHash("sha256").update(env.adminPassword).digest("hex");
}

export async function isAdmin(): Promise<boolean> {
  const store = await cookies();
  const value = store.get(ADMIN_COOKIE)?.value;
  if (!value) return false;

  const esperado = Buffer.from(sessionValue(), "hex");
  const recebido = Buffer.from(value, "hex");

  if (esperado.length !== recebido.length) return false;
  return crypto.timingSafeEqual(esperado, recebido);
}

/** Resposta padrão para quem tenta acessar rota de admin sem sessão. */
export function negarAcesso(): Response {
  return new Response("acesso restrito", { status: 401 });
}
