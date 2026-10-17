import { NextResponse } from "next/server";
import { FtApiError, getCampusProducts } from "@/lib/ft-api";
import { getSession } from "@/lib/session";

/** One campus's products, for the all-shops page to load shop by shop. Shares the campus page cache. */
export async function GET(_request: Request, props: { params: Promise<{ campusId: string }> }) {
  if (!(await getSession())) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const campusId = Number((await props.params).campusId);
  if (!Number.isInteger(campusId) || campusId <= 0) return NextResponse.json({ error: "Bad campus id" }, { status: 400 });

  try {
    return NextResponse.json(await getCampusProducts(campusId));
  } catch (error) {
    console.error(`[campus-products] Campus ${campusId} failed:`, error);
    const status = error instanceof FtApiError && error.status === 429 ? 429 : 502;
    return NextResponse.json({ error: "The 42 API didn't answer" }, { status });
  }
}
