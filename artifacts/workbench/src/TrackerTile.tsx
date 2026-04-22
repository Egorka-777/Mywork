import { useCallback, useEffect, useId, useState } from "react";
import { MessageCircle } from "lucide-react";

export function TrackerTile() {
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const labelId = useId();

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await fetch("/api/tracker");
      if (!r.ok) {
        const t = await r.text();
        throw new Error(t || r.statusText);
      }
      const d = (await r.json()) as { enabled: boolean };
      setEnabled(d.enabled);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async () => {
    const next = !enabled;
    setError(null);
    setEnabled(next);
    try {
      const r = await fetch("/api/tracker", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!r.ok) {
        setEnabled((v) => !v);
        const t = await r.text();
        throw new Error(t || r.statusText);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="card-glass flex flex-col rounded-2xl p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#1e3a5f] to-[#0f172a] text-[#5b8def]">
            <MessageCircle className="h-5 w-5" aria-hidden />
          </div>
          <div>
            <h2
              className="font-sans text-lg font-semibold text-white"
              id={labelId}
            >
              Telegram Tracker
            </h2>
            <p className="mt-1 text-sm text-[#6b6b7a]">
              Сбор из каналов, рерайт и отправка в целевой чат. Работает
              вместе с{" "}
              <code className="font-mono text-white/50">telegram-rewriter</code>{" "}
              и тем же <code className="font-mono text-white/50">state.json</code>.
            </p>
          </div>
        </div>
      </div>
      {error && (
        <p className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/10 px-2 py-1.5 text-sm text-amber-200/90">
          {error}
        </p>
      )}
      <div
        className="mt-6 flex items-center justify-between gap-3 rounded-xl border border-white/6 bg-white/[0.02] px-3 py-2.5"
        role="group"
        aria-labelledby={labelId}
      >
        <span className="text-sm text-white/80">
          {enabled ? "Включён" : "Выключен"}
        </span>
        <button
          type="button"
          className="trk-toggle"
          data-state={enabled ? "on" : "off"}
          onClick={() => {
            if (!loading) void toggle();
          }}
          disabled={loading}
          role="switch"
          aria-checked={enabled}
          aria-label="Включить или выключить Telegram Tracker"
        >
          <span className="trk-knob" />
        </button>
      </div>
    </div>
  );
}
