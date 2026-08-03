import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bicco · Atendimento automatizado no WhatsApp",
  description:
    "Captação de demanda via WhatsApp Flows: webhook, endpoint de dados e painel de leads.",
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
