/**
 * Catálogos que alimentam as telas do Flow.
 *
 * Estão em código para o protótipo ficar autocontido; migrar para tabelas no
 * Supabase depois é trocar essas funções por queries, sem tocar no Flow JSON.
 */

export interface Option {
  id: string;
  title: string;
  description?: string;
  enabled?: boolean;
}

export const SERVICOS: Option[] = [
  { id: "corrida", title: "Corrida", description: "Pedir uma corrida agora ou agendada" },
  { id: "entrega", title: "Entrega", description: "Buscar e entregar algo em outro endereço" },
];

export const QUANDO: Option[] = [
  { id: "agora", title: "Agora" },
  { id: "agendado", title: "Agendar para depois" },
];

export const HORARIOS_BASE = [
  "09:00",
  "10:00",
  "11:00",
  "14:00",
  "15:00",
  "16:00",
  "17:00",
];

const DIAS_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

/** Traduz o id de uma opção para o rótulo exibido, para o resumo em texto. */
export function labelOf(options: Option[], id: string | undefined): string {
  if (!id) return "—";
  return options.find((option) => option.id === id)?.title ?? id;
}

/**
 * Próximos dias úteis disponíveis para agendamento.
 *
 * As datas usam o fuso de São Paulo para que "amanhã" seja amanhã para o
 * cliente, e não para o servidor da Vercel (que roda em UTC).
 */
export function proximasDatas(quantidade = 5): Option[] {
  const datas: Option[] = [];
  const cursor = saoPauloToday();

  while (datas.length < quantidade) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const diaDaSemana = cursor.getUTCDay();
    if (diaDaSemana === 0 || diaDaSemana === 6) continue;

    const id = cursor.toISOString().slice(0, 10);
    const dia = String(cursor.getUTCDate()).padStart(2, "0");
    const mes = String(cursor.getUTCMonth() + 1).padStart(2, "0");
    datas.push({ id, title: `${DIAS_SEMANA[diaDaSemana]}, ${dia}/${mes}` });
  }

  return datas;
}

export function horariosDisponiveis(ocupados: string[]): Option[] {
  return HORARIOS_BASE.map((horario) => ({
    id: horario,
    title: ocupados.includes(horario) ? `${horario} (indisponível)` : horario,
    enabled: !ocupados.includes(horario),
  }));
}

/** Meia-noite de hoje no fuso de São Paulo, representada como UTC. */
function saoPauloToday(): Date {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return new Date(`${formatter.format(new Date())}T00:00:00Z`);
}
