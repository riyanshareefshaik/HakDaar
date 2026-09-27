import { ShieldCheck } from 'lucide-react'

export default function Header({ s, health }) {
  const memOk = health?.hindsight?.ok
  const aiOk = health?.groq?.ok
  return (
    <header className="bg-brand text-white">
      <div className="mx-auto flex max-w-[1500px] items-center gap-3 px-4 py-3 lg:px-6">
        <div className="grid size-10 place-items-center rounded-xl bg-white/15">
          <ShieldCheck className="size-6" strokeWidth={2.2} />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-extrabold tracking-tight leading-tight">HakDaar</h1>
          <p className="truncate text-sm text-white/80 leading-tight">{s.tagline}</p>
        </div>
        {health && (
          <div className="ml-auto hidden items-center gap-2 text-xs sm:flex">
            <StatusPill ok={memOk} label="Hindsight memory" />
            <StatusPill ok={aiOk} label="Groq AI" />
          </div>
        )}
      </div>
    </header>
  )
}

function StatusPill({ ok, label }) {
  return (
    <span className="flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1">
      <span className={`size-2 rounded-full ${ok ? 'bg-emerald-300' : 'bg-amber-300'}`} />
      {label}
    </span>
  )
}
