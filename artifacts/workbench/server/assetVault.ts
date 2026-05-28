import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

export type FaceAsset = {
  id: string;
  name: string;
  filename: string;
  url: string;
  mimeType: string;
  sizeBytes: number;
  notes: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workbenchRoot = path.resolve(__dirname, "..");
const assetsDir = path.join(workbenchRoot, "data", "assets");
const facesDir = path.join(assetsDir, "faces");
const facesIndexFile = path.join(assetsDir, "faces.json");

const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const allowedExtensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);

async function ensureAssetsDir() {
  await fs.mkdir(facesDir, { recursive: true });
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJsonAtomic(filePath: string, value: unknown) {
  await ensureAssetsDir();
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
  await fs.rename(tmpPath, filePath);
}

function safeAssetName(value: string) {
  return value
    .trim()
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9а-яА-ЯёЁ._-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80) || "face-reference";
}

export function validateFaceUpload(file: Express.Multer.File) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!allowedMimeTypes.has(file.mimetype)) {
    throw new Error("Only JPEG, PNG and WEBP face references are supported");
  }
  if (!allowedExtensions.has(ext)) {
    throw new Error("Face reference file must be .jpg, .jpeg, .png or .webp");
  }
  if (file.size > 12 * 1024 * 1024) {
    throw new Error("Face reference file is too large. Max size is 12 MB");
  }
}

export async function readFaceAssets(): Promise<FaceAsset[]> {
  await ensureAssetsDir();
  const faces = await readJsonFile<FaceAsset[]>(facesIndexFile, []);
  return Array.isArray(faces) ? faces : [];
}

export async function saveFaceAssets(faces: FaceAsset[]) {
  await writeJsonAtomic(facesIndexFile, faces);
}

export async function createFaceAsset(input: {
  file: Express.Multer.File;
  name?: string;
  notes?: string;
}): Promise<{ face: FaceAsset; faces: FaceAsset[] }> {
  validateFaceUpload(input.file);
  await ensureAssetsDir();

  const now = new Date().toISOString();
  const id = randomUUID();
  const ext = path.extname(input.file.originalname).toLowerCase();
  const baseName = safeAssetName(input.name || input.file.originalname);
  const filename = `${id}-${baseName}${ext}`;
  const targetPath = path.join(facesDir, filename);

  await fs.writeFile(targetPath, input.file.buffer);

  const face: FaceAsset = {
    id,
    name: input.name?.trim() || baseName,
    filename,
    url: `/wb/assets/faces/${id}/file`,
    mimeType: input.file.mimetype,
    sizeBytes: input.file.size,
    notes: input.notes?.trim() || "",
    active: true,
    createdAt: now,
    updatedAt: now,
  };

  const faces = [face, ...(await readFaceAssets())];
  await saveFaceAssets(faces);
  return { face, faces };
}

export async function updateFaceAssetActive(id: string, active: boolean): Promise<FaceAsset[]> {
  const faces = await readFaceAssets();
  const next = faces.map((face) =>
    face.id === id ? { ...face, active, updatedAt: new Date().toISOString() } : face
  );
  if (!faces.some((face) => face.id === id)) throw new Error("Face asset not found");
  await saveFaceAssets(next);
  return next;
}

export async function deleteFaceAsset(id: string): Promise<FaceAsset[]> {
  const faces = await readFaceAssets();
  const face = faces.find((item) => item.id === id);
  if (!face) throw new Error("Face asset not found");

  const next = faces.filter((item) => item.id !== id);
  await saveFaceAssets(next);
  await fs.unlink(path.join(facesDir, face.filename)).catch((error) => {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== "ENOENT") throw error;
  });
  return next;
}

export async function readFaceAssetFile(id: string): Promise<{ filePath: string; face: FaceAsset }> {
  const faces = await readFaceAssets();
  const face = faces.find((item) => item.id === id);
  if (!face) throw new Error("Face asset not found");
  return { filePath: path.join(facesDir, face.filename), face };
}
