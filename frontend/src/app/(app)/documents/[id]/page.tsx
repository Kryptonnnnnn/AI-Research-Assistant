"use client";

import { useParams } from "next/navigation";
import { Suspense } from "react";

import { DocumentDetail } from "@/features/documents/document-detail";

export default function Page() {
  const { id } = useParams<{ id: string }>();
  return (
    <Suspense>
      <DocumentDetail id={id} />
    </Suspense>
  );
}
