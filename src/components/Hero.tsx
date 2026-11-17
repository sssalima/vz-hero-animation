import { useProgress } from "@react-three/drei"
import { ArrowRight, Check, Pause, Play, Tag } from "lucide-react"
import { lazy, Suspense, useCallback, useRef, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { setControls, useControls } from "../scene/clock"

const HeroScene = lazy(() => import("../scene/HeroScene"))

function Loader() {
  const { progress, active } = useProgress()
  return (
    <div
      className="pointer-events-none absolute inset-0 flex items-end justify-end p-6 transition-opacity duration-700 md:p-10"
      style={{ opacity: active || progress < 100 ? 1 : 0 }}
      aria-hidden={!active}
    >
      <div className="font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
        Streaming SimReady assets · {Math.round(progress)}%
      </div>
    </div>
  )
}

type IconButtonProps = {
  label: string
  pressed?: boolean
  onClick: () => void
  children: React.ReactNode
}

function IconButton({ label, pressed, onClick, children }: IconButtonProps) {
  return (
    <Button
      variant="outline"
      size="icon"
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      onClick={onClick}
    >
      {children}
    </Button>
  )
}

/** CTA destinations: Verizon ThingSpace and Verizon Business IoT solutions. */
const CTA = {
  build: "https://thingspace.verizon.com/",
  explore: "https://www.verizon.com/business/products/internet-of-things/",
}

export default function Hero() {
  const { paused, labels } = useControls()
  const [ready, setReady] = useState(false)
  const labelLayer = useRef<HTMLDivElement>(null)
  const onReady = useCallback(() => setReady(true), [])

  return (
    <section
      className="relative isolate flex min-h-[100svh] w-full flex-col overflow-hidden bg-background text-foreground md:block md:h-[100svh] md:min-h-[640px]"
      aria-label="ThingSpace IoT"
    >
      {/* 3D scene: full-bleed behind the copy on desktop, its own band on mobile */}
      <div
        className={cn(
          "scene-mask relative order-2 h-[420px] shrink-0 transition-opacity duration-[1400ms] md:absolute md:inset-0 md:h-auto",
          ready ? "opacity-100" : "opacity-0",
        )}
      >
        <Suspense fallback={null}>
          <HeroScene onReady={onReady} labelLayer={labelLayer} />
        </Suspense>
        <div
          ref={labelLayer}
          className="pointer-events-none absolute inset-0 overflow-hidden"
        />
      </div>
      <Loader />

      {/* legibility scrims (desktop, where the copy sits over the scene) */}
      <div className="pointer-events-none absolute inset-0 bg-linear-to-r from-background from-0% via-background/90 via-34% to-transparent to-58% max-md:hidden" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-linear-to-b from-background/90 to-transparent max-md:hidden" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-linear-to-t from-background to-transparent max-md:hidden" />

      {/* headline */}
      <div className="pointer-events-none relative z-10 order-1 px-6 pt-24 pb-2 md:flex md:h-full md:flex-col md:justify-center md:px-10 md:pt-24 md:pb-32 lg:px-16">
        <div className="pointer-events-auto max-w-[36rem]">
          <Badge variant="secondary">
            <span aria-hidden className="size-1.5 rounded-full bg-primary" />
            ThingSpace IoT
          </Badge>
          <h1 className="mt-6 text-[2.75rem] leading-[1.02] font-bold tracking-[-0.045em] md:text-[length:min(3.75rem,7.5vh)] lg:text-[length:min(4.5rem,8vh)]">
            Design the right <br />
            connected <br />
            solution for <br />
            your business
          </h1>
          <p className="mt-6 max-w-[32rem] text-base leading-relaxed text-pretty text-neutral-800 md:text-lg">
            Tell us what you want to track, monitor, or connect. We&rsquo;ll
            recommend the devices, connectivity, and APIs you need, then help
            you deploy.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-3">
            <Button asChild>
              <a href={CTA.build} target="_blank" rel="noopener noreferrer">
                Build a Solution
                <ArrowRight aria-hidden />
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </Button>
            <Button asChild variant="outline" className="px-6">
              <a href={CTA.explore} target="_blank" rel="noopener noreferrer">
                Explore solutions
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </Button>
          </div>
          <p className="mt-6 flex items-center gap-2 text-sm text-neutral-700">
            <Check className="size-4" aria-hidden />
            No account needed to start.
          </p>
        </div>
      </div>

      {/* telemetry */}
      <footer className="relative z-10 order-3 px-6 pt-2 pb-6 md:absolute md:inset-x-0 md:bottom-0 md:px-10 md:pt-0 md:pb-8 lg:px-16">
        <div className="flex flex-wrap items-end justify-end gap-x-10 gap-y-6">
          <div className="flex items-center gap-2">
            <IconButton
              label={paused ? "Resume line" : "Pause line"}
              pressed={paused}
              onClick={() => setControls({ paused: !paused })}
            >
              {paused ? <Play aria-hidden /> : <Pause aria-hidden />}
            </IconButton>
            <IconButton
              label={labels ? "Hide station labels" : "Show station labels"}
              pressed={labels}
              onClick={() => setControls({ labels: !labels })}
            >
              <Tag aria-hidden className={labels ? undefined : "opacity-50"} />
            </IconButton>
          </div>
        </div>
      </footer>
    </section>
  )
}
