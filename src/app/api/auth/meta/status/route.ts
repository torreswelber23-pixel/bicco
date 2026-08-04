import { NextResponse } from "next/server";
import { isAdmin, negarAcesso } from "@/lib/admin-auth";
import {
  diasRestantes,
  loadTokenMetadata,
  loadWhatsAppConfig,
} from "@/lib/whatsapp-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Estado da conexão com a Meta. Nunca devolve o token, só o resumo. */
export async function GET(): Promise<Response> {
  if (!(await isAdmin())) return negarAcesso();

  const credenciais = await loadWhatsAppConfig();
  const metadata = await loadTokenMetadata();
  const dias = diasRestantes(metadata);

  return NextResponse.json({
    conectado: Boolean(credenciais),
    phoneNumberId: credenciais?.phoneNumberId ?? null,
    wabaId: credenciais?.wabaId ?? null,
    origem: metadata?.source ?? (credenciais ? "env" : null),
    conectadoPor: metadata?.connectedBy ?? null,
    conectadoEm: metadata?.connectedAt ?? null,
    expiraEm: metadata?.expiresAt ?? null,
    diasRestantes: dias,
    precisaAtencao: dias !== null && dias <= 7,
  });
}
