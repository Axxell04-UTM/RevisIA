# Entregas de prueba — F2

Generado por `pnpm fixtures:f2` (script: `scripts/generar-entregas-prueba.ts`).
No editar a mano: se regenera y se sobrescribe.

## Cómo usarlo

1. Importá `padron.csv` en la materia (Roster → Importar CSV).
2. Entrá a una actividad abierta y subí `entregas-moodle.zip` (contexto ZIP de entregas).
3. En la tabla de revisión verificá el matching y probá el botón **Metadatos**.

## Escenarios incluidos

- `Gomez_Ana_12345.pdf` — Individual con nombre en el encabezado y coincidencia exacta con el padrón.
- `Perez_Juan_12346.pdf` — Nombre en mayúsculas: el matching debe ignorar mayúsculas y acentos.
- `Diaz_Luis_12347.pdf` — Nombre invertido con coma ("Apellido, Nombre"), como suele venir del padrón.
- `Rodriguez_Maria_12348.pdf` — Encabezado SIN nombre: la extracción debe devolver nombre vacío y el sistema cae al nombre del archivo.
- `Fernandez_Sofia_12349.pdf` — Trabajo grupal: tres integrantes en una sola entrega (uno de ellos fuera del padrón).
- `Silva_Mateo_12350.pdf` — Individual normal; también figura como integrante del trabajo grupal anterior.
- `Rossi_Valentina_12351.docx` — DOCX: cubre el segundo formato soportado y la extracción con mammoth.
- `Lopez_Pedro_12352.pdf` — Nombre válido pero AUSENTE del padrón: debe quedar "sin match" y poder vincularse a mano.
- `Martinez_Carla.pdf` — Nombre de archivo SIN id numérico: el parser debe devolver nombre y externalId nulo.
- `Sosa_Diego_12354.pdf` — Encabezado con ruido (materia repetida + título largo): ni la materia ni la comisión deben tomarse como título.

## Qué mirar

- **Matching**: 8 de las 10 deberían vincularse solas con el padrón; Pedro López debe
  quedar "sin match" y poder vincularse/desvincularse a mano.
- **Grupo**: el PDF de Sofía Fernández debe quedar como entrega grupal con 3 integrantes;
  Valentina Rossi figura como integrante sin estar vinculada al padrón.
- **Metadatos**: en el archivo sin nombre (`Rodriguez_Maria_12348.pdf`) la sugerencia no
  debe inventar un nombre; en el caso con ruido (`Sosa_Diego_12354.pdf`) el título no
  debe ser la materia ni la comisión.
- **DOCX**: `Rossi_Valentina_12351.docx` prueba el camino de mammoth.

`padron.csv` incluye a Lucía Benítez, que no entrega nada, y omite a Pedro López.
