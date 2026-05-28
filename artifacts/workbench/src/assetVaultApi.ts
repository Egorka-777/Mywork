import type { FaceAsset, FaceAssetsResponse, UploadFaceAssetResponse } from "./assetVaultTypes";

async function readError(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  if (!text) return `${response.status} ${response.statusText}`;

  try {
    const data = JSON.parse(text) as { error?: string; detail?: unknown };
    const detail = data.detail ? ` — ${typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail)}` : "";
    return `${data.error ?? text}${detail}`;
  } catch {
    return text;
  }
}

export async function fetchFaceAssets(): Promise<FaceAsset[]> {
  const response = await fetch("/wb/assets/faces");
  if (!response.ok) throw new Error(await readError(response));
  const data = (await response.json()) as FaceAssetsResponse;
  return data.faces;
}

export async function uploadFaceAsset(input: { file: File; name: string; notes?: string }): Promise<UploadFaceAssetResponse> {
  const form = new FormData();
  form.append("face", input.file);
  form.append("name", input.name);
  form.append("notes", input.notes ?? "");

  const response = await fetch("/wb/assets/faces", {
    method: "POST",
    body: form,
  });
  if (!response.ok) throw new Error(await readError(response));
  return (await response.json()) as UploadFaceAssetResponse;
}

export async function deleteFaceAsset(id: string): Promise<FaceAsset[]> {
  const response = await fetch(`/wb/assets/faces/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!response.ok) throw new Error(await readError(response));
  const data = (await response.json()) as FaceAssetsResponse;
  return data.faces;
}

export async function setActiveFaceAsset(id: string, active: boolean): Promise<FaceAsset[]> {
  const response = await fetch(`/wb/assets/faces/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ active }),
  });
  if (!response.ok) throw new Error(await readError(response));
  const data = (await response.json()) as FaceAssetsResponse;
  return data.faces;
}
