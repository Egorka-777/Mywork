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

export type FaceAssetsResponse = {
  faces: FaceAsset[];
};

export type UploadFaceAssetResponse = {
  face: FaceAsset;
  faces: FaceAsset[];
};
