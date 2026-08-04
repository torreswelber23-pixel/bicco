import { listAvailableDrivers, setOrderStatus, type Order } from "./repository";
import { sendButtons } from "./whatsapp";

/**
 * Oferece o pedido a todos os motoristas/entregadores disponíveis do tipo
 * certo, de uma vez. O primeiro que tocar "Aceitar" fica com ele —
 * `claimOrder` (repository.ts) é quem resolve a corrida entre dois toques
 * quase simultâneos, não este módulo.
 */
export async function despacharPedido(order: Order): Promise<void> {
  if (!order.tipo_servico) return;

  const motoristas = await listAvailableDrivers(order.tipo_servico);

  if (motoristas.length === 0) {
    console.error(
      `[dispatch] nenhum motorista disponível para o pedido ${order.id} (${order.tipo_servico}).`,
    );
    return;
  }

  await setOrderStatus(order.id, "buscando_motorista");

  const resumo = resumoPedido(order);

  await Promise.all(
    motoristas.map((motorista) =>
      sendButtons(
        motorista.telefone,
        `Novo pedido de ${order.tipo_servico === "corrida" ? "corrida" : "entrega"}:\n\n${resumo}`,
        [
          { id: `aceitar:${order.id}`, title: "Aceitar" },
          { id: `recusar:${order.id}`, title: "Recusar" },
        ],
      ).catch((erro) =>
        console.error(
          `[dispatch] falha ao notificar motorista ${motorista.id}:`,
          erro,
        ),
      ),
    ),
  );
}

export function resumoPedido(order: Order): string {
  if (order.tipo_servico === "corrida") {
    return [`De: ${order.origem ?? "—"}`, `Para: ${order.destino ?? "—"}`]
      .join("\n");
  }

  return [
    `Coleta: ${order.endereco_coleta ?? "—"}`,
    `Entrega: ${order.endereco_entrega ?? "—"}`,
    order.item_descricao ? `Item: ${order.item_descricao}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
