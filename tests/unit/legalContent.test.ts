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

test("all public legal pages are verified and versioned", () => {
  assert.match(source, /"aviso-legal": \{[\s\S]*?verificationStatus: "verified"/);
  assert.match(source, /privacidad: \{[\s\S]*?verificationStatus: "verified"/);
  assert.match(source, /cookies: \{[\s\S]*?verificationStatus: "verified"/);
  assert.match(source, /Versión vigente/);
});

test("privacy and cookie decisions are explicit and conservative", () => {
  assert.match(source, /medidas precontractuales/);
  assert.match(source, /artículo 21\.2 LSSI/);
  assert.match(source, /Eventos analíticos seudónimos: 90 días/);
  assert.match(source, /No se ha designado un delegado de protección de datos/);
  assert.match(source, /24 meses o hasta cambio de política/);
  assert.match(source, /Aceptar, rechazar o retirar/);
});
