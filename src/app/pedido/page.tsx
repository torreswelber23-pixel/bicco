import type { Metadata } from "next";
import { SERVICOS, proximasDatas } from "@/lib/catalog";
import PedidoForm from "./PedidoForm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Pedir corrida ou entrega",
};

export default async function PedidoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const token = params.t ?? "";

  if (!token) {
    return (
      <main>
        <h1>Link inválido</h1>
        <p className="sub">
          Esse link não tem o código do pedido. Volte na conversa do WhatsApp e
          toque no botão de novo.
        </p>
      </main>
    );
  }

  return (
    <main>
      <PedidoForm token={token} datas={proximasDatas()} servicos={SERVICOS} />
    </main>
  );
}
