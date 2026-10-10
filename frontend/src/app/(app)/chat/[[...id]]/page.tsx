"use client";

import { useParams } from "next/navigation";
import { Suspense } from "react";

import { ChatView } from "@/features/chat/chat-view";

export default function Page() {
  const params = useParams<{ id?: string[] }>();
  const id = params.id?.[0] ?? null;
  return (
    <div className="h-full">
      <Suspense>
        <ChatView key={id ?? "new"} conversationId={id} />
      </Suspense>
    </div>
  );
}
