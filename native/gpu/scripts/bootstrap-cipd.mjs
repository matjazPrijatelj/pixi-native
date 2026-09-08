import Fs from "fs";
import Path from "path";
import { createHash } from "crypto";
import C from "./util/common.js";
import { fetch } from "./util/fetch.js";

if (C.platform === "win32") {
  const cipdPlatform = "windows-amd64";
  const cipdBinary = Path.join(C.dir.depotTools, ".cipd_client.exe");
  if (!Fs.existsSync(cipdBinary)) {
    const versionFile = Path.join(C.dir.depotTools, "cipd_client_version");
    const version = (await Fs.promises.readFile(versionFile, "utf8")).trim();
    const digests = await Fs.promises.readFile(
      `${versionFile}.digests`,
      "utf8",
    );
    const digestPattern = new RegExp(
      `^${cipdPlatform}\\s+sha256\\s+([0-9a-f]+)$`,
      "mu",
    );
    const expectedDigest = digests.match(digestPattern)?.[1];
    if (!expectedDigest)
      throw new Error(`Missing CIPD SHA-256 digest for ${cipdPlatform}`);

    const url = `https://chrome-infra-packages.appspot.com/client?platform=${cipdPlatform}&version=${encodeURIComponent(version)}`;
    console.log("bootstrap CIPD client with Node TLS", url);
    const response = await fetch(url);
    const binary = await response.buffer();
    const actualDigest = createHash("sha256").update(binary).digest("hex");
    if (actualDigest !== expectedDigest) {
      throw new Error(
        `Invalid CIPD SHA-256 digest: ${actualDigest} != ${expectedDigest}`,
      );
    }
    await Fs.promises.writeFile(cipdBinary, binary, { mode: 0o755 });
  }
}
