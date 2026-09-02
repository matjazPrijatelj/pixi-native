export interface RtpTestConfig {
  readonly urls: readonly [string, string];
  readonly localAddress?: string;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly inputArgs: readonly string[];
}

function positiveNumber(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return parsed;
}

function parseExtraArgs(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  const parsed: unknown = JSON.parse(value);
  if (
    !Array.isArray(parsed) ||
    parsed.some((entry) => typeof entry !== "string")
  ) {
    throw new Error(
      "RTP_TEST_EXTRA_INPUT_ARGS_JSON must be a JSON string array",
    );
  }
  return parsed;
}

export function loadRtpTestConfig(
  environment: NodeJS.ProcessEnv = process.env,
): RtpTestConfig | null {
  const firstUrl = environment.RTP_TEST_URL_1?.trim();
  const secondUrl = environment.RTP_TEST_URL_2?.trim();
  if (!firstUrl || !secondUrl) return null;

  const localAddress = environment.RTP_TEST_LOCAL_ADDRESS?.trim() || undefined;
  // prettier-ignore
  const inputArgs = [
        "-protocol_whitelist", "file,http,https,tcp,udp,rtp",
        ...(localAddress ? ["-localaddr", localAddress] : []),

        "-fflags", "nobuffer",
        "-flags", "low_delay",

        // "-buffer_size", "1048576",
        // "-reorder_queue_size", "1024",
        // "-max_delay", "1024",

        "-probesize", "32768",
        "-analyzeduration", "100000",
        // "-threads", "1",
        ...parseExtraArgs(environment.RTP_TEST_EXTRA_INPUT_ARGS_JSON),
    ];

  return {
    urls: [firstUrl, secondUrl],
    localAddress,
    width: positiveNumber(environment.RTP_TEST_WIDTH, 1920, "RTP_TEST_WIDTH"),
    height: positiveNumber(
      environment.RTP_TEST_HEIGHT,
      1080,
      "RTP_TEST_HEIGHT",
    ),
    fps: positiveNumber(environment.RTP_TEST_FPS, 25, "RTP_TEST_FPS"),
    inputArgs,
  };
}
