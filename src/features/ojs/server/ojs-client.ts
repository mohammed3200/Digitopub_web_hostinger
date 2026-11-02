import mysql from "mysql2/promise"
import type { OjsUserProvisionData } from "@/src/features/ojs/types"
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise"

let pool: Pool | null = null

function isOjsConfigured(): boolean {
    return !!(
        process.env.OJS_DATABASE_HOST &&
        process.env.OJS_DATABASE_NAME &&
        process.env.OJS_DATABASE_USER
    )
}

function getPool(): Pool {
    if (!pool) {
        if (!isOjsConfigured()) {
            throw new Error("OJS database is not configured. Set OJS_DATABASE_* env vars.")
        }

        // Apply external hosting connection options like ssl and allowPublicKeyRetrieval
        pool = mysql.createPool({
            host: process.env.OJS_DATABASE_HOST,
            port: parseInt(process.env.OJS_DATABASE_PORT || "3306"),
            database: process.env.OJS_DATABASE_NAME,
            user: process.env.OJS_DATABASE_USER,
            password: process.env.OJS_DATABASE_PASSWORD?.trim() || "",
            // OJS stores DATETIMEs in UTC; tell mysql2 to interpret returned
            // DATETIME values as UTC so `.toISOString()` on them doesn't drift
            // by the app server's local offset.
            timezone: "Z",
            connectionLimit: 3,
            connectTimeout: 10000,
            waitForConnections: true,
            queueLimit: 10,
            enableKeepAlive: true,
            keepAliveInitialDelay: 30000,
            ssl: {
                rejectUnauthorized: false,
                minVersion: 'TLSv1.2'
            },
            flags: ['+LOCAL_FILES'],
            allowPublicKeyRetrieval: true,
            authSwitchHandler: function ({ pluginName, pluginData: _pluginData }: { pluginName: string; pluginData: Buffer }, cb: (err?: Error | null) => void) {
                // If the server asks for mysql_native_password, but we KNOW it's caching_sha2_password
                if (pluginName === 'mysql_native_password' || pluginName === 'caching_sha2_password') {
                    // Let the internal mysql2 handler process it automatically based on its capabilities
                    return cb();
                }
                cb(new Error(`Unknown auth plugin: ${pluginName}`));
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any)
    }
    return pool
}

/**
 * Execute a query against the OJS database with retry logic.
 *
 * Uses exponential backoff: 1s → 2s → 4s (3 attempts max).
 */
export async function ojsQuery<T = RowDataPacket>(sql: string, params?: unknown[]): Promise<T[]> {
    const maxRetries = 3
    let lastError: Error | null = null

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        let conn: PoolConnection | undefined
        try {
            conn = await getPool().getConnection()
            const [rows] = await conn.query<RowDataPacket[]>(sql, params)
            return rows as T[]
        } catch (error) {
            const err = error as Error & { code?: string }
            lastError = err

            const nonRetryable = [
                "ER_ACCESS_DENIED_ERROR",
                "ER_DBACCESS_DENIED_ERROR",
                "ER_BAD_DB_ERROR",
                "ER_HOST_IS_BLOCKED",
            ]
            if (err.code && nonRetryable.includes(err.code)) {
                console.error(`[OJS] Non-retryable error (attempt ${attempt}/${maxRetries}):`, err.message)
                throw err
            }

            console.warn(`[OJS] Query failed (attempt ${attempt}/${maxRetries}): ${err.message}`)

            if (attempt < maxRetries) {
                const delay = Math.pow(2, attempt - 1) * 1000
                await new Promise((resolve) => setTimeout(resolve, delay))
            }
        } finally {
            if (conn) {
                try { conn.release() } catch { /* ignore */ }
            }
        }
    }

    throw lastError || new Error("OJS query failed after all retries")
}

/**
 * Resolves a journal's primary_locale from the OJS journals table.
 * Non-numeric ids and query failures fall back to `fallback` ("en") so
 * callers never hard-fail on locale lookup. Shared by all content services.
 */
export async function getJournalPrimaryLocale(
    ojsJournalId: string,
    fallback = "en"
): Promise<string> {
    if (!/^\d+$/.test(ojsJournalId)) return fallback
    try {
        const rows = await ojsQuery<{ primary_locale: string }>(
            "SELECT primary_locale FROM journals WHERE journal_id = ? LIMIT 1",
            [parseInt(ojsJournalId, 10)]
        )
        return rows[0]?.primary_locale || fallback
    } catch {
        return fallback
    }
}

/**
 * Gracefully close the OJS connection pool.
 */
export async function closeOjsPool(): Promise<void> {
    if (pool) {
        try { await pool.end() } catch { /* ignore */ }
        pool = null
    }
}

export async function getOjsConnection(): Promise<PoolConnection> {
    return getPool().getConnection()
}

/**
 * Forwards provisioning requests to the OJS API/bridge over HTTP.
 * Implements retry logic similar to ojsQuery.
 */
export async function provisionUser(payload: OjsUserProvisionData): Promise<{ success: boolean; error?: string }> {
    const maxRetries = 3;
    let lastError: Error | null = null;
    const baseUrlStr = process.env.OJS_BASE_URL?.replace(/\/$/, "") || "";
    const apiKey = process.env.OJS_API_KEY;

    if (!baseUrlStr) {
        return { success: false, error: "OJS_BASE_URL is not configured." };
    }
    if (!apiKey) {
        return { success: false, error: "OJS_API_KEY is not configured." };
    }

    // Validate URL and enforce HTTPS for non-local hosts
    let baseUrl: URL;
    try {
        baseUrl = new URL(baseUrlStr);
    } catch {
        return { success: false, error: `Invalid OJS_BASE_URL: ${baseUrlStr}` };
    }

    const isLoopback = ["localhost", "127.0.0.1", "::1"].includes(baseUrl.hostname);
    if (!isLoopback && baseUrl.protocol !== "https:") {
        return { success: false, error: "OJS_BASE_URL must use HTTPS for non-local environments." };
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

        try {
            const bridgeUrl = resolveUserBridgeUrl(baseUrlStr);
            const response = await fetch(bridgeUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${apiKey}`
                },
                body: JSON.stringify(payload),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                // 409 Conflict means the user already exists, which is a success for idempotency.
                // Check before reading the body so the skip path doesn't wait on it.
                if (response.status === 409) {
                    return { success: true };
                }

                const errText = await response.text();
                // Log full details for server diagnostics
                console.error(`[OJS Bridge] HTTP ${response.status} failure:`, errText);
                
                // 401/403 shouldn't be retried
                if (response.status === 401 || response.status === 403) {
                    return { success: false, error: "Auth error" };
                }
                throw new Error("Request failed");
            }
            return { success: true };
        } catch (error) {
            const err = error as Error & { name?: string }
            clearTimeout(timeoutId);
            lastError = err;

            if (err.name === 'AbortError') {
                console.warn(`[OJS Bridge] Provisioning timed out (attempt ${attempt}/${maxRetries})`);
            } else {
                console.warn(`[OJS Bridge] Provisioning failed (attempt ${attempt}/${maxRetries}): ${err.message}`);
            }

            if (attempt < maxRetries) {
                const delay = Math.pow(2, attempt - 1) * 1000;
                await new Promise(res => setTimeout(res, delay));
            }
        }
    }
    return { success: false, error: lastError?.message || "OJS provisioning failed after all retries" };
}

/**
 * URL of the OJS user bridge (ojs-user-bridge.php). OJS_USER_BRIDGE_URL
 * overrides the default next to OJS_BASE_URL. OJS_BRIDGE_URL is NOT used
 * here: it names the PDF bridge (see ojs-pdf-stream.ts), and reading it made
 * provisioning POST user data to ojs-pdf-bridge.php.
 */
export function resolveUserBridgeUrl(baseUrl = process.env.OJS_BASE_URL?.replace(/\/$/, "") || ""): string {
    return process.env.OJS_USER_BRIDGE_URL?.replace(/\/$/, "") || `${baseUrl}/ojs-user-bridge.php`;
}

export type UserBridgeResult =
    | { ok: true; status: number; data: Record<string, unknown> }
    | { ok: false; status: number | null; error: string; retryable: boolean; code?: string; data?: Record<string, unknown> };

/**
 * POST one action to the OJS user bridge, once, with a timeout. Retrying is
 * the caller's job (the OJS sync queue retries with backoff), so this never
 * loops. `retryable` is false only for answers that will not change on a
 * retry: 400, 404 and other 4xx except 401/403/408/429. Auth errors stay
 * retryable because they are fixed by correcting the key, not the request.
 */
export async function postToUserBridge(body: Record<string, unknown>, timeoutMs = 10000): Promise<UserBridgeResult> {
    const baseUrlStr = process.env.OJS_BASE_URL?.replace(/\/$/, "") || "";
    const apiKey = process.env.OJS_API_KEY;
    if (!apiKey || (!baseUrlStr && !process.env.OJS_USER_BRIDGE_URL)) {
        return { ok: false, status: null, error: "OJS bridge is not configured (OJS_API_KEY / OJS_BASE_URL)", retryable: true };
    }

    let url: URL;
    try {
        url = new URL(resolveUserBridgeUrl(baseUrlStr));
    } catch {
        return { ok: false, status: null, error: "Invalid OJS user bridge URL", retryable: false };
    }
    const isLoopback = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
    if (!isLoopback && url.protocol !== "https:") {
        return { ok: false, status: null, error: "OJS user bridge URL must use HTTPS", retryable: false };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
            body: JSON.stringify(body),
            signal: controller.signal,
            // A followed 301/302 turns the POST into a GET (the bridge then
            // answers 405), so a redirect is reported as a config error.
            redirect: "manual",
        });
        if (response.status >= 300 && response.status < 400) {
            const location = response.headers.get("location") ?? "another URL";
            return { ok: false, status: response.status, error: `OJS user bridge URL redirects to ${location}; set OJS_USER_BRIDGE_URL to the final URL`, retryable: true };
        }
        const text = await response.text();
        let data: Record<string, unknown> = {};
        try {
            data = JSON.parse(text);
        } catch {
            /* non-JSON answer, handled below */
        }
        if (response.ok && data.success === true) {
            return { ok: true, status: response.status, data };
        }
        const error = typeof data.error === "string" ? data.error : `HTTP ${response.status}`;
        const s = response.status;
        const retryable = s >= 500 || s === 401 || s === 403 || s === 408 || s === 429 || response.ok;
        // The bridge's machine-readable reason, e.g. "email_in_use" (#233).
        const code = typeof data.code === "string" ? data.code : undefined;
        return { ok: false, status: s, error, retryable, ...(code ? { code, data } : {}) };
    } catch (error) {
        const err = error as Error;
        const message = err.name === "AbortError" ? `OJS bridge timed out after ${timeoutMs} ms` : err.message;
        return { ok: false, status: null, error: message, retryable: true };
    } finally {
        clearTimeout(timeoutId);
    }
}

/**
 * Diagnostic health check to verify OJS database connectivity and configuration.
 */
export async function ojsHealthCheck(): Promise<{ ok: boolean; configured: boolean; error: string | null }> {
    const configured = isOjsConfigured()
    if (!configured) return { ok: false, configured: false, error: "Settings missing (OJS_DATABASE_*)" }

    let conn: PoolConnection | undefined
    try {
        // Use a single short-lived connection with a small timeout, bypassing ojsQuery's retry logic
        conn = await getPool().getConnection()
        await Promise.race([
            conn.query("SELECT 1"),
            new Promise((_, reject) => setTimeout(() => reject(new Error("Query timeout")), 2000))
        ])
        return { ok: true, configured: true, error: null }
    } catch (err) {
        return { ok: false, configured: true, error: (err as Error).message }
    } finally {
        if (conn) conn.release()
    }
}

export { isOjsConfigured }
