# Universidad Técnica de Manabí Facultad de Ciencias Informáticas **Carrera de Ingeniería en Desarrollo de Software** 



**Asignatura:** Tecnologías Avanzadas Empresariales apoyadas por IA **Docente:** Ing. Javier Cuzco Torres, PhD 

### **Uso de modelo entrenado para la evaluación de resúmenes utilizando un texto base de alguna temática y rubrica de evaluación** 

Realice una aplicación web que reciba contexto como, por ejemplo **:** Texto base o fuente de información de alguna temática; rúbrica de evaluación dinámica **,** con criterios como, por ejemplo: Estructura, ortografía, comprensión, redacción y síntesis, etc. junto con la descripción y valor o puntos de cada criterio; Adjuntar documentos tipo ensayo o resúmenes en formato PDF Y que retorne las respectivas **calificaciones y retroalimentación automática** por cada resumen según la rúbrica establecida para evaluar los resúmenes. 

Para lograr esto, se puede usar **un modelo generativo de lenguaje largo** como, por ejemplo: GPT, LLaMA o Mistral pre-entrenado o ajustado (fine-tuning) para analizar texto y generar una evaluación argumentada según criterios específicos. 

**Sin embargo,** debido a las limitaciones como, por ejemplo: Infraestructura, vamos a usar un modelo pre-entrenado. Estos modelos ya entienden el lenguaje natural por lo que debe diseñar un prompt estructurado que explique al modelo cómo evaluar (Prompt Engineering). Adicional, son ideales si no se tiene grandes volúmenes de datos. Ejemplos: **GPT de OpenAI** , **Claude de Anthropic** , **Gemini de Google** , **Mistral 7B** , **LLaMA** , etc. 

Utilice Microsoft Excel para exportar los resultados de las calificaciones cuyos respectivos registros deben contener: Nombre del estudiante o autor del resumen, Titulo del trabajo o tarea, calificación en cada criterio de la rúbrica utilizada. 

## **Rubrica de calificación:** 

|Nº|<sup>**Criterio**</sup>|**Excelente (5 ptos)**|**Bueno (1pto)**|**Deficiente (0 ptos)**|
|---|---|---|---|---|
|1|Importación de<br>actividades o<br>tareas desde<br>Moodle|Importa correctamente actividades/tareas<br>descargadas de Moodle, incluyendo<br>múltiples formatos (PDF Y ZIP)|Importa<br>correctamente la<br>mayoría de tareas|No permite<br>importar|
|2|Identificación<br>y organización<br>de estudiantes|La aplicación web a través del LLM,<br>identifica y relaciona correctamente el<br>nombre del estudiante (individual) o<br>integrantes(grupal), archivo, título de la<br>actividad en cada tarea descargada|No identifica todos<br>los elementos<br>correctamente|No existe|



|3<br>Gestión de contexto<br>académico|Permite<br>definir<br>contexto<br>completo:<br>Descripción<br>de<br>la<br>tarea,<br>objetivos,<br>instrucciones, Anexar un texto base o<br>documento fuente,etc.|<br> <br> <br>Permite la mayoría<br>de elementos|No permite<br>contexto|
|---|---|---|---|
|4<br>Evaluación<br>individual y masiva|Permite evaluar un trabajo de manera<br>individualyde manera masiva|Permite<br>evaluación<br>individual o masiva|Nopermite|
|5<br>Calificación<br>según rúbrica y<br>generación de<br>informes|Asigna puntuación a las tareas según los<br>criterios y valores de la rúbrica<br>establecida Y permite exportar los<br>resultados en formatos Excel|No califica según<br>los criterios de la<br>rúbrica establecida o<br>no permite exportar<br>los resultados en<br>formato Excel|<br>No cumple con<br>ninguna|
|6<br>Gestión de<br>administración|Existe un usuario administrador que<br>gestiona: Docentes, asignaturas, API<br>KEY, etc para que diversos docentes<br>puedan trabajar con la aplicación|Gestión limitada|No existe|
|**TOTAL**|30 (ptos)|6(ptos)|0 (ptos)|



Nota. El documento a enviar es para evidenciar el desarrollo del curso Y debe tener la siguiente estructura: 1. Introducción, 2. Objetivos, 3. Arquitectura, 4. Procesos (Utilizar diagramas BPM), 5. Tecnologías utilizadas, 6. Codificación Y 7. Manual de usuario. 

La revisión de las funcionalidades de la aplicación web, se realizará en el aula según un horario asignado. 

