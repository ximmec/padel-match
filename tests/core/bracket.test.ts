import { test } from "node:test";
import assert from "node:assert/strict";
import { fixedTiers, qualifierRefs } from "../../src/core/bracket";

test("siempre 16: escalones de 1°, 2° y mejores 3°", () => {
  const take = (sizes: number[]) => fixedTiers(sizes, 16).map((t) => `${t.take}x${t.pos}`).join(" ");
  assert.equal(take([3, 3, 3, 3, 3, 3, 3]), "7x1 7x2 2x3");          // 21 parejas
  assert.equal(take([4, 3, 3, 3, 3, 3, 3]), "7x1 7x2 2x3");          // 22 parejas
  assert.equal(take([3, 3, 3, 3, 3, 3, 3, 3]), "8x1 8x2");           // 24 parejas
  assert.equal(take([3, 3, 3, 3, 3, 3]), "6x1 6x2 4x3");             // 18 parejas
  assert.equal(take(Array(10).fill(3)), "10x1 6x2");                 // 30 parejas
  assert.equal(take([3, 3, 4, 4]), "4x1 4x2 4x3 2x4");              // 14 parejas: pasan todas
  const refs = qualifierRefs(Array.from({ length: 7 }, (_, i) => ({ id: `z${i}`, size: 3 })), { perZone: 2, bestNext: 0, fixedTotal: 16 });
  assert.equal(refs.length, 16);
  assert.ok(refs.every((r) => r.ref.t === "CROSS"));
});
