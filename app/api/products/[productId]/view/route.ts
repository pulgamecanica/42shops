import { NextResponse } from "next/server";
import { recordProductView } from "@/lib/campus-views";
import { getSession } from "@/lib/session";

/** Counts a product detail view. proxy.ts already requires a session; checked again here. */
export async function POST(_request: Request, props: { params: Promise<{ productId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const productId = Number((await props.params).productId);
  const counted = await recordProductView(productId, session.id);
  return NextResponse.json({ counted });
}
