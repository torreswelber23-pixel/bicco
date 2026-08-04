import { NextResponse } from "next/server";
import { isAdmin, negarAcesso } from "@/lib/admin-auth";
import { renovarToken } from "@/lib/token-refresh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Renovação manual, pelo botão do painel.
 *
 * Exige sessão de administrador: rotacionar credencial de produção não pode
 * ficar disponível para quem apenas descobriu a URL.
 */
export async function POST(): Promise<Response> {
  if (!(await isAdmin())) return negarAcesso();

  try {
    const resultado = await renovarToken();
    return NextResponse.json(resultado);
  } catch (erro) {
    console.error("[oauth] falha ao renovar:", erro);
    return NextResponse.json(
      { renovou: false, mensagem: "Falha ao renovar o token." },
      { status: 500 },
    );
  }
}
