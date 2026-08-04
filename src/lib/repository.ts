import { supabase } from "./supabase";

export interface Contact {
  id: string;
  wa_id: string;
  profile_name: string | null;
}

export interface Driver {
  id: string;
  nome: string;
  telefone: string;
  tipo: "corrida" | "entrega" | "ambos";
  disponivel: boolean;
  created_at: string;
}

export interface Order {
  id: string;
  contact_id: string;
  flow_token: string | null;
  nome: string | null;
  tipo_servico: "corrida" | "entrega" | null;
  origem: string | null;
  destino: string | null;
  endereco_coleta: string | null;
  endereco_entrega: string | null;
  item_descricao: string | null;
  destinatario_nome: string | null;
  destinatario_telefone: string | null;
  observacoes: string | null;
  quando: string;
  data_preferida: string | null;
  horario_preferido: string | null;
  driver_id: string | null;
  status: string;
  created_at: string;
  contacts?: { wa_id: string; profile_name: string | null } | null;
  drivers?: { nome: string; telefone: string } | null;
}

/** Busca o contato pelo wa_id, criando-o na primeira mensagem. */
export async function upsertContact(
  waId: string,
  profileName?: string,
): Promise<Contact> {
  const db = supabase();

  const { data, error } = await db
    .from("contacts")
    .upsert(
      {
        wa_id: waId,
        ...(profileName ? { profile_name: profileName } : {}),
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "wa_id" },
    )
    .select("id, wa_id, profile_name")
    .single();

  if (error) throw new Error(`Falha ao gravar contato: ${error.message}`);
  return data as Contact;
}

export async function recordMessage(params: {
  contactId: string;
  waMessageId?: string;
  direction: "inbound" | "outbound";
  type: string;
  payload: unknown;
}): Promise<void> {
  const db = supabase();

  const { error } = await db.from("messages").upsert(
    {
      contact_id: params.contactId,
      wa_message_id: params.waMessageId ?? null,
      direction: params.direction,
      type: params.type,
      payload: params.payload ?? {},
    },
    { onConflict: "wa_message_id", ignoreDuplicates: true },
  );

  // Log de auditoria não deve derrubar o atendimento.
  if (error) console.error("[repository] recordMessage:", error.message);
}

export async function openFlowSession(
  flowToken: string,
  contactId: string,
): Promise<void> {
  const db = supabase();
  const { error } = await db
    .from("flow_sessions")
    .upsert({ flow_token: flowToken, contact_id: contactId, status: "open" }, {
      onConflict: "flow_token",
    });

  if (error) throw new Error(`Falha ao abrir sessão do Flow: ${error.message}`);
}

/**
 * Resolve o dono de uma sessão do Flow.
 *
 * O endpoint de dados recebe só o flow_token, então é essa tabela que impede
 * que um token forjado grave pedido em nome de outro contato.
 */
export async function findFlowSession(flowToken: string): Promise<{
  contact_id: string;
  status: string;
  draft: Record<string, unknown>;
} | null> {
  const db = supabase();
  const { data, error } = await db
    .from("flow_sessions")
    .select("contact_id, status, draft")
    .eq("flow_token", flowToken)
    .maybeSingle();

  if (error) throw new Error(`Falha ao ler sessão do Flow: ${error.message}`);
  if (!data) return null;

  const row = data as {
    contact_id: string;
    status: string;
    draft: Record<string, unknown> | null;
  };
  return { ...row, draft: row.draft ?? {} };
}

/** Acumula as respostas de uma tela no rascunho da sessão. */
export async function mergeFlowDraft(
  flowToken: string,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const session = await findFlowSession(flowToken);
  if (!session) throw new Error("Sessão do Flow desconhecida.");

  const draft = { ...session.draft, ...patch };

  const { error } = await supabase()
    .from("flow_sessions")
    .update({ draft, updated_at: new Date().toISOString() })
    .eq("flow_token", flowToken);

  if (error) throw new Error(`Falha ao gravar rascunho: ${error.message}`);
  return draft;
}

export async function closeFlowSession(flowToken: string): Promise<void> {
  const { error } = await supabase()
    .from("flow_sessions")
    .update({ status: "completed", updated_at: new Date().toISOString() })
    .eq("flow_token", flowToken);

  if (error) console.error("[repository] closeFlowSession:", error.message);
}

export async function createOrder(order: {
  contactId: string;
  flowToken: string | null;
  nome?: string | null;
  tipoServico: "corrida" | "entrega";
  origem?: string | null;
  destino?: string | null;
  enderecoColeta?: string | null;
  enderecoEntrega?: string | null;
  itemDescricao?: string | null;
  destinatarioNome?: string | null;
  destinatarioTelefone?: string | null;
  observacoes?: string | null;
  quando: string;
  dataPreferida?: string | null;
  horarioPreferido?: string | null;
  raw: unknown;
}): Promise<string> {
  const db = supabase();

  const { data, error } = await db
    .from("leads")
    .insert({
      contact_id: order.contactId,
      flow_token: order.flowToken,
      nome: order.nome ?? null,
      tipo_servico: order.tipoServico,
      origem: order.origem ?? null,
      destino: order.destino ?? null,
      endereco_coleta: order.enderecoColeta ?? null,
      endereco_entrega: order.enderecoEntrega ?? null,
      item_descricao: order.itemDescricao ?? null,
      destinatario_nome: order.destinatarioNome ?? null,
      destinatario_telefone: order.destinatarioTelefone ?? null,
      observacoes: order.observacoes ?? null,
      quando: order.quando,
      data_preferida: order.dataPreferida ?? null,
      horario_preferido: order.horarioPreferido ?? null,
      raw: order.raw ?? {},
    })
    .select("id")
    .single();

  if (error) throw new Error(`Falha ao gravar pedido: ${error.message}`);
  return (data as { id: string }).id;
}

export async function listOrders(limit = 100): Promise<Order[]> {
  const db = supabase();
  const { data, error } = await db
    .from("leads")
    .select("*, contacts ( wa_id, profile_name ), drivers ( nome, telefone )")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Falha ao listar pedidos: ${error.message}`);
  return (data ?? []) as Order[];
}

export async function getOrder(orderId: string): Promise<Order | null> {
  const db = supabase();
  const { data, error } = await db
    .from("leads")
    .select("*, contacts ( wa_id, profile_name ), drivers ( nome, telefone )")
    .eq("id", orderId)
    .maybeSingle();

  if (error) throw new Error(`Falha ao ler pedido: ${error.message}`);
  return data as Order | null;
}

export async function setOrderStatus(
  orderId: string,
  status: string,
): Promise<void> {
  const { error } = await supabase()
    .from("leads")
    .update({ status })
    .eq("id", orderId);

  if (error) console.error("[repository] setOrderStatus:", error.message);
}

/**
 * Atribui o pedido ao primeiro motorista/entregador que aceitar.
 *
 * A condição `status = 'buscando_motorista'` no WHERE é o que resolve a
 * corrida entre dois motoristas tocando "Aceitar" quase ao mesmo tempo: só a
 * primeira UPDATE encontra a linha nesse estado e a devolve; a segunda não
 * atualiza nada, e é assim que o código chamador sabe que perdeu a corrida.
 */
export async function claimOrder(
  orderId: string,
  driverId: string,
): Promise<Order | null> {
  const db = supabase();
  const { data, error } = await db
    .from("leads")
    .update({ driver_id: driverId, status: "atribuido" })
    .eq("id", orderId)
    .eq("status", "buscando_motorista")
    .select("*, contacts ( wa_id, profile_name ), drivers ( nome, telefone )")
    .maybeSingle();

  if (error) throw new Error(`Falha ao atribuir pedido: ${error.message}`);
  return data as Order | null;
}

export async function completeOrder(
  orderId: string,
  driverId: string,
): Promise<Order | null> {
  const db = supabase();
  const { data, error } = await db
    .from("leads")
    .update({ status: "concluido" })
    .eq("id", orderId)
    .eq("driver_id", driverId)
    .in("status", ["atribuido", "a_caminho"])
    .select("*, contacts ( wa_id, profile_name )")
    .maybeSingle();

  if (error) throw new Error(`Falha ao concluir pedido: ${error.message}`);
  return data as Order | null;
}

/** Horários já reservados numa data, para não oferecer slot ocupado no Flow. */
export async function bookedSlots(date: string): Promise<string[]> {
  const db = supabase();
  const { data, error } = await db
    .from("leads")
    .select("horario_preferido")
    .eq("data_preferida", date)
    .not("horario_preferido", "is", null);

  if (error) {
    console.error("[repository] bookedSlots:", error.message);
    return [];
  }

  return (data ?? [])
    .map((row) => (row as { horario_preferido: string }).horario_preferido)
    .filter(Boolean);
}

export async function findDriverByPhone(waId: string): Promise<Driver | null> {
  const db = supabase();
  const { data, error } = await db
    .from("drivers")
    .select("*")
    .eq("telefone", waId)
    .maybeSingle();

  if (error) throw new Error(`Falha ao ler motorista: ${error.message}`);
  return data as Driver | null;
}

export async function listAvailableDrivers(
  tipoServico: "corrida" | "entrega",
): Promise<Driver[]> {
  const db = supabase();
  const { data, error } = await db
    .from("drivers")
    .select("*")
    .eq("disponivel", true)
    .in("tipo", [tipoServico, "ambos"]);

  if (error) throw new Error(`Falha ao listar motoristas: ${error.message}`);
  return (data ?? []) as Driver[];
}

export async function listDrivers(): Promise<Driver[]> {
  const db = supabase();
  const { data, error } = await db
    .from("drivers")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Falha ao listar motoristas: ${error.message}`);
  return (data ?? []) as Driver[];
}

export async function createDriver(driver: {
  nome: string;
  telefone: string;
  tipo: "corrida" | "entrega" | "ambos";
}): Promise<void> {
  const { error } = await supabase().from("drivers").insert(driver);
  if (error) throw new Error(`Falha ao cadastrar motorista: ${error.message}`);
}

export async function setDriverDisponivel(
  driverId: string,
  disponivel: boolean,
): Promise<void> {
  const { error } = await supabase()
    .from("drivers")
    .update({ disponivel })
    .eq("id", driverId);

  if (error) throw new Error(`Falha ao atualizar motorista: ${error.message}`);
}
