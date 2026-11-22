import dns, { type LookupAddress } from "node:dns";
import http, { type IncomingMessage } from "node:http";
import https from "node:https";
import net from "node:net";
import zlib from "node:zlib";
import { classifyHealth, type Health, type PageResponse } from "./health";
import { parseListing, resolve591Share, type ListingDetails } from "./listing";
import { parseMeta, type PageMeta } from "./meta";

// Reads one listing page to get its title, cover and description, and to see
// whether the site allows being shown in an iframe. Never reaches internal hosts.

const USER_AGENT = "PotionsArk/1.0 (+link preview)";
const TIMEOUT_MS = 6000;
const MAX_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 3;

export type Preview = PageMeta &
  ListingDetails & {
    fetched: boolean;
    embed: boolean;
    health: Health;
    healthReason: string;
    /** Set only when a 591 app share link was resolved: the listing it points to. */
    listingUrl: string;
  };

const blocked = new net.BlockList();
for (const [addr, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(addr, prefix, "ipv4");
for (const [addr, prefix] of [
  ["::", 128], ["::1", 128], ["64:ff9b::", 96], ["100::", 64], ["2001::", 32],
  ["2001:db8::", 32], ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
] as const) blocked.addSubnet(addr, prefix, "ipv6");

// Note: Node's BlockList matches every IPv4 address against an IPv6 rule for
// ::ffff:0:0/96, so IPv4-mapped IPv6 addresses are unwrapped by hand instead.
export function isBlockedAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) return blocked.check(address, "ipv4");
  if (family !== 6) return true;
  const mapped = address.toLowerCase().match(/^(?:0*:)*:?ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedAddress(mapped[1]);
  if (/^(?:0*:)*:?ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/i.test(address)) return true;
  return blocked.check(address, "ipv6");
}

/** Rejects URLs that must never be fetched by the server. */
export function isAllowedUrl(url: URL): boolean {
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  if (url.port && url.port !== "80" && url.port !== "443") return false;
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (net.isIP(host)) return false;
  if (!host.includes(".")) return false;
  if (host === "localhost" || /\.(localhost|local|internal|lan|home|corp|test|invalid)$/.test(host)) return false;
  return true;
}

function safeLookup(
  hostname: string,
  options: dns.LookupOptions,
  callback: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "");
    const list = addresses as LookupAddress[];
    if (list.length === 0 || list.some((a) => isBlockedAddress(a.address))) {
      return callback(Object.assign(new Error("blocked address"), { code: "EBLOCKED" }), "");
    }
    if (options.all) callback(null, list);
    else callback(null, list[0].address, list[0].family);
  });
}

type RawResponse = { status: number; headers: IncomingMessage["headers"]; body: string | null };

function requestOnce(url: URL, signal: AbortSignal): Promise<RawResponse> {
  const client = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.request(
      url,
      {
        method: "GET",
        signal,
        lookup: safeLookup as unknown as net.LookupFunction,
        headers: {
          "user-agent": USER_AGENT,
          accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
          "accept-language": "zh-TW,zh;q=0.9,en;q=0.5",
          "accept-encoding": "gzip, deflate, br",
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const type = String(res.headers["content-type"] ?? "");
        if ((status >= 300 && status < 400) || !/html|xml|json|text\//i.test(type)) {
          res.resume();
          return resolve({ status, headers: res.headers, body: null });
        }
        const encoding = String(res.headers["content-encoding"] ?? "").toLowerCase();
        const stream =
          encoding === "gzip" ? res.pipe(zlib.createGunzip())
          : encoding === "deflate" ? res.pipe(zlib.createInflate())
          : encoding === "br" ? res.pipe(zlib.createBrotliDecompress())
          : res;
        const chunks: Buffer[] = [];
        let size = 0;
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          res.destroy();
          resolve({ status, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") });
        };
        stream.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
          size += chunk.length;
          if (size >= MAX_BYTES) finish();
        });
        stream.on("end", finish);
        stream.on("error", (e) => (chunks.length ? finish() : reject(e)));
        signal.addEventListener("abort", finish, { once: true });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

/** Decides from response headers whether the page may be shown in an iframe. */
export function allowsEmbedding(headers: IncomingMessage["headers"]): boolean {
  if (headers["x-frame-options"]) return false;
  const csp = [headers["content-security-policy"]].flat().filter(Boolean).join(";");
  const directive = csp
    .split(/[;,]/)
    .map((d) => d.trim())
    .find((d) => d.toLowerCase().startsWith("frame-ancestors"));
  if (!directive) return true;
  const sources = directive.split(/\s+/).slice(1);
  return sources.some((s) => s === "*" || s === "https:" || s === "https://*");
}

export async function fetchPreview(rawUrl: string): Promise<Preview> {
  // Other sites' redirects (for example a removed listing sent to a home page)
  // must never replace the saved link, so only a resolved share link is reported.
  let listingUrl = "";
  const follow = (target: URL): URL => {
    const resolved = resolve591Share(target);
    if (resolved !== target) listingUrl = resolved.toString();
    return resolved;
  };
  let url = follow(new URL(rawUrl));
  const empty: Preview = {
    fetched: false,
    embed: url.protocol === "https:",
    title: "",
    image: "",
    description: "",
    contact: "",
    tags: {},
    photos: [],
    rent: null,
    area: null,
    address: "",
    floor: "",
    health: "unknown",
    healthReason: "",
    listingUrl: "",
  };
  const failed = (error: PageResponse["error"], embed = empty.embed): Preview => {
    const verdict = classifyHealth({ status: null, headers: {}, body: null, error });
    return { ...empty, embed, health: verdict.health, healthReason: verdict.reason, listingUrl };
  };
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!isAllowedUrl(url)) return failed("blocked", false);
      const res = await requestOnce(url, signal);
      const location = res.headers.location;
      if (res.status >= 300 && res.status < 400 && location) {
        url = follow(new URL(location, url));
        continue;
      }
      const embed = url.protocol === "https:" && allowsEmbedding(res.headers);
      const verdict = classifyHealth({ status: res.status, headers: res.headers, body: res.body });
      const base = { ...empty, embed, health: verdict.health, healthReason: verdict.reason, listingUrl };
      // Non-HTML bodies (JSON error pages) only feed the health check above.
      const isHtml = /html|xml/i.test(String(res.headers["content-type"] ?? ""));
      if (res.status !== 200 || !res.body || !isHtml || verdict.health === "gone") return base;
      const meta = parseMeta(res.body, url);
      const details = parseListing(res.body, url, meta.description);
      // The listing's structured title is preferred over og:title, which 591 sometimes sets to its own name.
      const title = details.title || meta.title;
      return { ...base, ...meta, ...details, title, fetched: Boolean(title || meta.image || meta.description || details.photos.length) };
    }
    return failed("redirects");
  } catch (error) {
    const code = (error as { code?: string; name?: string } | null) ?? {};
    if (code.code === "EBLOCKED") return failed("blocked", false);
    if (code.name === "TimeoutError" || code.name === "AbortError" || signal.aborted) return failed("timeout");
    return failed("network");
  }
}
