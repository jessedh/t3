import path from "path";

const { DatabaseSync } = (process as unknown as { getBuiltinModule: (id: string) => typeof import("node:sqlite") }).getBuiltinModule("node:sqlite");

const dbPath = process.env.NONCE_DB_PATH || path.join(process.cwd(), ".ponder", "nonce-store.db");

const db = new DatabaseSync(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS consumed_nonce (
    id TEXT PRIMARY KEY,
    signer_address TEXT NOT NULL,
    consumed_at INTEGER NOT NULL
  )
`);

export function hasNonce(nonce: string): boolean {
    const stmt = db.prepare("SELECT 1 FROM consumed_nonce WHERE id = ?");
    const row = stmt.get(nonce) as { 1: number } | undefined;
    return !!row;
}

export function consumeNonce(nonce: string, signerAddress: string, consumedAt: number): void {
    const stmt = db.prepare(
        "INSERT OR IGNORE INTO consumed_nonce (id, signer_address, consumed_at) VALUES (?, ?, ?)"
    );
    stmt.run(nonce, signerAddress.toLowerCase(), consumedAt);
}
