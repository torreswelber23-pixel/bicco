import { despacharPedido, resumoPedido } from "./dispatch";
import {
  closeFlowSession,
  createOrder,
  findFlowSession,
  type Order,
} from "./repository";

/**
 * Regra de negócio de criação de pedido, chamada pela rota /api/pedido depois
 * que o cliente preenche o formulário na página web.
 */

export class UnknownOrderTokenError extends Error {
  constructor() {
    super("token não corresponde a nenhuma sessão aberta.");
    this.name = "UnknownOrderTokenError";
  }
}

export interface DadosPedido {
  token: string;
  nome: string;
  tipoServico: "corrida" | "entrega";
  origem?: string;
  destino?: string;
  enderecoColeta?: string;
  enderecoEntrega?: string;
  itemDescricao?: string;
  destinatarioNome?: string;
  destinatarioTelefone?: string;
  quando: "agora" | "agendado";
  dataPreferida?: string;
  horarioPreferido?: string;
}

export interface ResultadoPedido {
  protocolo: string;
  resumo: string;
}

export async function criarPedido(dados: DadosPedido): Promise<ResultadoPedido> {
  const session = await findFlowSession(dados.token);
  if (!session || session.status !== "open") throw new UnknownOrderTokenError();

  const orderId = await createOrder({
    contactId: session.contact_id,
    flowToken: dados.token,
    nome: dados.nome,
    tipoServico: dados.tipoServico,
    origem: dados.origem ?? null,
    destino: dados.destino ?? null,
    enderecoColeta: dados.enderecoColeta ?? null,
    enderecoEntrega: dados.enderecoEntrega ?? null,
    itemDescricao: dados.itemDescricao ?? null,
    destinatarioNome: dados.destinatarioNome ?? null,
    destinatarioTelefone: dados.destinatarioTelefone ?? null,
    quando: dados.quando,
    dataPreferida: dados.dataPreferida ?? null,
    horarioPreferido: dados.horarioPreferido ?? null,
    raw: dados,
  });

  await closeFlowSession(dados.token);

  const order: Order = {
    id: orderId,
    contact_id: session.contact_id,
    flow_token: dados.token,
    nome: dados.nome,
    tipo_servico: dados.tipoServico,
    origem: dados.origem ?? null,
    destino: dados.destino ?? null,
    endereco_coleta: dados.enderecoColeta ?? null,
    endereco_entrega: dados.enderecoEntrega ?? null,
    item_descricao: dados.itemDescricao ?? null,
    destinatario_nome: dados.destinatarioNome ?? null,
    destinatario_telefone: dados.destinatarioTelefone ?? null,
    observacoes: null,
    quando: dados.quando,
    data_preferida: dados.dataPreferida ?? null,
    horario_preferido: dados.horarioPreferido ?? null,
    driver_id: null,
    status: "pendente",
    created_at: new Date().toISOString(),
  };

  // Não bloqueia a resposta ao cliente por muito tempo: é só notificações,
  // e se falhar o pedido continua visível no painel para atender manualmente.
  await despacharPedido(order).catch((erro) =>
    console.error("[pedido] falha ao despachar:", erro),
  );

  return { protocolo: protocoloDe(orderId), resumo: resumoPedido(order) };
}

/** Primeiros 6 caracteres do UUID viram um protocolo legível ao telefone. */
export function protocoloDe(orderId: string): string {
  return `BIC-${orderId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}
