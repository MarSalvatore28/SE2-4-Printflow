-- PrintFlow: catalogos base (roles, tipos de impresion/formato, tipos de notificacion).
-- Sin areas ni clientes: los datos de prueba van en un seed sintetico aparte.
--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.11 (Debian 17.11-1.pgdg12+2)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;



--
-- Data for Name: roles; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.roles (id_rol, nombre, descripcion) FROM stdin;
1	admin	Administrador Total
2	operador	Carga y validación
3	auditor	Solo lectura
\.


--
-- Data for Name: tipos_formato_impresion; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.tipos_formato_impresion (id_formato, nombre, activo) FROM stdin;
2	A4	t
\.


--
-- Data for Name: tipos_impresion; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.tipos_impresion (id_tipo_impresion, nombre, activo) FROM stdin;
4	BN	t
3	Color	t
\.


--
-- Data for Name: tipos_notificacion; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.tipos_notificacion (id_tipo_notificacion, codigo, nombre, descripcion, activo, fecha_creacion) FROM stdin;
1	NUEVO_LOTE	Nuevo Lote Cargado	Se ha cargado un nuevo lote desde n8n	t	2026-02-02 17:24:22.678499+00
2	VALIDACION_PENDIENTE	Validación Pendiente	Hay lotes esperando aprobación	t	2026-02-02 17:24:22.678499+00
3	ERROR_CARGA	Error en Carga	Falló la inserción de datos en staging	t	2026-02-02 17:24:22.678499+00
4	CAMBIO_MAQUINA	Cambio de Máquina	Se registró un reemplazo de equipo	t	2026-02-02 17:24:22.678499+00
5	REPORTE_GENERADO	Reporte Oficial Generado	Datos congelados en reportes oficiales	t	2026-02-02 17:24:22.678499+00
6	INCONSISTENCIA_DETALLE	Inconsistencia Detectada	Diferencia entre consolidado y detalle	t	2026-02-02 17:24:22.678499+00
7	LOTE_PENDIENTE	Lote Pendiente	\N	t	2026-02-03 15:16:38.10405+00
\.


--
-- Name: areas_id_area_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--



--
-- Name: roles_id_rol_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.roles_id_rol_seq', 3, true);


--
-- Name: tipos_formato_impresion_id_formato_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.tipos_formato_impresion_id_formato_seq', 5, true);


--
-- Name: tipos_impresion_id_tipo_impresion_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.tipos_impresion_id_tipo_impresion_seq', 5, true);


--
-- Name: tipos_notificacion_id_tipo_notificacion_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.tipos_notificacion_id_tipo_notificacion_seq', 7, true);


--
-- PostgreSQL database dump complete
--


