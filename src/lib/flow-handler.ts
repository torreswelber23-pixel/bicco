import type { FlowRequestBody } from "./flow-crypto";
import {
  CANAIS,
  ORCAMENTOS,
  SERVICOS,
  URGENCIAS,
  horariosDisponiveis,
  labelOf,
  proximasDatas,
} from "./catalog";
import {
  bookedSlots,
  closeFlowSession,
  createLead,
  findFlowSession,
  mergeFlowDraft,
} from "./repository";
import { supabase } from "./supabase";

/**
 * Regras de negócio do endpoint de dados.
 *
 * Contrato: para cada requisição devolvemos a PRÓXIMA tela e os dados dela.
 * O cliente não guarda estado entre telas, então o rascunho vive em
 * flow_sessions.draft e o flow_token é a única credencial que temos.
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
    return telaDemanda(session.contact_id);
  }

  if (request.action === "BACK") {
    return voltarPara(request.screen, session.contact_id);
  }

  const origem = String(request.data?.screen ?? request.screen ?? "");

  switch (origem) {
    case "DEMANDA": {
      await mergeFlowDraft(flowToken, {
        nome: request.data?.nome,
        tipo_servico: request.data?.tipo_servico,
        descricao: request.data?.descricao,
      });
      return telaDetalhes();
    }

    case "DETALHES": {
      await mergeFlowDraft(flowToken, {
        urgencia: request.data?.urgencia,
        orcamento: request.data?.orcamento,
        canal_preferido: request.data?.canal_preferido,
      });
      return telaAgendamento();
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

async function telaDemanda(contactId: string): Promise<FlowResponse> {
  const { data } = await supabase()
    .from("contacts")
    .select("profile_name")
    .eq("id", contactId)
    .maybeSingle();

  return {
    screen: "DEMANDA",
    data: {
      servicos: SERVICOS,
      nome_sugerido: (data as { profile_name?: string } | null)?.profile_name ?? "",
    },
  };
}

function telaDetalhes(): FlowResponse {
  return {
    screen: "DETALHES",
    data: {
      urgencias: URGENCIAS,
      orcamentos: ORCAMENTOS,
      canais: CANAIS,
    },
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
  const leadId = await createLead({
    contactId,
    flowToken,
    nome: asText(draft.nome),
    tipoServico: asText(draft.tipo_servico),
    descricao: asText(draft.descricao),
    urgencia: asText(draft.urgencia),
    orcamento: asText(draft.orcamento),
    canalPreferido: asText(draft.canal_preferido),
    dataPreferida: asText(draft.data_preferida),
    horarioPreferido: asText(draft.horario_preferido),
    raw: draft,
  });

  await closeFlowSession(flowToken);

  return {
    screen: "RESUMO",
    data: {
      protocolo: protocoloDe(leadId),
      resumo: resumoDe(draft),
    },
  };
}

/** Primeiros 6 caracteres do UUID viram um protocolo legível ao telefone. */
export function protocoloDe(leadId: string): string {
  return `BIC-${leadId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}

export function resumoDe(draft: Record<string, unknown>): string {
  const partes = [
    labelOf(SERVICOS, asText(draft.tipo_servico) ?? undefined),
    labelOf(URGENCIAS, asText(draft.urgencia) ?? undefined),
    formatarAgenda(asText(draft.data_preferida), asText(draft.horario_preferido)),
  ];
  return partes.filter((parte) => parte && parte !== "—").join(" · ");
}

function formatarAgenda(data: string | null, horario: string | null): string {
  if (!data) return "";
  const [ano, mes, dia] = data.split("-");
  const dataBr = `${dia}/${mes}/${ano}`;
  return horario ? `${dataBr} às ${horario}` : dataBr;
}

function asText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

/** BACK: o cliente pede a tela anterior, que precisa vir repopulada. */
async function voltarPara(
  screen: string | undefined,
  contactId: string,
): Promise<FlowResponse> {
  switch (screen) {
    case "AGENDAMENTO":
      return telaDetalhes();
    case "DETALHES":
      return telaDemanda(contactId);
    default:
      return telaDemanda(contactId);
  }
}
