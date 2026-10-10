import { cn } from "@/lib/utils";

export function PageContainer({ children, className, wide }: { children: React.ReactNode; className?: string; wide?: boolean }) {
  return <div className={cn("mx-auto w-full p-4 md:p-8", wide ? "max-w-7xl" : "max-w-6xl", className)}>{children}</div>;
}
