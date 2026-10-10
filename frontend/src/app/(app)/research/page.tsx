import type { Metadata } from "next";

import { ResearchView } from "@/features/research/research-view";

export const metadata: Metadata = { title: "Research tools" };

export default function Page() {
  return <ResearchView />;
}
