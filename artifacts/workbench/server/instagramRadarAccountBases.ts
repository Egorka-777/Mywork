import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeInstagramProfileUrl,
  readInstagramCompetitors,
  saveInstagramCompetitors,
} from "./instagramRadar";
import type { InstagramCompetitor, InstagramRadarPost } from "./instagramRadar";

export type InstagramRadarAudience = "eng" | "ru" | "custom";

export type InstagramRadarAccountBases = Record<InstagramRadarAudience, string[]>;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workbenchRoot = path.resolve(__dirname, "..");
const radarDir = path.join(workbenchRoot, "data", "instagram-radar");
const basesFile = path.join(radarDir, "account-bases.json");

const DEFAULT_ENG_ACCOUNTS = [
  "https://www.instagram.com/sabrina_ramonov/",
  "https://www.instagram.com/rpn/",
  "https://www.instagram.com/nomadatoast/",
  "https://www.instagram.com/shedoesai/",
  "https://www.instagram.com/tech.unicorn/",
  "https://www.instagram.com/godofprompt/",
  "https://www.instagram.com/codingmermaid.ai/",
  "https://www.instagram.com/fabionkallaku/",
  "https://www.instagram.com/realrileybrown/",
  "https://www.instagram.com/kallaway/",
  "https://www.instagram.com/nicksaraev/",
  "https://www.instagram.com/rowancheung/",
  "https://www.instagram.com/therundownai/",
  "https://www.instagram.com/justinfineberg_/",
  "https://www.instagram.com/onestopdata/",
  "https://www.instagram.com/imtylerpayne/",
  "https://www.instagram.com/noevarner.ai/",
  "https://www.instagram.com/thomas.lentine/",
  "https://www.instagram.com/chriswesst/",
  "https://www.instagram.com/codingknowledge/",
  "https://www.instagram.com/michaelaiacademy/",
  "https://www.instagram.com/tenfoldmarc/",
  "https://www.instagram.com/ai.fiedstudio/",
  "https://www.instagram.com/elevenpercentprod/",
  "https://www.instagram.com/simon.saysai/",
  "https://www.instagram.com/miladramezaniofficial/",
  "https://www.instagram.com/sebintel/",
  "https://www.instagram.com/alassafi.ai/",
  "https://www.instagram.com/theromanknox/",
];

const DEFAULT_RU_ACCOUNTS = [
  "https://www.instagram.com/ksyushafedorova/",
  "https://www.instagram.com/petukhovmv/",
  "https://www.instagram.com/valya_denisov/",
  "https://www.instagram.com/alexnovikov85/",
  "https://www.instagram.com/yana_rogodchenko/",
  "https://www.instagram.com/balachuk_ai/",
  "https://www.instagram.com/sanchezz_ai/",
  "https://www.instagram.com/d1noel/",
  "https://www.instagram.com/egorkuzminxr/",
  "https://www.instagram.com/inntellme/",
  "https://www.instagram.com/lenivins/",
  "https://www.instagram.com/damirkhalilov/",
  "https://www.instagram.com/demwes/",
  "https://www.instagram.com/dansidorenko/",
  "https://www.instagram.com/julieta_publicista/",
  "https://www.instagram.com/dianika.ai/",
  "https://www.instagram.com/neuroarthurkz/",
  "https://www.instagram.com/annettadamaeva/",
];

const DEFAULT_BASES: InstagramRadarAccountBases = {
  eng: DEFAULT_ENG_ACCOUNTS,
  ru: DEFAULT_RU_ACCOUNTS,
  custom: [],
};

let initialBasesPromise: Promise<InstagramRadarAccountBases> | null = null;

async function ensureRadarDir() {
  await fs.mkdir(radarDir, { recursive: true });
}

async function writeJsonAtomic(filePath: string, value: unknown) {
  await ensureRadarDir();
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
  await fs.rename(tmpPath, filePath);
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return fallback;

    if (error instanceof SyntaxError) {
      const backupPath = `${filePath}.malformed.${Date.now()}.bak`;
      await fs.writeFile(backupPath, await fs.readFile(filePath, "utf-8"), "utf-8");
      await fs.unlink(filePath).catch(() => undefined);
      console.error(`[instagram-radar] malformed account bases moved to ${backupPath}`);
      return fallback;
    }

    throw error;
  }
}

function normalizeUrls(urls: string[]): string[] {
  const unique = new Map<string, string>();

  urls
    .map((url) => url.trim())
    .filter(Boolean)
    .map(normalizeInstagramProfileUrl)
    .forEach((item) => unique.set(item.username, item.url));

  return Array.from(unique.values());
}

function normalizeBases(input: Partial<InstagramRadarAccountBases>): InstagramRadarAccountBases {
  return {
    eng: normalizeUrls(Array.isArray(input.eng) ? input.eng : []),
    ru: normalizeUrls(Array.isArray(input.ru) ? input.ru : []),
    custom: normalizeUrls(Array.isArray(input.custom) ? input.custom : []),
  };
}

function flattenBases(bases: InstagramRadarAccountBases): string[] {
  return normalizeUrls([...bases.eng, ...bases.ru, ...bases.custom]);
}

function usernamesForAudience(bases: InstagramRadarAccountBases, audience: InstagramRadarAudience) {
  return new Set(bases[audience].map((url) => normalizeInstagramProfileUrl(url).username));
}

async function createInitialBases(): Promise<InstagramRadarAccountBases> {
  const legacyCompetitors = await readInstagramCompetitors();
  const knownUsernames = new Set(
    [...DEFAULT_BASES.eng, ...DEFAULT_BASES.ru].map((url) => normalizeInstagramProfileUrl(url).username)
  );
  const custom = legacyCompetitors
    .map((competitor) => competitor.url)
    .filter((url) => !knownUsernames.has(normalizeInstagramProfileUrl(url).username));

  const bases = normalizeBases({ ...DEFAULT_BASES, custom });
  await writeJsonAtomic(basesFile, bases);
  await saveInstagramCompetitors(flattenBases(bases));
  return bases;
}

export async function readInstagramRadarAccountBases(): Promise<InstagramRadarAccountBases> {
  const stored = await readJsonFile<Partial<InstagramRadarAccountBases> | null>(basesFile, null);
  if (stored) return normalizeBases(stored);

  if (!initialBasesPromise) {
    initialBasesPromise = createInitialBases().finally(() => {
      initialBasesPromise = null;
    });
  }

  return initialBasesPromise;
}

export async function saveInstagramRadarAccountBase(
  audience: InstagramRadarAudience,
  urls: string[]
): Promise<{ bases: InstagramRadarAccountBases; competitors: InstagramCompetitor[] }> {
  const current = await readInstagramRadarAccountBases();
  const bases = normalizeBases({ ...current, [audience]: urls });
  await writeJsonAtomic(basesFile, bases);
  const competitors = await saveInstagramCompetitors(flattenBases(bases));
  return { bases, competitors };
}

export function filterInstagramRadarPostsByAudience(
  posts: InstagramRadarPost[],
  bases: InstagramRadarAccountBases,
  audience: InstagramRadarAudience
): InstagramRadarPost[] {
  const usernames = usernamesForAudience(bases, audience);
  return posts.filter((post) => usernames.has(post.competitorUsername));
}
