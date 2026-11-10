import { cn } from "cn"

/** A comet ring around a pulsing core, so a wait reads as active work; color and size follow `text-*` and `size-*`. */
function Spinner({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="spinner"
      role="status"
      aria-label="Loading"
      className={cn("relative inline-block size-4 shrink-0", className)}
      {...props}
    >
      <span className="spinner-ring absolute inset-0 rounded-full" />
      <span className="spinner-core absolute inset-[31%] rounded-full bg-current" />
    </span>
  )
}

export { Spinner }
