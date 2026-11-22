# Entrega del curso — RevisIA

Documento y diagramas del proyecto para la asignatura **Tecnologías Avanzadas
Empresariales apoyadas por IA**.

## Contenido

| Archivo | Qué es |
|---|---|
| `Documento-RevisIA.md` | Documento completo con las siete secciones exigidas: Introducción, Objetivos, Arquitectura, Procesos, Tecnologías, Codificación y Manual de usuario |
| `bpm/01-ingesta-entregas.bpmn` | BPMN 2.0 — P1, ingesta de entregas desde Moodle |
| `bpm/02-calificacion-rubrica.bpmn` | BPMN 2.0 — P2, calificación individual y masiva |
| `bpm/03-administracion.bpmn` | BPMN 2.0 — P3, administración de docentes, asignaturas y claves |

El Markdown es la fuente; el `.docx` o `.pdf` que se entrega se genera a partir de él.

## Cómo generar el documento

**Opción A — Typora / Obsidian.** Abrir `Documento-RevisIA.md` y exportar a PDF o
Word desde el menú. Los diagramas Mermaid se renderizan solos.

**Opción B — Pandoc.**

```bash
pandoc Documento-RevisIA.md -o Documento-RevisIA.docx
pandoc Documento-RevisIA.md -o Documento-RevisIA.pdf --pdf-engine=xelatex -V geometry:margin=2.5cm
```

Pandoc no renderiza Mermaid por sí solo. Si el PDF sale con los bloques de diagrama
como código, exportar cada figura desde [mermaid.live](https://mermaid.live) como PNG
y reemplazar el bloque por la imagen antes de generar el PDF.

**Opción C — Word directo.** Copiar el contenido renderizado (VS Code con la extensión
de Markdown, o GitHub) y pegarlo en Word; las tablas y encabezados conservan formato.

## Cómo exportar los diagramas BPMN

1. Abrir [demo.bpmn.io](https://demo.bpmn.io).
2. *File → Open File* y seleccionar el `.bpmn`.
3. *File → Save as image* y elegir **SVG** (mejor calidad para Word) o **PNG**.
4. Insertar la imagen en la sección 4 del documento.

Los tres archivos están validados: etiquetas balanceadas, identificadores únicos,
todas las referencias resueltas y una forma o conexión de diagrama por cada elemento.

También se pueden abrir y editar con Camunda Modeler o el VS Code BPMN Editor.
