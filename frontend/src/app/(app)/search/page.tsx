import type { Metadata } from "next";

import { SearchView } from "@/features/search/search-view";

export const metadata: Metadata = { title: "Semantic search" };

export default function Page() {
  return <SearchView />;
}
