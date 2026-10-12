/**
 * Optional capsule registry (DataLab-Capsule ``registry`` extra), over HTTP.
 *
 * Nothing here is required: without a registry address, capsules are
 * exchanged as files only. The registry is never trusted: manifests and
 * reviews it returns are checked by DataLab-Capsule in the runtime, and
 * attachments against the SHA-256 declared by the checked manifest.
 *
 * The address is kept in ``localStorage``; the publishing token only in
 * ``sessionStorage`` (forgotten when the tab closes).
 */

import { t } from "../i18n/translate";

const ADDRESS_KEY = "datalab-web.capsuleRegistry.address";
const TOKEN_KEY = "datalab-web.capsuleRegistry.token";

export interface RegistrySettings {
  /** Base address (``https://…``), or "" when no registry is used. */
  address: string;
  /** Bearer token for publishing, or "". */
  token: string;
}

export function loadRegistrySettings(): RegistrySettings {
  return {
    address: localStorage.getItem(ADDRESS_KEY) ?? "",
    token: sessionStorage.getItem(TOKEN_KEY) ?? "",
  };
}

export function saveRegistrySettings(settings: RegistrySettings): void {
  const address = settings.address.trim();
  if (address) localStorage.setItem(ADDRESS_KEY, registryBase(address));
  else localStorage.removeItem(ADDRESS_KEY);
  if (settings.token) sessionStorage.setItem(TOKEN_KEY, settings.token);
  else sessionStorage.removeItem(TOKEN_KEY);
}

/** Normalise a registry address; only absolute http(s) URLs are accepted. */
export function registryBase(address: string): string {
  let url: URL;
  try {
    url = new URL(address.trim());
  } catch {
    throw new Error(t("The registry address must be an http or https URL"));
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(t("The registry address must be an http or https URL"));
  }
  return url.href.replace(/\/+$/, "");
}

/** One revision in the registry's flat list. */
export interface RegistryRevision {
  fingerprint: string;
  name: string;
  description: string;
  revision_of: string | null;
  date_published: string;
  workspace_referenced: boolean;
  published_at: string;
  attachments: {
    name: string;
    media_type: string;
    size: number;
    sha256: string;
    description: string | null;
    stored: boolean;
  }[];
  reviews: number;
}

/** Lowercase hexadecimal SHA-256 of *data*. */
export async function sha256Hex(
  data: Uint8Array<ArrayBuffer>,
): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * Largest responses read from a registry, in bytes: those of DataLab-Capsule's
 * client (``registry_client``), checked by ``tests/python``.
 */
export const REGISTRY_LIMITS = {
  /** Revisions, or the reviews of a revision (``MAX_LISTING_BYTES``). */
  listing: 16_777_216,
  /** A manifest (``registry.MAX_REGISTRY_MANIFEST_BYTES``). */
  manifest: 8_388_608,
  /** Status, publication result or error (``MAX_REPLY_BYTES``). */
  reply: 65_536,
} as const;

/** Read a response body, refusing it as soon as it exceeds *limit* bytes. */
export async function readLimited(
  response: Response,
  limit: number,
): Promise<Uint8Array<ArrayBuffer>> {
  if (!Number.isSafeInteger(limit) || limit < 0) {
    throw new RangeError(`Invalid response limit: ${limit}`);
  }
  const tooLarge = () =>
    new Error(t("The registry response exceeds {limit} bytes", { limit }));
  const declared = response.headers.get("Content-Length");
  if (declared !== null && /^\d+$/.test(declared) && Number(declared) > limit) {
    await response.body?.cancel();
    throw tooLarge();
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (response.body) {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw tooLarge();
      }
      chunks.push(value);
    }
  }
  const data = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return data;
}

async function readJson<T>(response: Response, limit: number): Promise<T> {
  return JSON.parse(
    new TextDecoder().decode(await readLimited(response, limit)),
  ) as T;
}

export class RegistryClient {
  private readonly base: string;

  constructor(
    address: string,
    private readonly token: string = "",
  ) {
    this.base = `${registryBase(address)}/api/v1`;
  }

  private async request(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    if (init.method && init.method !== "GET" && this.token) {
      headers.set("Authorization", `Bearer ${this.token}`);
    }
    let response: Response;
    try {
      response = await fetch(`${this.base}${path}`, { ...init, headers });
    } catch {
      throw new Error(t("The registry cannot be reached"));
    }
    if (!response.ok) {
      let detail = response.statusText;
      try {
        const body = await readJson<{ detail?: unknown }>(
          response,
          REGISTRY_LIMITS.reply,
        );
        if (typeof body.detail === "string") detail = body.detail;
      } catch {
        // Keep the status text.
      }
      throw new Error(
        t("Registry error {status}: {detail}", {
          status: response.status,
          detail,
        }),
      );
    }
    return response;
  }

  private static revisionPath(fingerprint: string): string {
    return `/revisions/${encodeURIComponent(fingerprint)}`;
  }

  async status(): Promise<{
    registry: string;
    version: string;
    token_required: boolean;
  }> {
    return readJson(await this.request("/status"), REGISTRY_LIMITS.reply);
  }

  async listRevisions(): Promise<RegistryRevision[]> {
    return readJson(await this.request("/revisions"), REGISTRY_LIMITS.listing);
  }

  /** Manifest text as published (to be checked by the runtime). */
  async getManifestText(fingerprint: string): Promise<string> {
    return new TextDecoder().decode(
      await readLimited(
        await this.request(RegistryClient.revisionPath(fingerprint)),
        REGISTRY_LIMITS.manifest,
      ),
    );
  }

  /** Reviews of a revision, as JSON texts (to be checked by the runtime). */
  async listReviewTexts(fingerprint: string): Promise<string[]> {
    const reviews = await readJson<unknown[]>(
      await this.request(`${RegistryClient.revisionPath(fingerprint)}/reviews`),
      REGISTRY_LIMITS.listing,
    );
    return reviews.map((review) => JSON.stringify(review));
  }

  async publishManifest(
    manifest: string,
  ): Promise<{ fingerprint: string; created: boolean }> {
    return readJson(
      await this.request("/revisions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: manifest,
      }),
      REGISTRY_LIMITS.reply,
    );
  }

  async uploadAttachment(
    fingerprint: string,
    name: string,
    data: Uint8Array,
  ): Promise<void> {
    await this.request(
      `${RegistryClient.revisionPath(fingerprint)}/attachments/${encodeURIComponent(name)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body: data.slice(),
      },
    );
  }

  /** Download an attachment and check it against *sha256* and *size* (from the
   *  checked manifest, not from the registry's list). */
  async getAttachment(
    fingerprint: string,
    name: string,
    sha256: string,
    size: number,
  ): Promise<Uint8Array> {
    const response = await this.request(
      `${RegistryClient.revisionPath(fingerprint)}/attachments/${encodeURIComponent(name)}`,
    );
    const data = await readLimited(response, size);
    if (data.byteLength !== size || (await sha256Hex(data)) !== sha256) {
      throw new Error(
        t(
          "The attachment from the registry does not match the manifest: {name}",
          {
            name,
          },
        ),
      );
    }
    return data;
  }

  async publishReview(
    review: string,
  ): Promise<{ fingerprint: string; target: string; created: boolean }> {
    return readJson(
      await this.request("/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: review,
      }),
      REGISTRY_LIMITS.reply,
    );
  }
}
