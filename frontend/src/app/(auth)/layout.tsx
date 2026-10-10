export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <div className="flex items-center justify-center p-6">{children}</div>
      <aside className="hidden flex-col justify-center gap-6 bg-muted/60 p-12 lg:flex">
        <blockquote className="max-w-md text-xl font-medium leading-snug tracking-tight">
          Every answer links back to the exact passage in your own documents — so you can verify it instead of trusting it.
        </blockquote>
        <ul className="max-w-md space-y-2 text-sm text-muted-foreground">
          <li>• Upload PDFs, Word files, text and Markdown</li>
          <li>• Hybrid semantic + keyword retrieval</li>
          <li>• Clickable citations with page numbers and excerpts</li>
          <li>• Runs with local Ollama models or Groq</li>
        </ul>
      </aside>
    </main>
  );
}
