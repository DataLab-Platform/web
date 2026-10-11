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
        const body = (await response.json()) as { detail?: unknown };
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
    return (await this.request("/status")).json();
  }

  async listRevisions(): Promise<RegistryRevision[]> {
    return (await this.request("/revisions")).json();
  }

  /** Manifest text as published (to be checked by the runtime). */
  async getManifestText(fingerprint: string): Promise<string> {
    return (
      await this.request(RegistryClient.revisionPath(fingerprint))
    ).text();
  }

  /** Reviews of a revision, as JSON texts (to be checked by the runtime). */
  async listReviewTexts(fingerprint: string): Promise<string[]> {
    const reviews = (await (
      await this.request(`${RegistryClient.revisionPath(fingerprint)}/reviews`)
    ).json()) as unknown[];
    return reviews.map((review) => JSON.stringify(review));
  }

  async publishManifest(
    manifest: string,
  ): Promise<{ fingerprint: string; created: boolean }> {
    return (
      await this.request("/revisions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: manifest,
      })
    ).json();
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

  /** Download an attachment and check it against *sha256* (from the checked
   *  manifest, not from the registry's list). */
  async getAttachment(
    fingerprint: string,
    name: string,
    sha256: string,
  ): Promise<Uint8Array> {
    const response = await this.request(
      `${RegistryClient.revisionPath(fingerprint)}/attachments/${encodeURIComponent(name)}`,
    );
    const data = new Uint8Array(await response.arrayBuffer());
    if ((await sha256Hex(data)) !== sha256) {
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
    return (
      await this.request("/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: review,
      })
    ).json();
  }
}
