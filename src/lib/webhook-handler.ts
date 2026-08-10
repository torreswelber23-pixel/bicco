import { QUANDO, SERVICOS, horariosDisponiveis, proximasDatas } from "./catalog";
import { resumoPedido } from "./dispatch";
import { criarPedido, protocoloDe } from "./order-handler";
import {
  bookedSlots,
  claimOrder,
  completeOrder,
  findDriverByPhone,
  findOpenSession,
  mergeFlowDraft,
  openFlowSession,
  recordMessage,
  upsertContact,
} from "./repository";
import {
  markAsRead,
  newFlowToken,
  sendButtons,
  sendList,
  sendLocationRequest,
  sendText,
} from "./whatsapp";
import { emitirEvento } from "./webhooks-out";

/**
 * Conversa nativa do WhatsApp: sem link, sem Flow, sem página externa.
 *
 * Cada pergunta é uma mensagem (lista, botões ou "envie sua localização"), e
 * a resposta chega como uma mensagem comum. O estado de "qual pergunta o
 * cliente está respondendo" vive em `flow_sessions.draft.step` — encontrado
 * pelo contact_id de quem mandou, já que não há token nenhum ida-e-volta.
 *
 * `button_reply` é ambíguo entre duas conversas diferentes (cliente
 * respondendo "Agora"/"Agendar" vs. motorista respondendo "Aceitar"/
 * "Recusar"/"Concluir"), então os ids dos botões do motorista sempre levam
 * ":" (`aceitar:<pedido>`) e os do cliente nunca levam — é assim que
 * `processMessage` decide pra qual lado mandar.
 */

interface WebhookMessage {
  from: string;
  id: string;
  type: string;
  text?: { body: string };
  interactive?: {
    type: string;
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string; description?: string };
  };
  location?: {
    latitude: number;
    longitude: number;
    name?: string;
    address?: string;
  };
}

interface WebhookValue {
  contacts?: Array<{ wa_id: string; profile?: { name?: string } }>;
  messages?: WebhookMessage[];
  statuses?: unknown[];
}

export interface WebhookPayload {
  object?: string;
  entry?: Array<{ changes?: Array<{ field?: string; value?: WebhookValue }> }>;
}

export async function processWebhook(payload: WebhookPayload): Promise<void> {
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value?.messages?.length) continue; // status de entrega: ignorado

      const profileName = value.contacts?.[0]?.profile?.name;

      for (const message of value.messages) {
        try {
          await processMessage(message, profileName);
        } catch (error) {
          // Um erro numa mensagem não pode impedir as outras nem gerar
          // reentrega infinita: a Meta reenvia enquanto não receber 200.
          console.error("[webhook] falha ao processar mensagem:", error);
        }
      }
    }
  }
}

async function processMessage(
  message: WebhookMessage,
  profileName: string | undefined,
): Promise<void> {
  await markAsRead(message.id).catch(() => {
    /* marcar como lida é cosmético */
  });

  const buttonId = message.interactive?.button_reply?.id;
  if (buttonId?.includes(":")) {
    await processarRespostaMotorista(message.from, buttonId);
    return;
  }

  const contact = await upsertContact(message.from, profileName);

  await recordMessage({
    contactId: contact.id,
    waMessageId: message.id,
    direction: "inbound",
    type: message.type,
    payload: message,
  });

  // Integrações externas ficam sabendo da mensagem no instante em que ela
  // chega, sem precisar perguntar de tempos em tempos.
  await emitirEvento("message.received", {
    contact_id: contact.id,
    wa_id: message.from,
    profile_name: profileName ?? contact.profile_name,
    message,
  });

  await avancarConversa(contact.id, message.from, message);
}

// --------------------------------------------------------------- conversa

type Passo =
  | "servico"
  | "nome"
  | "origem"
  | "destino"
  | "coleta"
  | "entrega_endereco"
  | "item"
  | "dest_nome"
  | "dest_telefone"
  | "quando"
  | "data"
  | "horario";

async function avancarConversa(
  contactId: string,
  to: string,
  message: WebhookMessage,
): Promise<void> {
  const aberta = await findOpenSession(contactId);

  if (!aberta) {
    await iniciarConversa(contactId, to);
    return;
  }

  const token = aberta.flow_token;
  const draft = aberta.draft;
  const passo = draft.step as Passo | undefined;

  const texto = message.text?.body?.trim();
  const listaId = message.interactive?.list_reply?.id;
  const botaoId = message.interactive?.button_reply?.id;
  const local = message.location;

  switch (passo) {
    case "servico": {
      if (listaId !== "corrida" && listaId !== "entrega") {
        await reenviarServico(to, "Escolha uma das opções da lista, por favor.");
        return;
      }
      await mergeFlowDraft(token, { tipo_servico: listaId });
      await sendText(to, "Qual seu nome?");
      await mergeFlowDraft(token, { step: "nome" satisfies Passo });
      return;
    }

    case "nome": {
      if (!texto) {
        await sendText(to, "Me diz seu nome, por texto mesmo.");
        return;
      }
      await mergeFlowDraft(token, { nome: texto });

      if (draft.tipo_servico === "entrega") {
        await sendLocationRequest(to, "Envie a localização de coleta.");
        await mergeFlowDraft(token, { step: "coleta" satisfies Passo });
      } else {
        await sendLocationRequest(to, "Envie a localização de partida.");
        await mergeFlowDraft(token, { step: "origem" satisfies Passo });
      }
      return;
    }

    case "origem": {
      if (!local) {
        await sendLocationRequest(
          to,
          "Preciso da localização — toque no clipe ou no botão abaixo e envie.",
        );
        return;
      }
      await mergeFlowDraft(token, { origem: formatarLocalizacao(local) });
      await sendLocationRequest(to, "Agora a localização de destino.");
      await mergeFlowDraft(token, { step: "destino" satisfies Passo });
      return;
    }

    case "destino": {
      if (!local) {
        await sendLocationRequest(to, "Preciso da localização de destino.");
        return;
      }
      await mergeFlowDraft(token, { destino: formatarLocalizacao(local) });
      await perguntarQuando(to, token);
      return;
    }

    case "coleta": {
      if (!local) {
        await sendLocationRequest(to, "Preciso da localização de coleta.");
        return;
      }
      await mergeFlowDraft(token, { endereco_coleta: formatarLocalizacao(local) });
      await sendLocationRequest(to, "Agora a localização de entrega.");
      await mergeFlowDraft(token, { step: "entrega_endereco" satisfies Passo });
      return;
    }

    case "entrega_endereco": {
      if (!local) {
        await sendLocationRequest(to, "Preciso da localização de entrega.");
        return;
      }
      await mergeFlowDraft(token, { endereco_entrega: formatarLocalizacao(local) });
      await sendText(to, "O que vai ser entregue?");
      await mergeFlowDraft(token, { step: "item" satisfies Passo });
      return;
    }

    case "item": {
      if (!texto) {
        await sendText(to, "Descreve rapidinho o que vai ser entregue.");
        return;
      }
      await mergeFlowDraft(token, { item_descricao: texto });
      await sendText(to, "Nome de quem vai receber? (ou responda \"pular\")");
      await mergeFlowDraft(token, { step: "dest_nome" satisfies Passo });
      return;
    }

    case "dest_nome": {
      if (!texto) {
        await sendText(to, "Responde o nome ou \"pular\".");
        return;
      }
      if (!ehPular(texto)) await mergeFlowDraft(token, { destinatario_nome: texto });
      await sendText(to, "Telefone de quem vai receber? (ou responda \"pular\")");
      await mergeFlowDraft(token, { step: "dest_telefone" satisfies Passo });
      return;
    }

    case "dest_telefone": {
      if (!texto) {
        await sendText(to, "Responde o telefone ou \"pular\".");
        return;
      }
      if (!ehPular(texto))
        await mergeFlowDraft(token, { destinatario_telefone: texto });
      await perguntarQuando(to, token);
      return;
    }

    case "quando": {
      if (botaoId !== "agora" && botaoId !== "agendado") {
        await sendButtons(to, "Escolha uma das opções abaixo.", quandoBotoes());
        return;
      }
      if (botaoId === "agora") {
        await finalizarPedido(contactId, to, token, { ...draft, quando: "agora" });
        return;
      }
      await mergeFlowDraft(token, { quando: "agendado" });
      await enviarListaDatas(to);
      await mergeFlowDraft(token, { step: "data" satisfies Passo });
      return;
    }

    case "data": {
      const datas = proximasDatas();
      if (!listaId || !datas.some((d) => d.id === listaId)) {
        await sendText(to, "Escolha um dia da lista, por favor.");
        await enviarListaDatas(to);
        return;
      }
      const ocupados = await bookedSlots(listaId);
      const horarios = horariosDisponiveis(ocupados).filter((h) => h.enabled !== false);

      if (horarios.length === 0) {
        await sendText(to, "Não sobrou horário livre nesse dia. Escolha outro:");
        await enviarListaDatas(to);
        return;
      }

      await mergeFlowDraft(token, { data_preferida: listaId });
      await sendList(
        to,
        "Escolha o horário:",
        "Ver horários",
        horarios.map((h) => ({ id: h.id, title: h.title })),
      );
      await mergeFlowDraft(token, { step: "horario" satisfies Passo });
      return;
    }

    case "horario": {
      const dataEscolhida = String(draft.data_preferida ?? "");
      const ocupados = dataEscolhida ? await bookedSlots(dataEscolhida) : [];
      const validos = horariosDisponiveis(ocupados).filter((h) => h.enabled !== false);

      if (!listaId || !validos.some((h) => h.id === listaId)) {
        await sendText(to, "Escolha um horário da lista.");
        return;
      }

      await finalizarPedido(contactId, to, token, {
        ...draft,
        horario_preferido: listaId,
      });
      return;
    }

    default: {
      // Sessão sem passo reconhecível (não deveria acontecer): reinicia.
      await iniciarConversa(contactId, to);
    }
  }
}

async function iniciarConversa(contactId: string, to: string): Promise<void> {
  const token = newFlowToken();
  await openFlowSession(token, contactId);
  await mergeFlowDraft(token, { step: "servico" satisfies Passo });
  await enviarListaServicos(to);
}

async function reenviarServico(to: string, aviso: string): Promise<void> {
  await sendText(to, aviso);
  await enviarListaServicos(to);
}

async function enviarListaServicos(to: string): Promise<void> {
  await sendList(
    to,
    "Olá! O que você precisa?",
    "Ver opções",
    SERVICOS.map((s) => ({ id: s.id, title: s.title, description: s.description })),
  );
}

function quandoBotoes() {
  return QUANDO.map((q) => ({ id: q.id, title: q.title }));
}

async function perguntarQuando(to: string, token: string): Promise<void> {
  await sendButtons(to, "Quando?", quandoBotoes());
  await mergeFlowDraft(token, { step: "quando" satisfies Passo });
}

async function enviarListaDatas(to: string): Promise<void> {
  const datas = proximasDatas();
  await sendList(
    to,
    "Escolha o dia:",
    "Ver dias",
    datas.map((d) => ({ id: d.id, title: d.title })),
  );
}

function ehPular(texto: string): boolean {
  return texto.trim().toLowerCase() === "pular";
}

function formatarLocalizacao(local: NonNullable<WebhookMessage["location"]>): string {
  if (local.address) return local.address;
  if (local.name) return `${local.name} (${local.latitude}, ${local.longitude})`;
  return `${local.latitude}, ${local.longitude}`;
}

async function finalizarPedido(
  contactId: string,
  to: string,
  token: string,
  draft: Record<string, unknown>,
): Promise<void> {
  const tipoServico = draft.tipo_servico;
  if (tipoServico !== "corrida" && tipoServico !== "entrega") {
    console.error("[webhook] draft sem tipo_servico válido ao finalizar:", draft);
    return;
  }

  const resultado = await criarPedido({
    flowToken: token,
    contactId,
    nome: String(draft.nome ?? ""),
    tipoServico,
    origem: asText(draft.origem),
    destino: asText(draft.destino),
    enderecoColeta: asText(draft.endereco_coleta),
    enderecoEntrega: asText(draft.endereco_entrega),
    itemDescricao: asText(draft.item_descricao),
    destinatarioNome: asText(draft.destinatario_nome),
    destinatarioTelefone: asText(draft.destinatario_telefone),
    quando: draft.quando === "agendado" ? "agendado" : "agora",
    dataPreferida: asText(draft.data_preferida),
    horarioPreferido: asText(draft.horario_preferido),
  });

  const linhas = [
    "Pedido registrado! ✅",
    `Protocolo: *${resultado.protocolo}*`,
    resultado.resumo,
    "",
    "Estamos buscando um motorista disponível. Assim que alguém aceitar, avisamos por aqui.",
  ];

  await sendText(to, linhas.filter(Boolean).join("\n"));
}

function asText(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const text = String(value).trim();
  return text.length > 0 ? text : undefined;
}

// ------------------------------------------------------------ motoristas

async function processarRespostaMotorista(from: string, buttonId: string): Promise<void> {
  const [acao, orderId] = buttonId.split(":");
  if (!orderId) return;

  const motorista = await findDriverByPhone(from);
  if (!motorista) {
    console.error(
      "[webhook] resposta de botão de número não cadastrado como motorista:",
      from,
    );
    return;
  }

  if (acao === "aceitar") {
    const order = await claimOrder(orderId, motorista.id);

    if (!order) {
      await sendText(
        from,
        "Esse pedido já foi atendido por outro motorista. Obrigado por responder!",
      );
      return;
    }

    await sendButtons(
      from,
      `Você aceitou! Protocolo ${protocoloDe(order.id)}\n\n${resumoPedido(order)}`,
      [{ id: `concluir:${order.id}`, title: "Marcar concluído" }],
    );

    await emitirEvento("order.assigned", {
      order,
      driver: { id: motorista.id, nome: motorista.nome, telefone: motorista.telefone },
    });

    const clienteWaId = order.contacts?.wa_id;
    if (clienteWaId) {
      await sendText(
        clienteWaId,
        `Seu pedido foi aceito! ✅\nMotorista: ${motorista.nome}\nContato: ${motorista.telefone}`,
      );
    }
    return;
  }

  if (acao === "concluir") {
    const order = await completeOrder(orderId, motorista.id);

    if (!order) {
      await sendText(from, "Não encontrei esse pedido em aberto pra você.");
      return;
    }

    await emitirEvento("order.completed", {
      order,
      driver: { id: motorista.id, nome: motorista.nome, telefone: motorista.telefone },
    });

    await sendText(from, "Marcado como concluído. Obrigado!");

    const clienteWaId = order.contacts?.wa_id;
    if (clienteWaId) {
      await sendText(clienteWaId, "Serviço concluído. Obrigado por usar o bicco!");
    }
    return;
  }

  // "recusar": só reconhece, não muda o pedido — outro motorista ainda pode aceitar.
}
