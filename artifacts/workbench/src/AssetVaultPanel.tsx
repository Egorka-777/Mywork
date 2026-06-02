import { useEffect, useState } from "react";
import { Image as ImageIcon, Loader2, Save, Trash2, X } from "lucide-react";
import { deleteFaceAsset, fetchFaceAssets, setActiveFaceAsset, uploadFaceAsset } from "./assetVaultApi";
import type { FaceAsset } from "./assetVaultTypes";

type AssetVaultPanelProps = {
  onClose: () => void;
  onChanged?: (faces: FaceAsset[]) => void;
};

function formatSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AssetVaultPanel({ onClose, onChanged }: AssetVaultPanelProps) {
  const [faces, setFaces] = useState<FaceAsset[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadFaces() {
      setLoading(true);
      setError(null);
      try {
        const nextFaces = await fetchFaceAssets();
        if (cancelled) return;
        setFaces(nextFaces);
        onChanged?.(nextFaces);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadFaces();

    return () => {
      cancelled = true;
    };
  }, [onChanged]);

  async function handleUpload() {
    if (!file) return;
    setSaving(true);
    setError(null);
    try {
      const result = await uploadFaceAsset({
        file,
        name: name.trim() || file.name.replace(/\.[^.]+$/, ""),
        notes,
      });
      setFaces(result.faces);
      onChanged?.(result.faces);
      setFile(null);
      setName("");
      setNotes("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleActiveChange(id: string, active: boolean) {
    setError(null);
    try {
      const nextFaces = await setActiveFaceAsset(id, active);
      setFaces(nextFaces);
      onChanged?.(nextFaces);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleDelete(id: string) {
    setError(null);
    try {
      const nextFaces = await deleteFaceAsset(id);
      setFaces(nextFaces);
      onChanged?.(nextFaces);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Asset Vault"
    >
      <div className="card-glass flex max-h-[min(92vh,940px)] w-full max-w-5xl flex-col overflow-hidden rounded-t-2xl border border-white/8 sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-white/6 px-4 py-3 md:px-5">
          <div>
            <h2 className="font-sans text-lg font-semibold text-white">Asset Vault</h2>
            <p className="text-xs text-white/40">
              База твоих фото для lipsync, character reference и будущих видео.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-white/50 transition hover:bg-white/5 hover:text-white"
            aria-label="Закрыть"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
          <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
            <section className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
              <h3 className="text-sm font-semibold text-white">Добавить фото</h3>
              <p className="mt-1 text-xs text-white/40">
                Загружай только свои фото / разрешённые face references. Это будет база для Creatify Aurora / Fal.ai lipsync дальше.
              </p>

              <label className="mt-4 flex cursor-pointer items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-white/60 transition hover:border-emerald-400/30 hover:text-white">
                <ImageIcon className="h-4 w-4" />
                <span className="truncate">{file ? file.name : "Выбрать JPG / PNG / WEBP"}</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  onChange={(event) => {
                    const nextFile = event.target.files?.[0] ?? null;
                    setFile(nextFile);
                    if (nextFile && !name.trim()) {
                      setName(nextFile.name.replace(/\.[^.]+$/, ""));
                    }
                  }}
                />
              </label>

              <label className="mt-3 block text-xs text-white/45">
                Название
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-emerald-400/40"
                  placeholder="Например: Егор фронтально"
                />
              </label>

              <label className="mt-3 block text-xs text-white/45">
                Заметки
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  className="mt-1 min-h-20 w-full resize-y rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-emerald-400/40"
                  placeholder="Ракурс, эмоция, когда использовать."
                />
              </label>

              <button
                type="button"
                onClick={handleUpload}
                disabled={!file || saving}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-400/25 bg-emerald-400/10 px-3 py-2.5 text-sm font-medium text-emerald-100 transition hover:border-emerald-300/45 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Сохранить фото
              </button>

              {error ? (
                <div className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/10 p-3 text-sm text-amber-100">
                  {error}
                </div>
              ) : null}
            </section>

            <section className="min-w-0 rounded-2xl border border-white/8 bg-white/[0.03] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-white">Сохранённые фото</h3>
                  <p className="mt-1 text-xs text-white/40">
                    Эти фото потом будут выбираться в Lipsync Studio и Source Rewriter.
                  </p>
                </div>
                <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white/50">
                  {faces.length} всего
                </div>
              </div>

              {loading ? (
                <div className="mt-8 flex items-center gap-2 text-sm text-white/50">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Загружаю фото…
                </div>
              ) : null}

              {!loading && faces.length === 0 ? (
                <div className="mt-8 rounded-xl border border-white/8 bg-black/20 p-4 text-sm text-white/45">
                  Фото пока нет. Загрузи 3–5 нормальных референсов лица, а не коллекцию случайных селфи из тумана.
                </div>
              ) : null}

              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {faces.map((face) => (
                  <article key={face.id} className="overflow-hidden rounded-2xl border border-white/8 bg-black/20">
                    <div className="aspect-[4/5] overflow-hidden border-b border-white/8 bg-white/[0.03]">
                      <img
                        src={face.url}
                        alt={face.name}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    </div>
                    <div className="space-y-2 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-white">{face.name}</p>
                          <p className="text-xs text-white/35">{formatSize(face.sizeBytes)}</p>
                        </div>
                        <label className="flex items-center gap-1.5 text-xs text-white/45">
                          <input
                            type="checkbox"
                            checked={face.active}
                            onChange={(event) => void handleActiveChange(face.id, event.target.checked)}
                          />
                          active
                        </label>
                      </div>

                      {face.notes ? (
                        <p className="line-clamp-3 text-xs leading-relaxed text-white/50">{face.notes}</p>
                      ) : null}

                      <button
                        type="button"
                        onClick={() => void handleDelete(face.id)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-red-400/20 bg-red-500/10 px-2.5 py-1.5 text-xs text-red-100/90 transition hover:bg-red-500/20"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Удалить
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
