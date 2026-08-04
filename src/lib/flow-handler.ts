import type { FlowRequestBody } from "./flow-crypto";
import { QUANDO, SERVICOS, horariosDisponiveis, proximasDatas } from "./catalog";
import { despacharPedido, resumoPedido } from "./dispatch";
import {
  bookedSlots,
  closeFlowSession,
  createOrder,
  findFlowSession,
  mergeFlowDraft,
  type Order,
} from "./repository";

/**
 * Regras de negócio do endpoint de dados.
 *
 * Contrato: para cada requisição devolvemos a PRÓXIMA tela e os dados dela.
 * O cliente não guarda estado entre telas, então o rascunho vive em
 * flow_sessions.draft e o flow_token é a única credencial que temos.
 *
 * Navegação: SERVICO decide entre CORRIDA e ENTREGA; as duas levam a
 * AGENDAMENTO só quando o cliente escolhe "agendado" — se for "agora", pula
 * direto para o RESUMO e o pedido já sai buscando motorista.
 */

export interface FlowResponse {
  screen?: string;
  data: Record<string, unknown>;
  version?: string;
}

export class UnknownFlowTokenError extends Error {
  constructor() {
    super("flow_token não corresponde a nenhuma sessão aberta.");
    this.name = "UnknownFlowTokenError";
  }
}

export async function handleFlowRequest(
  request: FlowRequestBody,
): Promise<FlowResponse> {
  // 1. Health check da Meta — acontece antes de qualquer sessão existir.
  if (request.action === "ping") {
    return { data: { status: "active" } };
  }

  // 2. Notificação de erro do cliente: só precisa ser confirmada.
  if (request.data?.error_message || request.data?.error) {
    console.error("[flow] erro reportado pelo cliente:", request.data);
    return { data: { acknowledged: true } };
  }

  const flowToken = request.flow_token;
  if (!flowToken) throw new UnknownFlowTokenError();

  const session = await findFlowSession(flowToken);
  if (!session) throw new UnknownFlowTokenError();

  if (request.action === "INIT") {
    return telaServico();
  }

  if (request.action === "BACK") {
    return voltarPara(request.screen, session.draft);
  }

  const origem = String(request.data?.screen ?? request.screen ?? "");

  switch (origem) {
    case "SERVICO": {
      const draft = await mergeFlowDraft(flowToken, {
        nome: request.data?.nome,
        tipo_servico: request.data?.tipo_servico,
      });
      return draft.tipo_servico === "entrega" ? telaEntrega() : telaCorrida();
    }

    case "CORRIDA": {
      const draft = await mergeFlowDraft(flowToken, {
        origem: request.data?.origem,
        destino: request.data?.destino,
        quando: request.data?.quando,
      });
      return draft.quando === "agendado"
        ? telaAgendamento()
        : finalizar(flowToken, session.contact_id, draft);
    }

    case "ENTREGA": {
      const draft = await mergeFlowDraft(flowToken, {
        endereco_coleta: request.data?.endereco_coleta,
        endereco_entrega: request.data?.endereco_entrega,
        item_descricao: request.data?.item_descricao,
        destinatario_nome: request.data?.destinatario_nome,
        destinatario_telefone: request.data?.destinatario_telefone,
        quando: request.data?.quando,
      });
      return draft.quando === "agendado"
        ? telaAgendamento()
        : finalizar(flowToken, session.contact_id, draft);
    }

    // Disparado pelo on-select-action do seletor de data: recarrega apenas os
    // horários daquele dia, sem avançar de tela.
    case "AGENDAMENTO_SLOTS": {
      const data = String(request.data?.data_preferida ?? "");
      return telaAgendamento(data);
    }

    case "AGENDAMENTO": {
      const draft = await mergeFlowDraft(flowToken, {
        data_preferida: request.data?.data_preferida,
        horario_preferido: request.data?.horario_preferido,
      });
      return finalizar(flowToken, session.contact_id, draft);
    }

    default:
      throw new Error(`Tela de origem desconhecida: "${origem}"`);
  }
}

export function telaServico(): FlowResponse {
  return {
    screen: "SERVICO",
    data: { servicos: SERVICOS },
  };
}

function telaCorrida(): FlowResponse {
  return {
    screen: "CORRIDA",
    data: { quandos: QUANDO },
  };
}

function telaEntrega(): FlowResponse {
  return {
    screen: "ENTREGA",
    data: { quandos: QUANDO },
  };
}

async function telaAgendamento(dataSelecionada?: string): Promise<FlowResponse> {
  const datas = proximasDatas();
  const alvo = dataSelecionada || datas[0]?.id;
  const ocupados = alvo ? await bookedSlots(alvo) : [];

  return {
    screen: "AGENDAMENTO",
    data: {
      datas,
      horarios: horariosDisponiveis(ocupados),
    },
  };
}

async function finalizar(
  flowToken: string,
  contactId: string,
  draft: Record<string, unknown>,
): Promise<FlowResponse> {
  const tipoServico = asText(draft.tipo_servico);
  if (tipoServico !== "corrida" && tipoServico !== "entrega") {
    throw new Error(`tipo_servico inválido no rascunho: "${tipoServico}"`);
  }

  const orderId = await createOrder({
    contactId,
    flowToken,
    nome: asText(draft.nome),
    tipoServico,
    origem: asText(draft.origem),
    destino: asText(draft.destino),
    enderecoColeta: asText(draft.endereco_coleta),
    enderecoEntrega: asText(draft.endereco_entrega),
    itemDescricao: asText(draft.item_descricao),
    destinatarioNome: asText(draft.destinatario_nome),
    destinatarioTelefone: asText(draft.destinatario_telefone),
    quando: asText(draft.quando) ?? "agora",
    dataPreferida: asText(draft.data_preferida),
    horarioPreferido: asText(draft.horario_preferido),
    raw: draft,
  });

  await closeFlowSession(flowToken);

  const order: Order = {
    id: orderId,
    contact_id: contactId,
    flow_token: flowToken,
    nome: asText(draft.nome),
    tipo_servico: tipoServico,
    origem: asText(draft.origem),
    destino: asText(draft.destino),
    endereco_coleta: asText(draft.endereco_coleta),
    endereco_entrega: asText(draft.endereco_entrega),
    item_descricao: asText(draft.item_descricao),
    destinatario_nome: asText(draft.destinatario_nome),
    destinatario_telefone: asText(draft.destinatario_telefone),
    observacoes: null,
    quando: asText(draft.quando) ?? "agora",
    data_preferida: asText(draft.data_preferida),
    horario_preferido: asText(draft.horario_preferido),
    driver_id: null,
    status: "pendente",
    created_at: new Date().toISOString(),
  };

  // Não bloqueia a resposta ao cliente por muito tempo: é só notificações,
  // e se falhar o pedido continua visível no painel para atender manualmente.
  await despacharPedido(order).catch((erro) =>
    console.error("[flow] falha ao despachar pedido:", erro),
  );

  return {
    screen: "RESUMO",
    data: {
      protocolo: protocoloDe(orderId),
      resumo: resumoPedido(order),
    },
  };
}

/** Primeiros 6 caracteres do UUID viram um protocolo legível ao telefone. */
export function protocoloDe(orderId: string): string {
  return `BIC-${orderId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}

function asText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

/** BACK: o cliente pede a tela anterior, que precisa vir repopulada. */
function voltarPara(
  screen: string | undefined,
  draft: Record<string, unknown>,
): FlowResponse {
  switch (screen) {
    case "AGENDAMENTO":
      return draft.tipo_servico === "entrega" ? telaEntrega() : telaCorrida();
    default:
      return telaServico();
  }
}
