import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bicco · API do WhatsApp Cloud API",
  description:
    "API REST sobre um número de WhatsApp conectado: enviar mensagens, ler conversas e receber eventos por webhook.",
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
