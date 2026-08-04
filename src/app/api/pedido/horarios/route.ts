import { NextResponse } from "next/server";
import { horariosDisponiveis } from "@/lib/catalog";
import { bookedSlots } from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Horários já reservados numa data, pra página de pedido não oferecer slot ocupado. */
export async function GET(request: Request): Promise<Response> {
  const data = new URL(request.url).searchParams.get("data");
  if (!data) {
    return NextResponse.json({ erro: "informe ?data=AAAA-MM-DD" }, { status: 400 });
  }

  const ocupados = await bookedSlots(data);
  return NextResponse.json({ horarios: horariosDisponiveis(ocupados) });
}
