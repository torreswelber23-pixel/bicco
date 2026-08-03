import { supabase } from "./supabase";

export interface Contact {
  id: string;
  wa_id: string;
  profile_name: string | null;
}

export interface Lead {
  id: string;
  contact_id: string;
  flow_token: string | null;
  nome: string | null;
  tipo_servico: string | null;
  descricao: string | null;
  urgencia: string | null;
  orcamento: string | null;
  canal_preferido: string | null;
  data_preferida: string | null;
  horario_preferido: string | null;
  status: string;
  created_at: string;
  contacts?: { wa_id: string; profile_name: string | null } | null;
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
 * que um token forjado grave lead em nome de outro contato.
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

export async function createLead(lead: {
  contactId: string;
  flowToken: string | null;
  nome?: string | null;
  tipoServico?: string | null;
  descricao?: string | null;
  urgencia?: string | null;
  orcamento?: string | null;
  canalPreferido?: string | null;
  dataPreferida?: string | null;
  horarioPreferido?: string | null;
  raw: unknown;
}): Promise<string> {
  const db = supabase();

  const { data, error } = await db
    .from("leads")
    .insert({
      contact_id: lead.contactId,
      flow_token: lead.flowToken,
      nome: lead.nome ?? null,
      tipo_servico: lead.tipoServico ?? null,
      descricao: lead.descricao ?? null,
      urgencia: lead.urgencia ?? null,
      orcamento: lead.orcamento ?? null,
      canal_preferido: lead.canalPreferido ?? null,
      data_preferida: lead.dataPreferida ?? null,
      horario_preferido: lead.horarioPreferido ?? null,
      raw: lead.raw ?? {},
    })
    .select("id")
    .single();

  if (error) throw new Error(`Falha ao gravar lead: ${error.message}`);
  return (data as { id: string }).id;
}

export async function listLeads(limit = 100): Promise<Lead[]> {
  const db = supabase();
  const { data, error } = await db
    .from("leads")
    .select("*, contacts ( wa_id, profile_name )")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Falha ao listar leads: ${error.message}`);
  return (data ?? []) as Lead[];
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
