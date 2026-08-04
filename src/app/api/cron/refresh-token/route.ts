import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { renovarToken } from "@/lib/token-refresh";
import { diasRestantes, loadTokenMetadata } from "@/lib/whatsapp-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Renova só quando falta pouco, para não gastar troca à toa todo dia. */
const DIAS_PARA_RENOVAR = 15;

/**
 * Renovação automática do token, chamada pelo cron da Vercel.
 *
 * É o que impede o atendimento de parar sozinho ao fim dos ~60 dias. Sem isso,
 * o sintoma seria o pior possível: mensagens deixando de ser enviadas sem erro
 * visível para quem opera.
 *
 * A Vercel chama com o header Authorization contendo CRON_SECRET.
 */
export async function GET(request: Request): Promise<Response> {
  const autorizacao = request.headers.get("authorization");

  if (autorizacao !== `Bearer ${env.cronSecret}`) {
    console.warn("[cron] tentativa de renovação sem autorização válida");
    return new Response("não autorizado", { status: 401 });
  }

  const metadata = await loadTokenMetadata();
  const dias = diasRestantes(metadata);

  if (dias === null) {
    return NextResponse.json({
      acao: "nenhuma",
      motivo: "Token sem expiração ou nenhuma credencial conectada.",
    });
  }

  if (dias > DIAS_PARA_RENOVAR) {
    return NextResponse.json({
      acao: "nenhuma",
      motivo: `Ainda faltam ${dias} dias; renova a partir de ${DIAS_PARA_RENOVAR}.`,
      diasRestantes: dias,
    });
  }

  try {
    const resultado = await renovarToken();

    // Renovação que não estende prazo é um alarme, não um sucesso: significa
    // que só reconectar manualmente resolve, e alguém precisa saber disso.
    if (resultado.prazoInalterado) {
      console.error(
        "[cron] ATENÇÃO: token perto de expirar e a renovação não estendeu o prazo. " +
          `Faltam ${resultado.diasDepois} dias. Reconecte pelo painel /admin.`,
      );
    }

    return NextResponse.json({ acao: "renovacao", ...resultado });
  } catch (erro) {
    console.error("[cron] falha ao renovar token:", erro);
    return NextResponse.json(
      { acao: "erro", mensagem: "Falha ao renovar o token." },
      { status: 500 },
    );
  }
}
