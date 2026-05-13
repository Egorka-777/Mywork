const THREADS_BASE_URL = "https://graph.threads.net/v1.0";

async function postForm(path: string, params: Record<string, string>) {
  const body = new URLSearchParams(params);

  const res = await fetch(`${THREADS_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    cache: "no-store",
  });

  const json = (await res.json()) as { id?: string; error?: { message: string } };

  if (!res.ok) {
    throw new Error(
      `Threads API error: ${res.status} ${JSON.stringify(json)}`,
    );
  }

  return json;
}

export async function publishThread(input: {
  threadsUserId: string;
  accessToken: string;
  text: string;
  imageUrl?: string;
}) {
  const text = input.text.slice(0, 500);

  const createPayload: Record<string, string> = {
    media_type: input.imageUrl ? "IMAGE" : "TEXT",
    text,
    access_token: input.accessToken,
  };

  if (input.imageUrl) {
    createPayload.image_url = input.imageUrl;
  }

  const container = (await postForm(
    `/${input.threadsUserId}/threads`,
    createPayload,
  )) as { id: string };

  const published = (await postForm(`/${input.threadsUserId}/threads_publish`, {
    creation_id: container.id!,
    access_token: input.accessToken,
  })) as { id: string };

  return {
    containerId: container.id!,
    postId: published.id!,
  };
}
