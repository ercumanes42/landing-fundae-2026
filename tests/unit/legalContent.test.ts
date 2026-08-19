import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../../src/components/legal/LegalPage.tsx", import.meta.url), "utf8");

test("legal page source is valid text and contains the verified public identity", () => {
  assert.equal(source.includes("\u0000"), false);
  assert.match(source, /Gestión de Formación y Selección, S\.L\./);
  assert.match(source, /B13306428/);
  assert.match(source, /Paseo de la Castellana, 141, 28046 Madrid/);
  assert.match(source, /tomo 30\.635, folio 159, sección 8, hoja M-551314/);
  assert.match(source, /administracion@gfs\.es/);
});

test("the legal notice is verified without promoting privacy or cookies", () => {
  assert.match(source, /"aviso-legal": \{[\s\S]*?verificationStatus: "verified"/);
  assert.match(source, /privacidad: \{[\s\S]*?verificationStatus: "draft"/);
  assert.match(source, /cookies: \{[\s\S]*?verificationStatus: "draft"/);
  assert.match(source, /Contenido contrastado con fuentes públicas/);
  assert.match(source, /Versión operativa no definitiva/);
});

test("unverified legal details remain explicit instead of being invented", () => {
  assert.match(source, /bases jurídicas por finalidad/);
  assert.match(source, /plazos de conservación/);
  assert.match(source, /inventario efectivo de encargados y transferencias/);
  assert.match(source, /delegado de protección de datos/);
  assert.match(source, /inventario de cookies y almacenamiento/);
  assert.doesNotMatch(source, /Google Analytics|LinkedIn Insight|Delegado de Protección de Datos:/);
});
