import { useEffect, useMemo, useState } from "react";
import { Clapperboard, Download, Loader2, RefreshCw, Save, Trash2, Upload, X } from "lucide-react";
import { fetchFaceAssets } from "./assetVaultApi";
import type { FaceAsset } from "./assetVaultTypes";
import {
  createLipsyncJob,
  deleteLipsyncJob,
  fetchLipsyncJobs,
  markLipsyncReady,
  refreshLipsyncJob,
  renderLipsyncJob,
  uploadLipsyncAudio,
} from "./lipsyncApi";
import type { LipsyncJob, LipsyncResolution, LipsyncVideoFormat } from "./lipsyncTypes";
import type { SourceRewriterNextActionPayload } from "./SourceRewriterPipeline";

type LipsyncPanelProps = {
  onClose: () => void;
  initialPayload?: SourceRewriterNextActionPayload | null;
  onJobsChanged?: (jobs: LipsyncJob[]) => void;
};

const videoFormats: { value: LipsyncVideoFormat; label: string }[] = [
  { value: "vertical_9_16", label: "Vertical 9:16" },
  { value: "portrait_4_5", label: "Portrait 4:5" },
  { value: "square_1_1", label: "Square 1:1" },
];

const resolutions: LipsyncResolution[] = ["480p", "720p"];

function statusClass(status: LipsyncJob["status"]) {
  if (status === "ready_for_render" || status === "succeeded") return "border-emerald-400/20 bg-emerald-400/10 text-emerald-100";
  if (status === "failed" || status === "provider_not_configured") return "border-amber-400/20 bg-amber-400/10 text-amber-100";
  if (status === "rendering") return "border-blue-400/20 bg-blue-400/10 text-blue-100";
  return "border-white/10 bg-white/[0.04] text-white/60";
}

function replaceJob(jobs: LipsyncJob[], job: LipsyncJob) {
  return jobs.map((item) => (item.id === job.id ? job : item));
}

export function LipsyncPanel({ onClose, initialPayload, onJobsChanged }: LipsyncPanelProps) {
  const [faces, setFaces] = useState<FaceAsset[]>([]);
  const [jobs, setJobs] = useState<LipsyncJob[]>([]);
  const [title, setTitle] = useState(initialPayload?.title ?? "lipsync-video");
  const [script, setScript] = useState(initialPayload?.text ?? "");
  const [faceAssetId, setFaceAssetId] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioFileName, setAudioFileName] = useState<string | null>(null);
  const [videoFormat, setVideoFormat] = useState<LipsyncVideoFormat>("vertical_9_16");
  const [resolution, setResolution] = useState<LipsyncResolution>("480p");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingAudio, setUploadingAudio] = useState(false);
  const [busyJobId, setBusyJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeFaces = useMemo(() => faces.filter((face) => face.active), [faces]);
  const selectedFace = activeFaces.find((face) => face.id === faceAssetId) ?? null;

  useEffect(() => {
    if (!initialPayload) return;
    setTitle(initialPayload.title || "lipsync-video");
    setScript(initialPayload.text || initialPayload.markdown || "");
  }, [initialPayload]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [nextFaces, nextJobs] = await Promise.all([fetchFaceAssets(), fetchLipsyncJobs()]);
        if (cancelled) return;
        setFaces(nextFaces);
        setJobs(nextJobs);
        onJobsChanged?.(nextJobs);
        const firstActive = nextFaces.find((face) => face.active);
        if (firstActive) setFaceAssetId((current) => current || firstActive.id);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [onJobsChanged]);

  async function handleAudioUpload(file: File | null) {
    if (!file) return;
    setUploadingAudio(true);
    setError(null);
    try {
      const uploaded = await uploadLipsyncAudio(file);
      setAudioUrl(uploaded.url);
      setAudioFileName(uploaded.fileName);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploadingAudio(false);
    }
  }

  async function handleCreateJob() {
    setSaving(true);
    setError(null);
    try {
      const job = await createLipsyncJob({
        title: title.trim() || "lipsync-video",
        script,
        faceAssetId,
        audioUrl,
        audioFileName,
        videoFormat,
        resolution,
        source: initialPayload ? "source_rewriter" : "manual",
        sourceTitle: initialPayload?.sourceFileName ?? initialPayload?.title ?? null,
      });
      const nextJobs = [job, ...jobs.filter((item) => item.id !== job.id)];
      setJobs(nextJobs);
      onJobsChanged?.(nextJobs);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function runJobAction(id: string, action: "ready" | "render" | "refresh") {
    setBusyJobId(id);
    setError(null);
    try {
      const job = action === "ready"
        ? await markLipsyncReady(id)
        : action === "render"
          ? await renderLipsyncJob(id)
          : await refreshLipsyncJob(id);
      const nextJobs = replaceJob(jobs, job);
      setJobs(nextJobs);
      onJobsChanged?.(nextJobs);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyJobId(null);
    }
  }

  async function handleDelete(id: string) {
    setError(null);
    try {
      const nextJobs = await deleteLipsyncJob(id);
      setJobs(nextJobs);
      onJobsChanged?.(nextJobs);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Lipsync Studio">
      <div className="card-glass flex max-h-[min(92vh,940px)] w-full max-w-6xl flex-col overflow-hidden rounded-t-2xl border border-white/8 sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-white/6 px-4 py-3 md:px-5">
          <div>
            <h2 className="font-sans text-lg font-semibold text-white">Lipsync Studio</h2>
            <p className="text-xs text-white/40">Текст → ElevenLabs вручную → аудио + аватар → Creatify Aurora → готовое видео.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-white/50 transition hover:bg-white/5 hover:text-white" aria-label="Закрыть">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
          <div className="grid gap-4 lg:grid-cols-[400px_1fr]">
            <section className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
              <h3 className="text-sm font-semibold text-white">Новый lipsync job</h3>
              <p className="mt-1 text-xs text-white/40">1. Проверь текст. 2. Сделай озвучку в ElevenLabs. 3. Загрузи аудио. 4. Выбери аватара. 5. Создай job и запусти Aurora.</p>

              <label className="mt-4 block text-xs text-white/45">Название
                <input value={title} onChange={(event) => setTitle(event.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-blue-400/40" />
              </label>

              <label className="mt-3 block text-xs text-white/45">Текст для озвучки
                <textarea value={script} onChange={(event) => setScript(event.target.value)} className="mt-1 min-h-48 w-full resize-y rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-blue-400/40" placeholder="Переписанный текст из Source Rewriter" />
              </label>

              <label className="mt-3 block text-xs text-white/45">Аудио из ElevenLabs
                <input type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.opus" onChange={(event) => void handleAudioUpload(event.target.files?.[0] ?? null)} className="mt-1 block w-full text-xs text-white/60" />
              </label>
              <div className="mt-2 rounded-lg border border-white/8 bg-black/20 px-3 py-2 text-xs text-white/50">
                {uploadingAudio ? <span className="inline-flex items-center gap-2"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Загружаю аудио…</span> : audioFileName ? `Загружено: ${audioFileName}` : "Аудио ещё не загружено"}
              </div>

              <label className="mt-3 block text-xs text-white/45">Аватар из Asset Vault
                <select value={faceAssetId ?? ""} onChange={(event) => setFaceAssetId(event.target.value || null)} className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-blue-400/40">
                  <option value="">Не выбрано</option>
                  {activeFaces.map((face) => <option key={face.id} value={face.id}>{face.name}</option>)}
                </select>
              </label>

              {selectedFace ? <div className="mt-3 flex items-center gap-3 rounded-xl border border-white/8 bg-black/20 p-3"><img src={selectedFace.url} alt={selectedFace.name} className="h-16 w-16 rounded-lg object-cover" /><div className="min-w-0"><p className="truncate text-sm font-medium text-white">{selectedFace.name}</p>{selectedFace.notes ? <p className="line-clamp-2 text-xs text-white/40">{selectedFace.notes}</p> : null}</div></div> : null}

              <div className="mt-3 grid grid-cols-2 gap-2">
                <label className="block text-xs text-white/45">Формат
                  <select value={videoFormat} onChange={(event) => setVideoFormat(event.target.value as LipsyncVideoFormat)} className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-blue-400/40">{videoFormats.map((format) => <option key={format.value} value={format.value}>{format.label}</option>)}</select>
                </label>
                <label className="block text-xs text-white/45">Качество
                  <select value={resolution} onChange={(event) => setResolution(event.target.value as LipsyncResolution)} className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-blue-400/40">{resolutions.map((item) => <option key={item} value={item}>{item}</option>)}</select>
                </label>
              </div>

              <button type="button" onClick={handleCreateJob} disabled={!script.trim() || !faceAssetId || !audioUrl || saving || uploadingAudio} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-blue-400/25 bg-blue-400/10 px-3 py-2.5 text-sm font-medium text-blue-100 transition hover:border-blue-300/45 disabled:cursor-not-allowed disabled:opacity-50">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Создать job
              </button>
              {error ? <div className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/10 p-3 text-sm text-amber-100">{error}</div> : null}
            </section>

            <section className="min-w-0 rounded-2xl border border-white/8 bg-white/[0.03] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-sm font-semibold text-white">Jobs</h3><p className="mt-1 text-xs text-white/40">Render запускается через Fal.ai / Creatify Aurora. Для незавершённого job нажми «Обновить статус».</p></div><div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white/50">{jobs.length} всего</div></div>
              {loading ? <div className="mt-8 flex items-center gap-2 text-sm text-white/50"><Loader2 className="h-4 w-4 animate-spin" /> Загружаю jobs…</div> : null}
              {!loading && jobs.length === 0 ? <div className="mt-8 rounded-xl border border-white/8 bg-black/20 p-4 text-sm text-white/45">Jobs пока нет. Создай первый ролик.</div> : null}

              <div className="mt-4 grid gap-3">
                {jobs.map((job) => (
                  <article key={job.id} className="rounded-2xl border border-white/8 bg-black/20 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-semibold text-white">{job.title}</p><p className="mt-1 text-xs text-white/35">Creatify Aurora · {job.resolution} · {job.videoFormat}</p></div><span className={`rounded-full border px-2 py-1 text-xs ${statusClass(job.status)}`}>{job.status}</span></div>
                    <p className="mt-3 line-clamp-4 whitespace-pre-wrap text-sm leading-relaxed text-white/70">{job.script}</p>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-white/45"><span>avatar: {job.faceAssetName || "not selected"}</span><span>audio: {job.audioFileName || "not uploaded"}</span><span>source: {job.source}</span></div>
                    {job.resultUrl ? <div className="mt-3 overflow-hidden rounded-xl border border-white/8 bg-black/30"><video controls src={job.resultUrl} className="max-h-[420px] w-full" /></div> : null}
                    {job.error ? <div className="mt-3 rounded-xl border border-amber-400/20 bg-amber-400/10 p-3 text-xs text-amber-100">{job.error}</div> : null}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button type="button" onClick={() => void runJobAction(job.id, "ready")} disabled={busyJobId === job.id} className="inline-flex items-center gap-1.5 rounded-lg border border-blue-400/20 bg-blue-400/10 px-2.5 py-1.5 text-xs text-blue-100 transition hover:bg-blue-400/20 disabled:opacity-50"><Clapperboard className="h-3.5 w-3.5" /> Проверить готовность</button>
                      <button type="button" onClick={() => void runJobAction(job.id, "render")} disabled={busyJobId === job.id || job.status === "rendering" || job.status === "succeeded"} className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1.5 text-xs text-emerald-100 transition hover:bg-emerald-400/20 disabled:cursor-not-allowed disabled:opacity-50"><Upload className="h-3.5 w-3.5" /> Запустить Aurora</button>
                      <button type="button" onClick={() => void runJobAction(job.id, "refresh")} disabled={busyJobId === job.id || job.status !== "rendering"} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs text-white/70 transition hover:text-white disabled:cursor-not-allowed disabled:opacity-50"><RefreshCw className="h-3.5 w-3.5" /> Обновить статус</button>
                      {job.resultUrl ? <a href={job.resultUrl} target="_blank" rel="noreferrer" download className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-400/20 bg-cyan-400/10 px-2.5 py-1.5 text-xs text-cyan-100 transition hover:bg-cyan-400/20"><Download className="h-3.5 w-3.5" /> Скачать</a> : null}
                      <button type="button" onClick={() => void handleDelete(job.id)} className="inline-flex items-center gap-1.5 rounded-lg border border-red-400/20 bg-red-500/10 px-2.5 py-1.5 text-xs text-red-100/90 transition hover:bg-red-500/20"><Trash2 className="h-3.5 w-3.5" /> Удалить</button>
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
