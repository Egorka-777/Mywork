import cors from "cors";
import express from "express";
import {
  createLipsyncJob,
  deleteLipsyncJob,
  markLipsyncJobReady,
  readLipsyncJob,
  readLipsyncJobs,
} from "./lipsync";

const PORT = Number(process.env.LIPSYNC_API_PORT) || 8791;

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "2mb" }));

app.get("/wb/lipsync/jobs", async (_req, res) => {
  try {
    const jobs = await readLipsyncJobs();
    return res.json({ jobs });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/wb/lipsync/jobs", async (req, res) => {
  try {
    const job = await createLipsyncJob(req.body);
    return res.json({ job });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/wb/lipsync/jobs/:id", async (req, res) => {
  try {
    const job = await readLipsyncJob(req.params.id);
    return res.json({ job });
  } catch (error) {
    return res.status(404).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/wb/lipsync/jobs/:id/ready", async (req, res) => {
  try {
    const job = await markLipsyncJobReady(req.params.id);
    return res.json({ job });
  } catch (error) {
    return res.status(404).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.delete("/wb/lipsync/jobs/:id", async (req, res) => {
  try {
    const jobs = await deleteLipsyncJob(req.params.id);
    return res.json({ jobs });
  } catch (error) {
    return res.status(404).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`Lipsync Studio API: http://127.0.0.1:${PORT}`);
});
