import { NextResponse } from "next/server";
import { criarPedido, UnknownOrderTokenError } from "@/lib/order-handler";
import { findFlowSession, getContact } from "@/lib/repository";
import { sendText } from "@/lib/whatsapp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PedidoBody {
  token?: string;
  nome?: string;
  tipo_servico?: string;
  origem?: string;
  destino?: string;
  endereco_coleta?: string;
  endereco_entrega?: string;
  item_descricao?: string;
  destinatario_nome?: string;
  destinatario_telefone?: string;
  quando?: string;
  data_preferida?: string;
  horario_preferido?: string;
}

/**
 * Recebe o pedido preenchido na página /pedido.
 *
 * Substitui o endpoint de dados do Flow: como a página é nossa (HTML normal,
 * não um componente da Meta), não precisa de criptografia RSA/AES nem de
 * bater com um schema fixo — só o token de sessão, gerado no webhook e
 * validado aqui contra flow_sessions.
 */
export async function POST(request: Request): Promise<Response> {
  let body: PedidoBody;
  try {
    body = (await request.json()) as PedidoBody;
  } catch {
    return NextResponse.json({ erro: "json inválido" }, { status: 400 });
  }

  const token = String(body.token ?? "").trim();
  const nome = String(body.nome ?? "").trim();
  const tipoServico = body.tipo_servico;
  const quando = body.quando === "agendado" ? "agendado" : "agora";

  if (!token || !nome || (tipoServico !== "corrida" && tipoServico !== "entrega")) {
    return NextResponse.json({ erro: "dados incompletos" }, { status: 400 });
  }

  if (tipoServico === "corrida" && (!body.origem || !body.destino)) {
    return NextResponse.json(
      { erro: "informe origem e destino" },
      { status: 400 },
    );
  }

  if (
    tipoServico === "entrega" &&
    (!body.endereco_coleta || !body.endereco_entrega || !body.item_descricao)
  ) {
    return NextResponse.json(
      { erro: "informe coleta, entrega e o que será entregue" },
      { status: 400 },
    );
  }

  if (quando === "agendado" && (!body.data_preferida || !body.horario_preferido)) {
    return NextResponse.json(
      { erro: "informe dia e horário" },
      { status: 400 },
    );
  }

  try {
    const resultado = await criarPedido({
      token,
      nome,
      tipoServico,
      origem: body.origem,
      destino: body.destino,
      enderecoColeta: body.endereco_coleta,
      enderecoEntrega: body.endereco_entrega,
      itemDescricao: body.item_descricao,
      destinatarioNome: body.destinatario_nome,
      destinatarioTelefone: body.destinatario_telefone,
      quando,
      dataPreferida: body.data_preferida,
      horarioPreferido: body.horario_preferido,
    });

    await confirmarNoWhatsApp(token, resultado.protocolo, resultado.resumo);

    return NextResponse.json(resultado);
  } catch (error) {
    if (error instanceof UnknownOrderTokenError) {
      return NextResponse.json(
        { erro: "Esta sessão expirou. Peça pra empresa mandar o link de novo." },
        { status: 410 },
      );
    }

    console.error("[pedido] falha ao criar pedido:", error);
    return NextResponse.json({ erro: "erro interno" }, { status: 500 });
  }
}

/**
 * criarPedido já fechou a flow_session antes daqui, mas findFlowSession não
 * filtra por status — só precisamos do contact_id pra achar o wa_id.
 */
async function confirmarNoWhatsApp(
  token: string,
  protocolo: string,
  resumo: string,
): Promise<void> {
  const session = await findFlowSession(token);
  if (!session) return;

  const contact = await getContact(session.contact_id);
  if (!contact) return;

  const linhas = [
    "Pedido registrado! ✅",
    `Protocolo: *${protocolo}*`,
    resumo,
    "",
    "Estamos buscando um motorista disponível. Assim que alguém aceitar, avisamos por aqui.",
  ];

  await sendText(contact.wa_id, linhas.filter(Boolean).join("\n")).catch((erro) =>
    console.error("[pedido] falha ao confirmar no WhatsApp:", erro),
  );
}
