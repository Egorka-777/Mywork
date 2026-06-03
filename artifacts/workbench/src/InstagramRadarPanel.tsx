import { useEffect, useMemo, useState } from "react";
import { ClipboardCopy, ExternalLink, Loader2, RefreshCw, Save, X } from "lucide-react";
import {
  fetchInstagramRadarAccountState,
  fetchInstagramRadarPosts,
  saveInstagramCompetitors,
  syncInstagramRadar,
} from "./instagramRadarApi";
import type {
  InstagramRadarAccountBases,
  InstagramRadarAudience,
  InstagramRadarPost,
} from "./instagramRadarTypes";

type InstagramRadarPanelProps = {
  onClose: () => void;
};

const EMPTY_BASES: InstagramRadarAccountBases = {
  eng: [],
  ru: [],
  custom: [],
};

const AUDIENCE_OPTIONS: Array<{ id: InstagramRadarAudience; label: string }> = [
  { id: "eng", label: "Англоязычная" },
  { id: "ru", label: "Русскоязычная" },
  { id: "custom", label: "Своя база" },
];

function formatDate(value: string | null) {
  if (!value) return "дата неизвестна";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "дата неизвестна";
  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function metric(value: number | null) {
  if (value === null) return "—";
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(value);
}

function usernameFromUrl(url: string) {
  try {
    return new URL(url).pathname.split("/").filter(Boolean)[0] || url;
  } catch {
    return url;
  }
}

export function InstagramRadarPanel({ onClose }: InstagramRadarPanelProps) {
  const [audience, setAudience] = useState<InstagramRadarAudience>("eng");
  const [accountBases, setAccountBases] = useState<InstagramRadarAccountBases>(EMPTY_BASES);
  const [posts, setPosts] = useState<InstagramRadarPost[]>([]);
  const [urlsText, setUrlsText] = useState("");
  const [windowDays, setWindowDays] = useState<1 | 2 | 3>(3);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);

  const selectedUrls = accountBases[audience];
  const totalAccounts = accountBases.eng.length + accountBases.ru.length + accountBases.custom.length;

  const sortedPosts = useMemo(
    () => [...posts].sort((a, b) => b.score - a.score),
    [posts]
  );

  useEffect(() => {
    let cancelled = false;

    async function loadInitial() {
      setLoading(true);
      setError(null);
      try {
        const [accountState, nextPosts] = await Promise.all([
          fetchInstagramRadarAccountState(),
          fetchInstagramRadarPosts({ windowDays, limit: 30, audience }),
        ]);
        if (cancelled) return;
        setAccountBases(accountState.bases);
        setPosts(nextPosts);
        setUrlsText(accountState.bases[audience].join("\n"));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadInitial();

    return () => {
      cancelled = true;
    };
  }, [audience, windowDays]);

  async function handleSaveCompetitors() {
    setLoading(true);
    setError(null);
    try {
      const urls = urlsText
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean);
      const nextState = await saveInstagramCompetitors(audience, urls);
      setAccountBases(nextState.bases);
      setUrlsText(nextState.bases[audience].join("\n"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleSync() {
    setSyncing(true);
    setError(null);
    try {
      const result = await syncInstagramRadar(windowDays, audience);
      setPosts(result.posts);
      setLastSync(`${result.competitorsChecked} аккаунтов проверено · ${result.posts.length} постов в выбранной базе`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  }

  async function copyPostUrl(url: string) {
    await navigator.clipboard.writeText(url);
    setCopiedUrl(url);
    window.setTimeout(() => setCopiedUrl(null), 1500);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Instagram Radar"
    >
      <div className="card-glass flex max-h-[min(92vh,960px)] w-full max-w-6xl flex-col overflow-hidden rounded-t-2xl border border-white/8 sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-white/6 px-4 py-3 md:px-5">
          <div>
            <h2 className="font-sans text-lg font-semibold text-white">Instagram Radar</h2>
            <p className="text-xs text-white/40">
              База аккаунтов → свежие посты и Reels → score → выбор материала.
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
              <h3 className="text-sm font-semibold text-white">База аккаунтов</h3>
              <p className="mt-1 text-xs text-white/40">
                Выбери аудиторию. Каждая база сохраняется отдельно и остаётся редактируемой.
              </p>

              <div className="mt-3 grid gap-2">
                {AUDIENCE_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setAudience(option.id)}
                    className={
                      audience === option.id
                        ? "flex items-center justify-between rounded-lg border border-cyan-400/40 bg-cyan-400/15 px-3 py-2 text-left text-xs font-medium text-cyan-100"
                        : "flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-left text-xs text-white/55 transition hover:text-white"
                    }
                  >
                    <span>{option.label}</span>
                    <span>{accountBases[option.id].length}</span>
                  </button>
                ))}
              </div>

              <textarea
                value={urlsText}
                onChange={(event) => setUrlsText(event.target.value)}
                className="mt-3 min-h-44 w-full resize-y rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none transition placeholder:text-white/25 focus:border-cyan-400/40"
                placeholder="https://www.instagram.com/username/"
              />
              <button
                type="button"
                onClick={handleSaveCompetitors}
                disabled={loading}
                className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-400/25 bg-cyan-400/10 px-3 py-2 text-sm font-medium text-cyan-100 transition hover:border-cyan-300/45 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Сохранить выбранную базу
              </button>

              <div className="mt-5 rounded-xl border border-white/8 bg-black/20 p-3">
                <p className="text-xs font-medium text-white/70">Окно поиска</p>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {[1, 2, 3].map((days) => (
                    <button
                      key={days}
                      type="button"
                      onClick={() => setWindowDays(days as 1 | 2 | 3)}
                      className={
                        windowDays === days
                          ? "rounded-lg border border-cyan-400/40 bg-cyan-400/15 px-2 py-2 text-xs font-medium text-cyan-100"
                          : "rounded-lg border border-white/10 bg-white/[0.03] px-2 py-2 text-xs text-white/50 transition hover:text-white"
                      }
                    >
                      {days} дн.
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={handleSync}
                  disabled={syncing || selectedUrls.length === 0}
                  className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2 text-sm font-medium text-white transition hover:border-cyan-300/35 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Обновить выбранную базу
                </button>
                {lastSync ? <p className="mt-2 text-xs text-emerald-300/80">{lastSync}</p> : null}
              </div>

              <div className="mt-5 space-y-2">
                <p className="text-xs font-medium text-white/60">
                  В выбранной базе: {selectedUrls.length} · всего: {totalAccounts}
                </p>
                {selectedUrls.map((url) => (
                  <div key={url} className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2">
                    <p className="text-sm font-medium text-white">@{usernameFromUrl(url)}</p>
                    <p className="truncate text-xs text-white/35">{url}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="min-w-0 rounded-2xl border border-white/8 bg-white/[0.03] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-white">Лучшие свежие посты</h3>
                  <p className="mt-1 text-xs text-white/40">
                    Score считается по лайкам, комментариям, просмотрам, свежести и бонусу карусели.
                  </p>
                </div>
                <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white/50">
                  {sortedPosts.length} найдено
                </div>
              </div>

              {error ? (
                <div className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/10 p-3 text-sm text-amber-100">
                  {error}
                </div>
              ) : null}

              {loading ? (
                <div className="mt-8 flex items-center gap-2 text-sm text-white/50">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Загружаю radar…
                </div>
              ) : null}

              {!loading && sortedPosts.length === 0 ? (
                <div className="mt-8 rounded-xl border border-white/8 bg-black/20 p-4 text-sm text-white/45">
                  Постов пока нет. Выбери базу и нажми “Обновить выбранную базу”.
                </div>
              ) : null}

              <div className="mt-4 grid gap-3">
                {sortedPosts.map((post) => (
                  <article key={post.id} className="overflow-hidden rounded-2xl border border-white/8 bg-black/20">
                    <div className="grid gap-3 p-3 sm:grid-cols-[120px_1fr]">
                      <div className="aspect-[4/5] overflow-hidden rounded-xl border border-white/8 bg-white/[0.03]">
                        {post.thumbnailUrl ? (
                          <img
                            src={`/wb/proxy-image?url=${encodeURIComponent(post.thumbnailUrl)}`}
                            alt=""
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center text-xs text-white/30">no image</div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-medium text-cyan-200">@{post.competitorUsername}</span>
                          <span className="text-white/25">·</span>
                          <span className="text-white/45">{post.postType}</span>
                          <span className="text-white/25">·</span>
                          <span className="text-white/45">{formatDate(post.timestamp)}</span>
                        </div>

                        <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-sm leading-relaxed text-white/80">
                          {post.caption || "Без подписи"}
                        </p>

                        <div className="mt-3 grid gap-2 text-xs text-white/45 sm:grid-cols-4">
                          <span>likes: {metric(post.likesCount)}</span>
                          <span>comments: {metric(post.commentsCount)}</span>
                          <span>views: {metric(post.videoViewCount ?? post.playCount)}</span>
                          <span className="font-medium text-cyan-200">score: {post.score}</span>
                        </div>
                        <p className="mt-2 text-xs text-white/35">{post.scoreReason}</p>

                        <div className="mt-3 flex flex-wrap gap-2">
                          <a
                            href={post.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs text-white/70 transition hover:text-white"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            Открыть
                          </a>
                          <button
                            type="button"
                            onClick={() => copyPostUrl(post.url)}
                            className="inline-flex items-center gap-1 rounded-lg border border-cyan-400/20 bg-cyan-400/10 px-2.5 py-1.5 text-xs text-cyan-100 transition hover:border-cyan-300/40"
                          >
                            <ClipboardCopy className="h-3.5 w-3.5" />
                            {copiedUrl === post.url ? "Скопировано" : "Скопировать URL"}
                          </button>
                          <button
                            type="button"
                            disabled
                            className="inline-flex cursor-not-allowed items-center gap-1 rounded-lg border border-white/10 bg-white/[0.02] px-2.5 py-1.5 text-xs text-white/30"
                          >
                            Разобрать в Carousel Remix — следующий проход
                          </button>
                        </div>
                      </div>
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
