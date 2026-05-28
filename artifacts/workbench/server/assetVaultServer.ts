import cors from "cors";
import express from "express";
import multer from "multer";
import {
  createFaceAsset,
  deleteFaceAsset,
  readFaceAssetFile,
  readFaceAssets,
  updateFaceAssetActive,
} from "./assetVault";

const PORT = Number(process.env.ASSET_VAULT_API_PORT) || 8790;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 1 },
});

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "2mb" }));

app.get("/wb/assets/faces", async (_req, res) => {
  try {
    const faces = await readFaceAssets();
    return res.json({ faces });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/wb/assets/faces", upload.single("face"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "face file is required" });
    }

    const result = await createFaceAsset({
      file: req.file,
      name: typeof req.body.name === "string" ? req.body.name : undefined,
      notes: typeof req.body.notes === "string" ? req.body.notes : undefined,
    });

    return res.json(result);
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.patch("/wb/assets/faces/:id", async (req, res) => {
  try {
    const active = Boolean((req.body as { active?: unknown }).active);
    const faces = await updateFaceAssetActive(req.params.id, active);
    return res.json({ faces });
  } catch (error) {
    return res.status(404).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.delete("/wb/assets/faces/:id", async (req, res) => {
  try {
    const faces = await deleteFaceAsset(req.params.id);
    return res.json({ faces });
  } catch (error) {
    return res.status(404).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/wb/assets/faces/:id/file", async (req, res) => {
  try {
    const { filePath, face } = await readFaceAssetFile(req.params.id);
    res.type(face.mimeType);
    return res.sendFile(filePath);
  } catch (error) {
    return res.status(404).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`Asset Vault API: http://127.0.0.1:${PORT}`);
});
