# Tareas de Kiara · Equipo A (QA)

Tus tareas de la Fase 0 ya están en `main`: CODEOWNERS en los dos repos, la API con 404 en JSON y validación del `.env`, los tests de la API y el job `smoke` del CI. Ahora te toca el **Excel** (S4-02), seguir como **QA de los PR de todos** y el **guion de la demo**. El aviso por correo (S3-03) ya lo hizo Marlo (`docs/avisos-por-correo.md`). Nada depende de otra persona.

> **Necesitamos dejar esto listo ya. Lo hacemos ahora, empezando por la tarea 1.** No hay fecha de entrega: es urgente para el medio parcial.
> **No dependes de nadie y nadie depende de ti:**
> - en el Excel solo tocas sus funciones (el PDF lo trabaja otra persona en el mismo archivo);
> - la facturación, si todavía no llega del backend, se muestra como «Importe pendiente de cálculo».
> Una tarea está **terminada** solo cuando tiene tus commits, un PR a `develop` con «Cómo probarlo», el CI en verde y capturas o la salida de las pruebas.

| # | Tarea | Puntos | Rama |
|---|---|---|---|
| 1 | **S4-02 · Excel del consolidado** | 2 | `feature/f4-excel` |
| 2 | **QA de cada PR** de Samuel, Christian, Roberto, Gabriela y Marlo | — | — |
| 3 | Guion de la demo para el sponsor | 1 | — |

Tus migraciones, si las necesitas, van de `040` a `049`.

---

## 1. S4-02 · Excel del consolidado

La exportación está en `src/utils/exportUtils.ts` (repo **frontend**). **El PDF lo trabaja Marlo en el mismo archivo:** tú tocas solo las funciones del Excel y ella solo las del PDF.
- **Columnas numéricas como número,** no como texto: contadores, páginas e importes. Así se pueden sumar en Excel. Los importes, con formato de 2 decimales.
- **Cabecera** con cliente, RUC, período y fecha de generación. Una hoja por consolidado y, si hay detalle por usuario, otra hoja.
- **Facturación:** cuando Christian termine S3-06, la tabla de facturación (`resumen.facturacion`). Antes, una fila «Importe pendiente de cálculo».
- **Valores idénticos a la pantalla:** 2 clientes, 2 períodos y el de noviembre con reemplazo. Compara y deja capturas en el PR.

## 2. QA de cada PR

Eres la revisora. En cada PR de tus compañeros:
1. Bájalo (`git fetch` y `git checkout <rama>`), levanta Docker con datos del simulador y prueba lo que dice en «Cómo probarlo».
2. Con los **3 usuarios** (admin, operador y auditor): que cada uno vea y pueda hacer lo que le toca, sin errores en la consola del navegador (F12).
3. Que el CI esté en verde (`test`, `docker` y `smoke`).
4. Deja un comentario con lo que probaste. **Aprueba solo lo que probaste.** Si algo falla, escribe los pasos para repetirlo.

## 3. Guion de la demo para el sponsor

Una hoja con el recorrido de 10 minutos, para el grupo y no para el repo:
1. Login con los 3 roles: cada uno ve un menú distinto.
2. Clientes, contratos y máquinas.
3. Simulación del correo (`demo.js`): llegan los lotes, la campana suena y se aprueba uno.
4. Lote con máquina no autorizada: el motivo y por qué no se puede aprobar.
5. Informes del mes, con el reemplazo de noviembre.
6. El aviso por correo que recibe el operador (`buzon-salida/` o Mailpit, ver `docs/avisos-por-correo.md`).
