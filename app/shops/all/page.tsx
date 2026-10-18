import type { Metadata } from "next";
import { AllShopsView } from "@/components/all-shops-view";
import { getCampuses, getWallet, peekCampusProducts } from "@/lib/ft-api";
import { getProductViews } from "@/lib/campus-views";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Every shop" };

export default async function AllShopsPage() {
  const session = await requireSession();
  const campuses = await getCampuses();
  const [cached, views, wallet] = await Promise.all([
    peekCampusProducts(campuses.map((c) => c.id)),
    getProductViews(),
    getWallet(session.id, session.wallet),
  ]);

  // Every shop already in Redis renders now; the browser fetches the missing
  // ones shop by shop and quietly refreshes the stale ones.
  return (
    <AllShopsView
      campuses={campuses}
      initialProducts={cached.products}
      stale={cached.stale}
      views={views}
      wallet={wallet}
      homeCampusId={session.campusId}
      now={Date.now()}
    />
  );
}
