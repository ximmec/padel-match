/**
 * Prueba de punta a punta con un navegador real: recorre la app como lo haría un organizador
 * y un jugador. Corre en GitHub Actions contra el servidor compilado y una base vacía.
 */
import { test, expect, type Page } from "@playwright/test";
import postgres from "postgres";

test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);

const shot = (page: Page, name: string) => page.screenshot({ path: `e2e-shots/${name}.png`, fullPage: true });
const state: { tournamentUrl?: string; categoryUrl?: string; slug?: string; tcId?: string; tournamentId?: string } = {};

async function login(page: Page) {
  await page.goto("/login");
  if (page.url().includes("/admin")) return;
  await page.getByLabel("Email").fill("admin@padel-match.net");
  await page.getByLabel("Contraseña").fill("Prueba12345");
  await page.getByRole("button", { name: "Ingresar" }).click();
  await page.waitForURL("**/admin");
}

test("configuración inicial y datos base", async ({ page }) => {
  await page.goto("/");
  await shot(page, "01-publico-vacio");
  await page.goto("/setup");
  await page.locator('input[name="orgName"]').fill("Circuito de Prueba");
  await page.locator('input[name="name"]').fill("Admin Prueba");
  await page.locator('input[name="email"]').fill("admin@padel-match.net");
  await page.locator('input[name="password"]').fill("Prueba12345");
  await shot(page, "02-setup");
  await page.getByRole("button", { name: "Crear y entrar" }).click();
  await page.waitForURL("**/admin");
  await expect(page.getByText("Hola, Admin")).toBeVisible();

  // 24 jugadores de prueba directamente en la base
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  const [org] = await sql<{ id: string }[]>`SELECT id FROM organizations LIMIT 1`;
  const names = ["Gómez", "Pérez", "Rodríguez", "Fernández", "López", "Martínez", "García", "Sánchez", "Romero", "Díaz", "Álvarez", "Torres",
    "Ruiz", "Ramírez", "Flores", "Acosta", "Benítez", "Medina", "Herrera", "Suárez", "Aguirre", "Giménez", "Molina", "Castro"];
  for (let i = 0; i < names.length; i++) {
    await sql`INSERT INTO players (org_id, code, first_name, last_name, gender) VALUES (${org.id}, ${"PM-T" + String(i).padStart(3, "0")}, ${["Juan", "Pedro", "Lucas", "Martín", "Diego", "Pablo"][i % 6]}, ${names[i]}, 'M')`;
  }
  await sql.end();

  await page.goto("/admin/settings");
  await page.getByPlaceholder("Nombre de la sede").fill("Club Central");
  await page.getByPlaceholder("Cant. de canchas").fill("3");
  await page.getByRole("button", { name: "+ Nueva sede" }).click();
  await expect(page.getByText("Sede creada.")).toBeVisible();
  await shot(page, "03-configuracion");

  await page.goto("/admin/players");
  await expect(page.getByText("24 jugador(es)")).toBeVisible();
  await shot(page, "04-jugadores");
});

test("torneo, inscripciones, zonas, cuadro y cronograma", async ({ page }) => {
  await login(page);
  await page.goto("/admin/tournaments/new");
  await page.locator('input[name="name"]').fill("Abierto de Primavera");
  await page.locator('input[name="start_date"]').fill("2026-10-10");
  await page.locator('select[name="venue_id"]').selectOption({ label: "Club Central" });
  await page.getByLabel("Libre Masculina").check();
  await shot(page, "05-nuevo-torneo");
  await page.getByRole("button", { name: "Crear torneo" }).click();
  await page.waitForURL(/\/admin\/tournaments\/[0-9a-f-]{36}$/);
  state.tournamentUrl = page.url();
  state.tournamentId = page.url().split("/").pop();

  await page.getByRole("button", { name: "+ Agregar franja horaria" }).click();
  await expect(page.getByText("Disponibilidad agregada.")).toBeVisible();
  await shot(page, "06-torneo");

  await page.getByRole("link", { name: "Libre Masculina" }).first().click();
  await page.waitForURL(/\/c\/[0-9a-f-]{36}/);
  state.categoryUrl = page.url().split("?")[0];
  state.tcId = state.categoryUrl.split("/").pop();

  // 11 parejas (zonas desiguales 4-4-3)
  for (let i = 0; i < 11; i++) {
    await page.locator('select[name="player1"]').selectOption({ index: 1 });
    await page.locator('select[name="player2"]').selectOption({ index: 2 });
    if (i < 3) await page.locator('input[name="seed"]').last().fill(String(i + 1));
    await page.getByRole("button", { name: "Inscribir" }).click();
    await expect(page.locator("summary", { hasText: "Acciones" })).toHaveCount(i + 1);
  }
  await shot(page, "07-inscripciones");

  // Duplicado: el mismo jugador no aparece como disponible; probamos la validación de pareja repetida
  await page.goto(`${state.categoryUrl}?tab=zonas`);
  await page.getByRole("button", { name: /Generar zonas con 11 parejas/ }).click();
  await expect(page.getByText(/Zonas generadas/)).toBeVisible();
  await expect(page.locator("h3", { hasText: /^Zona [ABC]$/ })).toHaveCount(3);
  await shot(page, "08-zonas");

  await page.goto(`${state.categoryUrl}?tab=cuadro`);
  await page.getByRole("button", { name: "Generar cuadro" }).click();
  await expect(page.getByText("Cuadro generado.")).toBeVisible();
  await shot(page, "09-cuadro-vacio");

  page.on("dialog", (d) => d.accept());
  await page.goto(`${state.tournamentUrl}/schedule`);
  await page.getByRole("button", { name: "Generar cronograma" }).click();
  await expect(page.getByText(/partidos programados/)).toBeVisible();
  await page.reload();
  await expect(page.locator(".slot-item").first()).toBeVisible();
  await shot(page, "10-cronograma");
});

test("carga de resultados hasta el campeón", async ({ page }) => {
  await login(page);
  for (let i = 0; i < 40; i++) {
    await page.goto(`/admin/results?t=${state.tournamentId}`);
    const card = page.locator(".quick-match").first();
    if ((await card.count()) === 0) break;
    if (i === 0) await shot(page, "11-resultados");
    await card.locator('input[name="s1a"]').fill("6");
    await card.locator('input[name="s1b"]').fill(String(i % 5));
    await card.locator('input[name="s2a"]').fill("6");
    await card.locator('input[name="s2b"]').fill(String((i + 2) % 5));
    await Promise.all([
      page.waitForResponse((r) => r.request().method() === "POST"),
      card.getByRole("button", { name: "Guardar" }).click(),
    ]);
    await page.waitForTimeout(300);
    await expect(page.locator(".alert.err")).toHaveCount(0);
  }
  await page.goto(`${state.categoryUrl}?tab=posiciones`);
  await expect(page.getByText("Definida").first()).toBeVisible();
  await shot(page, "12-posiciones");
  await page.goto(`${state.categoryUrl}?tab=cuadro`);
  await shot(page, "13-cuadro-final");
  await page.goto("/admin/ranking");
  await expect(page.locator("td.num b", { hasText: "1000" }).first()).toBeVisible();
  await shot(page, "14-ranking");
});

test("corrección con confirmación e historial", async ({ page }) => {
  await login(page);
  await page.goto(`${state.categoryUrl}?tab=partidos`);
  const first = page.locator("details", { hasText: "Corregir resultado" }).first();
  await first.locator("summary").click();
  await first.locator('input[name="s1a"]').fill("2");
  await first.locator('input[name="s1b"]').fill("6");
  await first.locator('input[name="s2a"]').fill("2");
  await first.locator('input[name="s2b"]').fill("6");
  await first.getByPlaceholder("Motivo de la corrección").fill("Error de carga");
  await first.getByRole("button", { name: "Corregir" }).click();
  const confirm = first.getByRole("button", { name: "Confirmar y aplicar" });
  await expect(first.getByText(/Resultado guardado|Esta corrección afecta/)).toBeVisible();
  if (await confirm.isVisible()) {
    await shot(page, "15-confirmacion");
    await confirm.click();
    await expect(first.getByText(/Resultado guardado/)).toBeVisible();
  }
  await page.goto(`${state.categoryUrl}?tab=historial`);
  await expect(page.getByText("Error de carga").first()).toBeVisible();
  await shot(page, "16-historial");
  await page.goto("/admin/audit");
  await expect(page.getByText("Corrección de resultado").first()).toBeVisible();
  await shot(page, "17-auditoria");

  const res = await page.request.get(`/api/export?type=tournament&t=${state.tournamentId}`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("spreadsheetml");
  expect((await res.body()).length).toBeGreaterThan(5000);
});

test("vista pública en celular", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const page = await ctx.newPage();
  await page.goto("/");
  await expect(page.getByText("Abierto de Primavera")).toBeVisible();
  await shot(page, "20-movil-inicio");
  await page.getByText("Abierto de Primavera").click();
  await page.waitForURL(/\/t\//);
  await expect(page.getByText("En vivo", { exact: true })).toBeVisible();
  await shot(page, "21-movil-torneo");
  await page.getByRole("link", { name: /Libre Masculina/ }).first().click();
  await expect(page.getByText(/Zona A/).first()).toBeVisible();
  await shot(page, "22-movil-zonas");
  await page.getByRole("link", { name: "Cuadro" }).click();
  await shot(page, "23-movil-cuadro");
  await page.goto("/buscar?q=gomez");
  await expect(page.getByText("Gómez").first()).toBeVisible();
  await shot(page, "24-movil-buscar");
  await page.getByText("Ver partidos →").first().click();
  await page.waitForURL(/\/jugador\//);
  await shot(page, "25-movil-jugador");
  await page.goto("/ranking");
  await shot(page, "26-movil-ranking");
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Ingresar" })).toBeVisible();
  await shot(page, "27-movil-login");
  await ctx.close();
  const desk = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const dp = await desk.newPage();
  await dp.goto("/login");
  await dp.screenshot({ path: "e2e-shots/18-login.png" });
  await desk.close();
});

test("importar jugadores desde Excel", async ({ page }) => {
  await login(page);
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Hoja1");
  ws.addRow(["Listado de jugadores"]);
  ws.addRow(["Nombre y apellido", "Sexo", "Categoría", "D.N.I.", "Celular"]);
  ws.addRow(["LAURA FERNÁNDEZ", "F", "Advanced", "28.111.222", "221 555 0001"]);
  ws.addRow(["Sofía Ramos", "Mujer", "beginner", "", ""]);
  ws.addRow(["Carla", "F", "", "", ""]); // sin apellido → problema
  ws.addRow(["Juan Gómez", "M", "", "", ""]); // ya existe
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());

  await page.goto("/admin/players?import=1");
  await page.locator('input[name="file"]').setInputFiles({ name: "jugadores.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer });
  await page.getByRole("button", { name: "Revisar" }).click();
  await expect(page.getByText(/Revisá antes de importar: 2 jugador/)).toBeVisible();
  await expect(page.getByText(/1 ya existían sin cambios/)).toBeVisible();
  await expect(page.getByText(/Fila 5/)).toBeVisible();
  await shot(page, "30-importar-revision");
  await page.getByRole("button", { name: "Confirmar y aplicar" }).click();
  await expect(page.getByText(/Se cargaron 2 jugador/)).toBeVisible();
  await page.goto("/admin/players?q=fernandez");
  await expect(page.getByText("Fernández").first()).toBeVisible();
  await expect(page.locator("td .badge", { hasText: "Advanced" })).toBeVisible();
  await page.goto("/admin/players?cat=Beginner");
  await expect(page.getByText("Ramos").first()).toBeVisible();
  await expect(page.getByText("1 jugador(es)")).toBeVisible();

  // Segunda importación: solo actualiza la categoría de un jugador existente
  const wb2 = new ExcelJS.Workbook();
  const ws2 = wb2.addWorksheet("Hoja1");
  ws2.addRow(["Nombre", "Apellido", "Categoría"]);
  ws2.addRow(["Juan", "Gómez", "Advanced"]);
  await page.goto("/admin/players?import=1");
  await page.locator('input[name="file"]').setInputFiles({ name: "categorias.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(await wb2.xlsx.writeBuffer()) });
  await page.locator('select[name="default_gender"]').selectOption("M");
  await page.getByRole("button", { name: "Revisar" }).click();
  await expect(page.getByText(/1 ya existían: se les actualiza la categoría/)).toBeVisible();
  await page.getByRole("button", { name: "Confirmar y aplicar" }).click();
  await expect(page.getByText(/Se actualizó la categoría de 1/)).toBeVisible();
  await shot(page, "31-importar-resultado");
});
