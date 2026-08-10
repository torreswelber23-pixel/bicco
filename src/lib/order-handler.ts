import { despacharPedido, resumoPedido } from "./dispatch";
import { closeFlowSession, createOrder, type Order } from "./repository";
import { emitirEvento } from "./webhooks-out";

/**
 * Regra de negócio de criação de pedido, chamada pelo webhook depois que o
 * cliente responde a última pergunta da conversa.
 *
 * Diferente do jeito anterior (formulário web com token na URL), aqui quem
 * já validou a sessão é o próprio webhook-handler — ele encontrou a sessão
 * aberta pelo contact_id de quem mandou a mensagem, então essa função só
 * grava e despacha.
 */

export interface DadosPedido {
  flowToken: string;
  contactId: string;
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
  const orderId = await createOrder({
    contactId: dados.contactId,
    flowToken: dados.flowToken,
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

  await closeFlowSession(dados.flowToken);

  const order: Order = {
    id: orderId,
    contact_id: dados.contactId,
    flow_token: dados.flowToken,
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

  await emitirEvento("order.created", { order });

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
