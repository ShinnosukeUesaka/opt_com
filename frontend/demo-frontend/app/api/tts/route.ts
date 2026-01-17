type TtsRequest = {
  text: string;
  voice_id?: string;
  model_id?: string;
  output_format?: string;
};

const DEFAULT_VOICE_ID = "onwK4e9ZLuTAKqWW03F9";
const DEFAULT_MODEL_ID = "eleven_multilingual_v2";
const DEFAULT_OUTPUT_FORMAT = "mp3_44100_128";

export async function POST(req: Request) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return Response.json(
      { detail: "ELEVENLABS_API_KEY is not set" },
      { status: 500 },
    );
  }

  let body: TtsRequest;
  try {
    body = (await req.json()) as TtsRequest;
  } catch {
    return Response.json({ detail: "Invalid JSON payload" }, { status: 400 });
  }

  const text = body.text?.trim() ?? "";
  if (!text) {
    return Response.json({ detail: "text is required" }, { status: 400 });
  }

  const voiceId =
    body.voice_id ?? process.env.ELEVENLABS_VOICE_ID ?? DEFAULT_VOICE_ID;
  const modelId =
    body.model_id ?? process.env.ELEVENLABS_MODEL_ID ?? DEFAULT_MODEL_ID;
  const outputFormat =
    body.output_format ??
    process.env.ELEVENLABS_OUTPUT_FORMAT ??
    DEFAULT_OUTPUT_FORMAT;

  const url = new URL(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
  );
  if (outputFormat) {
    url.searchParams.set("output_format", outputFormat);
  }

  const upstream = await fetch(url.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "xi-api-key": apiKey,
    },
    body: JSON.stringify({ text, model_id: modelId }),
  });

  if (!upstream.ok) {
    const rawText = await upstream.text();
    let detail = rawText || "ElevenLabs request failed";
    try {
      const data = JSON.parse(rawText) as { detail?: string };
      if (typeof data?.detail === "string") {
        detail = data.detail;
      }
    } catch {
      // Keep raw text if parsing fails.
    }
    return Response.json({ detail }, { status: upstream.status });
  }

  const audioBuffer = await upstream.arrayBuffer();
  const contentType = upstream.headers.get("content-type") || "audio/mpeg";
  return new Response(audioBuffer, {
    status: 200,
    headers: {
      "Content-Type": contentType,
    },
  });
}
