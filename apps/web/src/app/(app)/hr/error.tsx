"use client"
import { useEffect } from "react"
export default function Error({ error, reset }: { error: Error & { digest?: string }, reset: () => void }) {
  useEffect(() => { console.error(error) }, [error])
  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] gap-4 p-8">
      <div className="text-destructive text-lg font-semibold">Something went wrong</div>
      <p className="text-muted-foreground text-sm max-w-md text-center">{error.message || "An unexpected error occurred. Please try again."}</p>
      <button onClick={reset} className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors">Try again</button>
    </div>
  )
}
