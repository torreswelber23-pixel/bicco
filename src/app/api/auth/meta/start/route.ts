import crypto from "node:crypto";
import { cookies } from "next/headers";
import { isAdmin, negarAcesso } from "@/lib/admin-auth";
import { authorizeUrl } from "@/lib/meta-oauth";
import { redirectUriDe } from "@/lib/oauth-redirect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const STATE_COOKIE = "meta_oauth_state";

/**
 * Inicia a autorização com a Meta.
 *
 * Protegida por sessão de administrador: quem inicia o fluxo está prestes a
 * gravar credencial de produção, então não pode ser rota aberta.
 */
export async function GET(request: Request): Promise<Response> {
  if (!(await isAdmin())) return negarAcesso();

  // O state amarra a volta ao início e barra CSRF: o callback só aceita um
  // valor que ele mesmo emitiu neste navegador.
  const state = crypto.randomBytes(24).toString("base64url");

  const store = await cookies();
  store.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/auth/meta",
    maxAge: 60 * 10,
  });

  return Response.redirect(authorizeUrl(state, redirectUriDe(request)), 302);
}
