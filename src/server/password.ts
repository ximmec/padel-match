import { scrypt, randomBytes, timingSafeEqual, createHash } from "node:crypto";

const N = 16384, R = 8, P = 1, KEYLEN = 64;

function scryptAsync(pw: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(pw.normalize("NFKC"), salt, KEYLEN, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(pw, salt, N, R, P);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, "base64");
  const key = await scryptAsync(pw, Buffer.from(salt, "base64"), Number(n), Number(r), Number(p));
  return key.length === expected.length && timingSafeEqual(key, expected);
}

export function passwordProblems(pw: string): string | null {
  if (pw.length < 10) return "La contraseña debe tener al menos 10 caracteres.";
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return "La contraseña debe combinar letras y números.";
  return null;
}

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}
