# Communications · PrintFlow (T4)

Dated evidence of the team's interactions with the client, DOX S.A. The Product Owner is
Ing. Paul Alessandro Pin, representative of DOX S.A. and systems engineer.

Original documents are in Spanish; each entry has a short English description. Keep this index
updated in every sprint: add a row for each new meeting, e-mail or signed form, and put the file in
this folder with the date at the start of its name (`YYYY-MM-DD_...`).

## Index

| # | File | Description | Format | Participants | Date / time |
|---|---|---|---|---|---|
| 1 | [`../PLAN.md` §1.1](../PLAN.md#11-alcance-de-dónde-vienen-los-reportes-y-por-qué-usamos-datos-simulados) | PO requirements and scope: the system must register the printers' meter reports received by e-mail; development uses only the PO's test mailbox, test e-mails and fictitious machines, never DOX's production mailbox or n8n. | Markdown (work plan) | Ing. Paul Alessandro Pin (DOX S.A.); development team | Recorded on 2026-11-13 (work plan v2) |
| 2 | [`2026-11-22_demo_sprints_1_y_2/`](2026-11-22_demo_sprints_1_y_2/) | Sprint 1 and 2 review: virtual demo of the system deployed on Azure (login by role, clients, machines, contracts, assignments, automatic batch reception, failed-batch detail and blocked approval, Auditor read-only access). 12 screenshots taken during the meeting. | JPEG (12 files) | Ing. Paul Alessandro Pin (DOX S.A.); development team | 2026-11-22, screenshots shared at 19:49 |
| 3 | [`2026-11-22_aceptacion_sprints_1_y_2_firmada.pdf`](2026-11-22_aceptacion_sprints_1_y_2_firmada.pdf) | Acceptance forms for Sprint 1 (S1-01 to S1-06) and Sprint 2 (S2-01 to S2-06), signed by the Product Owner and by the Scrum Master. | PDF (4 pages) | Ing. Paul Alessandro Pin (DOX S.A.); Marlo Valle (Scrum Master) | 2026-11-22 |

## Screenshots of the 2026-11-22 demo

| File | What it shows | Story |
|---|---|---|
| `01_login.jpeg` | Login screen of the deployed system | S1-03 |
| `02_clientes.jpeg` | Client management and side menu (Administrator) | S1-04, S1-06 |
| `03_maquinas.jpeg` | Machine management: serial, model, type, assignment, IP, status | S1-05 |
| `04_rol_operador.jpeg` | Machines with the Operator role in read-only mode | S1-03 |
| `05_contrato.jpeg` | New contract form | S2-01 |
| `06_asignaciones.jpeg` | Machine assignments by area with rates | S2-02 |
| `07_notificacion_lote.jpeg` | New batch received automatically in Notifications | S2-03, S2-04, S2-05 |
| `08_detalle_lote.jpeg` | Failed batch: unregistered serial SIMX9999 marked as ERROR | S2-06 |
| `09_validacion.jpeg` | Batch validation listing the problems found | S2-06 |
| `10_no_aprueba.jpeg` | Approval blocked for an inconsistent batch | S2-06 |
| `11_rol_auditor.jpeg` | Auditor role: only the allowed modules | S1-03 |
| `12_auditor_consulta.jpeg` | Installations with the Auditor role in read-only mode | S1-03 |
