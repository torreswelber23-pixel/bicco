import { supabase } from "./supabase";

export interface Contact {
  id: string;
  wa_id: string;
  profile_name: string | null;
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

/**
 * Contatos, do mais recente ao mais antigo. Existe para a API pública: o
 * app em si nunca precisou listar, só resolver um contato por vez.
 */
export async function listContacts(params: {
  limit: number;
  offset: number;
  busca?: string;
}): Promise<Contact[]> {
  const db = supabase();
  let query = db
    .from("contacts")
    .select("id, wa_id, profile_name")
    .order("last_seen_at", { ascending: false })
    .range(params.offset, params.offset + params.limit - 1);

  if (params.busca) {
    query = query.or(
      `wa_id.ilike.%${params.busca}%,profile_name.ilike.%${params.busca}%`,
    );
  }

  const { data, error } = await query;
  if (error) throw new Error(`Falha ao listar contatos: ${error.message}`);
  return (data ?? []) as Contact[];
}

export async function getContact(contactId: string): Promise<Contact | null> {
  const db = supabase();
  const { data, error } = await db
    .from("contacts")
    .select("id, wa_id, profile_name")
    .eq("id", contactId)
    .maybeSingle();

  if (error) throw new Error(`Falha ao ler contato: ${error.message}`);
  return data as Contact | null;
}

export async function findContactByWaId(waId: string): Promise<Contact | null> {
  const db = supabase();
  const { data, error } = await db
    .from("contacts")
    .select("id, wa_id, profile_name")
    .eq("wa_id", waId)
    .maybeSingle();

  if (error) throw new Error(`Falha ao ler contato: ${error.message}`);
  return data as Contact | null;
}

export interface StoredMessage {
  id: string;
  contact_id: string;
  wa_message_id: string | null;
  direction: "inbound" | "outbound";
  type: string;
  payload: unknown;
  created_at: string;
}

/** Histórico de uma conversa, do mais recente para o mais antigo. */
export async function listMessages(params: {
  contactId: string;
  limit: number;
  offset: number;
}): Promise<StoredMessage[]> {
  const db = supabase();
  const { data, error } = await db
    .from("messages")
    .select("id, contact_id, wa_message_id, direction, type, payload, created_at")
    .eq("contact_id", params.contactId)
    .order("created_at", { ascending: false })
    .range(params.offset, params.offset + params.limit - 1);

  if (error) throw new Error(`Falha ao listar mensagens: ${error.message}`);
  return (data ?? []) as StoredMessage[];
}
