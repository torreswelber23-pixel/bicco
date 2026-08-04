import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bicco · Corrida e entrega sob demanda pelo WhatsApp",
  description:
    "Pedido de corrida ou entrega pelo WhatsApp: webhook, formulário web e painel de pedidos.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
