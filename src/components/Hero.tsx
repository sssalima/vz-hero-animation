import { useProgress } from "@react-three/drei"
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react"
import { lineClock, setControls, useControls } from "../scene/clock"
import { CYCLE, palletsShipped, unitsPalletized } from "../scene/timeline"
import { CATALOG } from "./assetCatalog"

const FactoryScene = lazy(() => import("../scene/FactoryScene"))

const fmt = new Intl.NumberFormat("en-US")

function useTelemetry() {
  const [state, setState] = useState(() => read())
  function read() {
    const t = lineClock.t
    return { units: unitsPalletized(t), pallets: palletsShipped(t) }
  }
  useEffect(() => {
    const id = window.setInterval(() => setState(read()), 200)
    return () => window.clearInterval(id)
  }, [])
  return state
}

function Loader() {
  const { progress, active } = useProgress()
  return (
    <div
      className="pointer-events-none absolute inset-0 flex items-end justify-end p-6 transition-opacity duration-700 md:p-10"
      style={{ opacity: active || progress < 100 ? 1 : 0 }}
      aria-hidden={!active}
    >
      <div className="font-mono text-[11px] tracking-[0.14em] text-white/45 uppercase">
        Streaming SimReady assets · {Math.round(progress)}%
      </div>
    </div>
  )
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="min-w-0">
      <div className="font-mono text-[10px] tracking-[0.16em] text-white/40 uppercase">
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="font-mono text-[15px] text-white tabular-nums md:text-base">
          {value}
        </span>
        {hint && (
          <span className="font-mono text-[10px] text-white/35">{hint}</span>
        )}
      </div>
    </div>
  )
}

function IconButton({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string
  pressed?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      onClick={onClick}
      className="grid size-9 place-items-center rounded-full border border-white/12 bg-white/[0.04] text-white/80 transition hover:border-white/25 hover:bg-white/[0.08] hover:text-white focus-visible:ring-2 focus-visible:ring-[#76b900] focus-visible:outline-none"
    >
      {children}
    </button>
  )
}

type AssetPanelProps = {
  open: boolean
  onClose: () => void
}

function AssetPanel({ open, onClose }: AssetPanelProps) {
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])
  return (
    <div
      className={`fixed inset-0 z-40 transition ${
        open ? "pointer-events-auto" : "pointer-events-none"
      }`}
      aria-hidden={!open}
    >
      <div
        className={`absolute inset-0 bg-black/50 transition-opacity duration-300 ${
          open ? "opacity-100" : "opacity-0"
        }`}
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Assets in this scene"
        className={`absolute top-0 right-0 flex h-full w-full max-w-[440px] flex-col border-l border-white/10 bg-[#0f1215]/95 backdrop-blur-xl transition-transform duration-500 ease-[cubic-bezier(.2,.8,.2,1)] ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-start justify-between gap-6 border-b border-white/10 px-6 pt-6 pb-5">
          <div>
            <div className="font-mono text-[10px] tracking-[0.18em] text-[#9be22d] uppercase">
              Bill of assets
            </div>
            <h2 className="mt-2 text-xl font-medium tracking-tight text-white">
              {CATALOG.length} assets, one scene
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-white/55">
              Converted from OpenUSD to glTF with real-world scale, materials
              and articulation joints preserved.
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close asset list"
            className="grid size-9 shrink-0 place-items-center rounded-full border border-white/12 text-white/70 transition hover:text-white focus-visible:ring-2 focus-visible:ring-[#76b900] focus-visible:outline-none"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              aria-hidden
            >
              <path
                d="M2 2l10 10M12 2L2 12"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        <ul className="flex-1 divide-y divide-white/[0.06] overflow-y-auto px-6">
          {CATALOG.map((a) => (
            <li
              key={a.name}
              className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 py-3.5"
            >
              <span className="truncate font-mono text-[13px] text-white">
                {a.name}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 font-mono text-[10px] tracking-wide ${
                  a.source === "SimReady"
                    ? "bg-[#76b900]/15 text-[#a6e23a]"
                    : "bg-white/[0.07] text-white/65"
                }`}
              >
                {a.source}
              </span>
              <span className="text-[13px] text-white/55">{a.role}</span>
              <span className="text-right font-mono text-[11px] text-white/40">
                {a.size}
              </span>
              <span className="col-span-2 truncate font-mono text-[10.5px] text-white/30">
                {a.path}
              </span>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  )
}

export default function Hero() {
  const { paused, labels } = useControls()
  const [panel, setPanel] = useState(false)
  const [ready, setReady] = useState(false)
  const labelLayer = useRef<HTMLDivElement>(null)
  const telemetry = useTelemetry()
  const onReady = useCallback(() => setReady(true), [])
  const closePanel = useCallback(() => setPanel(false), [])

  return (
    <section
      className="relative isolate h-[100svh] min-h-[640px] w-full overflow-hidden bg-[#0c0e10] text-white"
      aria-label="Animated assembly line built from NVIDIA SimReady assets"
    >
      {/* 3D scene */}
      <div
        className={`scene-mask absolute inset-0 transition-opacity duration-[1400ms] ${
          ready ? "opacity-100" : "opacity-0"
        }`}
      >
        <Suspense fallback={null}>
          <FactoryScene onReady={onReady} labelLayer={labelLayer} />
        </Suspense>
        <div
          ref={labelLayer}
          className="pointer-events-none absolute inset-0 overflow-hidden"
        />
      </div>
      <Loader />

      {/* legibility scrims */}
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,#0c0e10_0%,rgba(12,14,16,0.9)_28%,rgba(12,14,16,0.55)_40%,rgba(12,14,16,0)_56%)] max-md:bg-[linear-gradient(180deg,#0c0e10_0%,rgba(12,14,16,0.85)_30%,rgba(12,14,16,0)_52%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-[#0c0e10]/90 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#0c0e10] to-transparent max-md:h-64 max-md:via-[#0c0e10]/80" />

      {/* top bar */}
      <header className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-6 py-5 md:px-10 md:py-7">
        <div className="flex items-center gap-3">
          <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden>
            <path
              d="M11 1.5 20 6.5v9L11 20.5 2 15.5v-9z"
              fill="none"
              stroke="#76b900"
              strokeWidth="1.4"
            />
            <path d="M11 6.5 15.5 9v4.5L11 16l-4.5-2.5V9z" fill="#76b900" />
          </svg>
          <span className="font-mono text-[11px] tracking-[0.2em] text-white/70 uppercase">
            Line 03<span className="max-sm:hidden"> · Digital twin</span>
          </span>
        </div>
        <button
          type="button"
          onClick={() => setPanel(true)}
          className="rounded-full border border-white/12 bg-white/[0.03] px-4 py-2 font-mono text-[11px] tracking-[0.14em] text-white/75 uppercase transition hover:border-white/25 hover:text-white focus-visible:ring-2 focus-visible:ring-[#76b900] focus-visible:outline-none"
        >
          {CATALOG.length}
          <span className="max-sm:hidden"> SimReady</span> assets
        </button>
      </header>

      {/* headline */}
      <div className="pointer-events-none relative z-10 flex h-full flex-col justify-start px-6 pt-28 md:justify-center md:px-10 md:pt-0 lg:px-16">
        <div className="pointer-events-auto max-w-[34rem]">
          <div className="flex items-center gap-2.5 font-mono text-[11px] tracking-[0.18em] text-[#9be22d] uppercase">
            <span className="relative flex size-2">
              {!paused && (
                <span className="absolute inset-0 animate-ping rounded-full bg-[#76b900] opacity-60" />
              )}
              <span className="relative size-2 rounded-full bg-[#76b900]" />
            </span>
            {paused ? "Simulation paused" : "Live simulation"}
          </div>
          <h1 className="mt-5 text-[2.6rem] leading-[1.02] font-medium tracking-[-0.035em] text-balance md:text-6xl lg:text-[4.25rem]">
            Simulate the line.{" "}
            <span className="text-white/45">Then build it.</span>
          </h1>
          <p className="mt-6 max-w-[28rem] text-[15px] leading-relaxed text-pretty text-white/60 md:text-base">
            A capping, inspection and palletizing cell assembled entirely from
            NVIDIA SimReady and Isaac Sim assets — real scale, real materials,
            articulated robots running a 4-second cycle.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setPanel(true)}
              className="group inline-flex items-center gap-2 rounded-full bg-[#76b900] px-5 py-3 text-sm font-medium text-[#0b0f05] transition hover:bg-[#86cc0a] focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
            >
              Explore the assets
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                aria-hidden
                className="transition-transform group-hover:translate-x-0.5"
              >
                <path
                  d="M2 7h10M8 3l4 4-4 4"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => setControls({ paused: !paused })}
              className="inline-flex items-center gap-2 rounded-full border border-white/15 px-5 py-3 text-sm text-white/80 transition hover:border-white/30 hover:text-white focus-visible:ring-2 focus-visible:ring-[#76b900] focus-visible:outline-none"
            >
              {paused ? "Resume line" : "Pause line"}
            </button>
          </div>
        </div>
      </div>

      {/* telemetry */}
      <footer className="absolute inset-x-0 bottom-0 z-10 px-6 pb-6 md:px-10 md:pb-8 lg:px-16">
        <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-5">
          <dl className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4 sm:gap-x-10">
            <Stat
              label="Units palletized"
              value={fmt.format(telemetry.units)}
            />
            <Stat label="Throughput" value="900" hint="u/h" />
            <Stat label="Cycle time" value={CYCLE.toFixed(1)} hint="s" />
            <Stat label="Pallets out" value={fmt.format(telemetry.pallets)} />
          </dl>
          <div className="flex items-center gap-2">
            <IconButton
              label={paused ? "Resume line" : "Pause line"}
              pressed={paused}
              onClick={() => setControls({ paused: !paused })}
            >
              {paused ? (
                <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
                  <path d="M3 1.5v9l7.5-4.5z" fill="currentColor" />
                </svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
                  <path d="M3 1.5h2v9H3zM7 1.5h2v9H7z" fill="currentColor" />
                </svg>
              )}
            </IconButton>
            <IconButton
              label={labels ? "Hide station labels" : "Show station labels"}
              pressed={labels}
              onClick={() => setControls({ labels: !labels })}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                aria-hidden
              >
                <rect
                  x="1.5"
                  y="2.5"
                  width="11"
                  height="6"
                  rx="1.5"
                  stroke="currentColor"
                  strokeWidth="1.3"
                />
                <path
                  d="M7 8.5v4"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                  opacity={labels ? 1 : 0.4}
                />
              </svg>
            </IconButton>
          </div>
        </div>
      </footer>

      <AssetPanel open={panel} onClose={closePanel} />
    </section>
  )
}
