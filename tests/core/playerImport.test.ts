import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePlayerSheet, detectField, splitFullName, parseGender, parsePlayerCategory } from "../../src/core/playerImport";

test("reconoce columnas típicas", () => {
  assert.equal(detectField("Apellido"), "last_name");
  assert.equal(detectField("NOMBRE"), "first_name");
  assert.equal(detectField("Nombre y Apellido"), "full_first");
  assert.equal(detectField("Apellido y nombre"), "full_last");
  assert.equal(detectField("D.N.I."), "document");
  assert.equal(detectField("DNI"), "document");
  assert.equal(detectField("Celular"), "phone");
  assert.equal(detectField("E-mail"), "email");
  assert.equal(detectField("Sexo"), "gender");
  assert.equal(detectField("Categoría"), "category");
  assert.equal(detectField("NIVEL"), "category");
});

test("separa nombre completo", () => {
  assert.deepEqual(splitFullName("Juan Pablo Pérez", false), { first: "Juan Pablo", last: "Pérez" });
  assert.deepEqual(splitFullName("Pérez Juan Pablo", true), { first: "Juan Pablo", last: "Pérez" });
  assert.deepEqual(splitFullName("Pérez, Juan", false), { first: "Juan", last: "Pérez" });
  assert.equal(splitFullName("Juan", false), null);
});

test("géneros", () => {
  assert.equal(parseGender("Masculino"), "M");
  assert.equal(parseGender("mujer"), "F");
  assert.equal(parseGender("H"), "M");
  assert.equal(parseGender("?"), null);
});

test("planilla con nombre y apellido separados, encabezado en la fila 2", () => {
  const r = parsePlayerSheet([
    ["Listado de jugadores 2026", "", "", ""],
    ["Nombre", "Apellido", "Sexo", "DNI"],
    ["JUAN", "PÉREZ", "M", "30.123.456"],
    ["ana", "lópez", "F", ""],
    ["", "", "", ""],
    ["Pedro", "", "M", ""],
    ["Juan", "Pérez", "M", "30123456"],
  ], null);
  assert.equal(r.headerRow, 2);
  assert.equal(r.players.length, 2);
  assert.deepEqual(r.players[0], { row: 3, first_name: "Juan", last_name: "Pérez", gender: "M", document: "30123456", phone: null, email: null, city: null, category: null });
  assert.equal(r.players[1].first_name, "Ana");
  assert.equal(r.issues.length, 2); // fila 6 sin apellido, fila 7 repetida
});

test("nombre completo y género por defecto", () => {
  const r = parsePlayerSheet([["Jugador", "Teléfono"], ["Martín Gómez", "11 5555-1234"], ["Diego Díaz", ""]], "M");
  assert.equal(r.players.length, 2);
  assert.equal(r.players[0].last_name, "Gómez");
  assert.equal(r.players[0].phone, "11 5555-1234");
});

test("sin columnas reconocibles", () => {
  const r = parsePlayerSheet([["a", "b"], ["1", "2"]], "M");
  assert.equal(r.players.length, 0);
  assert.equal(r.issues.length, 1);
});

test("columna de categoría", () => {
  const r = parsePlayerSheet([["Nombre", "Apellido", "Categoría"], ["Juan", "Pérez", " advanced "], ["Ana", "López", ""], ["Luis", "Paz", "Principiante"], ["Leo", "Sosa", "4ta"]], "M");
  assert.equal(r.players[0].category, "Advanced");
  assert.equal(r.players[1].category, null);
  assert.equal(r.players[2].category, "Beginner");
  assert.equal(r.players[3].category, null);
  assert.ok(r.issues.some((i) => i.row === 5 && /no reconocida/.test(i.message)));
  assert.ok(r.columns.includes("Categoría"));
});

test("sexo / género sin definir: celda vacía o «sin definir» → X", () => {
  const r = parsePlayerSheet([
    ["Nombre", "Apellido", "Sexo"],
    ["Lucía", "Gómez", ""],
    ["Mar", "Paz", "Sin definir"],
    ["Juan", "Ruiz", "M"],
  ], null);
  assert.equal(r.issues.length, 0);
  assert.deepEqual(r.players.map((p) => p.gender), ["X", "X", "M"]);
  const sinColumna = parsePlayerSheet([["Nombre", "Apellido"], ["Ana", "Sol"]], null);
  assert.equal(sinColumna.players[0].gender, "X");
});

test("categorías de 8va a 3ra", () => {
  assert.equal(parsePlayerCategory("8va"), "8va");
  assert.equal(parsePlayerCategory("7"), "7ma");
  assert.equal(parsePlayerCategory("6°"), "6ta");
  assert.equal(parsePlayerCategory("Quinta"), "5ta");
  assert.equal(parsePlayerCategory("4ta categoría"), "4ta");
  assert.equal(parsePlayerCategory("3RA"), "3ra");
  assert.equal(parsePlayerCategory("Advanced"), "Advanced");
  assert.equal(parsePlayerCategory("9na"), null);
});
