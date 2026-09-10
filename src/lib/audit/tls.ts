// Certificate check for the https rule (contract §7.1 step 3, §7.2 https).
// Connects to the VETTED IP with the hostname as SNI, never to a name, so the
// same rebinding guard as the crawler applies. Socket-level timeout; the
// handshake result and the certificate's expiry are the only outputs.
import { connect } from "node:tls";
import type { PeerCertificate } from "node:tls";

export interface TlsInfo {
  /** The handshake completed (a certificate was presented, valid or not). */
  ok: boolean;
  /** Chain and hostname verified by Node's default trust store. */
  authorized: boolean;
  /** Socket or verification error code (ECONNREFUSED, CERT_HAS_EXPIRED, ERR_TLS_CERT_ALTNAME_INVALID…). */
  error: string | null;
  /** Certificate notAfter as ISO string. */
  validTo: string | null;
  /** Whole days until notAfter (negative when expired). */
  daysLeft: number | null;
  protocol: string | null;
  issuer: string | null;
  ms: number;
}

export const TLS_TIMEOUT_MS = 8_000;

function issuerName(cert: PeerCertificate | undefined): string | null {
  const iss = cert?.issuer as Record<string, string | string[]> | undefined;
  const v = iss?.O ?? iss?.CN;
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" && s ? s.slice(0, 80) : null;
}

/**
 * TLS handshake against `ip`:443 with `servername = hostname`. Resolves
 * always (never throws); `ok: false` with an error code on refusal/timeout.
 */
export function checkTls(hostname: string, ip: string, opts: { timeoutMs?: number; signal?: AbortSignal; now?: Date } = {}): Promise<TlsInfo> {
  const started = Date.now();
  const timeoutMs = opts.timeoutMs ?? TLS_TIMEOUT_MS;
  return new Promise((resolve) => {
    let done = false;
    const finish = (info: Omit<TlsInfo, "ms">) => {
      if (done) return;
      done = true;
      clearTimeout(hard);
      opts.signal?.removeEventListener("abort", onAbort);
      try {
        socket.destroy();
      } catch {
        /* already gone */
      }
      resolve({ ...info, ms: Date.now() - started });
    };
    const fail = (error: string) => finish({ ok: false, authorized: false, error, validTo: null, daysLeft: null, protocol: null, issuer: null });
    const onAbort = () => fail("aborted");
    const socket = connect({
      host: ip,
      port: 443,
      servername: hostname,
      rejectUnauthorized: false,
      ALPNProtocols: ["http/1.1"],
      timeout: timeoutMs,
    });
    const hard = setTimeout(() => fail("timeout"), timeoutMs + 500);
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    socket.once("timeout", () => fail("timeout"));
    socket.once("error", (e: NodeJS.ErrnoException) => fail(e.code ?? e.message.slice(0, 80)));
    socket.once("secureConnect", () => {
      const cert = socket.getPeerCertificate(false);
      const validTo = cert?.valid_to ? new Date(cert.valid_to) : null;
      const validOk = validTo !== null && !Number.isNaN(validTo.getTime());
      const now = (opts.now ?? new Date()).getTime();
      const authError = socket.authorizationError as unknown;
      const authCode = typeof authError === "string" ? authError : authError instanceof Error ? ((authError as NodeJS.ErrnoException).code ?? authError.message) : null;
      finish({
        ok: true,
        authorized: socket.authorized === true,
        error: socket.authorized ? null : (authCode ?? "unauthorized").slice(0, 80),
        validTo: validOk ? validTo.toISOString() : null,
        daysLeft: validOk ? Math.floor((validTo.getTime() - now) / 86_400_000) : null,
        protocol: socket.getProtocol() ?? null,
        issuer: issuerName(cert),
      });
    });
  });
}
