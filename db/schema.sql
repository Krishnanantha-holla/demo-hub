--
-- PostgreSQL database dump
--

\restrict pvhIU1maOzNQEAEZTPULuNi2wG1yzhfdrYcOtzPdJsZTeofHN0d9feJZkN6h84r

-- Dumped from database version 18.3 (Ubuntu 18.3-1.pgdg24.04+1)
-- Dumped by pg_dump version 18.3 (Ubuntu 18.3-1.pgdg24.04+1)

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
-- Name: public; Type: SCHEMA; Schema: -; Owner: userr
--

-- *not* creating schema, since initdb creates it


ALTER SCHEMA public OWNER TO userr;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: departments; Type: TABLE; Schema: public; Owner: userr
--

CREATE TABLE public.departments (
    id bigint NOT NULL,
    name character varying(150) NOT NULL,
    short_code character varying(20),
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.departments OWNER TO userr;

--
-- Name: departments_id_seq; Type: SEQUENCE; Schema: public; Owner: userr
--

CREATE SEQUENCE public.departments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.departments_id_seq OWNER TO userr;

--
-- Name: departments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: userr
--

ALTER SEQUENCE public.departments_id_seq OWNED BY public.departments.id;


--
-- Name: modules; Type: TABLE; Schema: public; Owner: userr
--

CREATE TABLE public.modules (
    id bigint NOT NULL,
    subject_id bigint NOT NULL,
    module_number integer NOT NULL,
    module_title character varying(150) NOT NULL,
    description text,
    created_at timestamp without time zone DEFAULT now(),
    CONSTRAINT check_module_limit CHECK (((module_number >= 1) AND (module_number <= 5)))
);


ALTER TABLE public.modules OWNER TO userr;

--
-- Name: modules_id_seq; Type: SEQUENCE; Schema: public; Owner: userr
--

CREATE SEQUENCE public.modules_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.modules_id_seq OWNER TO userr;

--
-- Name: modules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: userr
--

ALTER SEQUENCE public.modules_id_seq OWNED BY public.modules.id;


--
-- Name: semesters; Type: TABLE; Schema: public; Owner: userr
--

CREATE TABLE public.semesters (
    id bigint NOT NULL,
    semester_number integer NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.semesters OWNER TO userr;

--
-- Name: semesters_id_seq; Type: SEQUENCE; Schema: public; Owner: userr
--

CREATE SEQUENCE public.semesters_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.semesters_id_seq OWNER TO userr;

--
-- Name: semesters_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: userr
--

ALTER SEQUENCE public.semesters_id_seq OWNED BY public.semesters.id;


--
-- Name: subjects; Type: TABLE; Schema: public; Owner: userr
--

CREATE TABLE public.subjects (
    id bigint NOT NULL,
    department_id bigint NOT NULL,
    semester_id bigint NOT NULL,
    subject_code character varying(20) NOT NULL,
    subject_name character varying(150) NOT NULL,
    credits integer DEFAULT 4,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.subjects OWNER TO userr;

--
-- Name: subjects_id_seq; Type: SEQUENCE; Schema: public; Owner: userr
--

CREATE SEQUENCE public.subjects_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.subjects_id_seq OWNER TO userr;

--
-- Name: subjects_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: userr
--

ALTER SEQUENCE public.subjects_id_seq OWNED BY public.subjects.id;


--
-- Name: topics; Type: TABLE; Schema: public; Owner: userr
--

CREATE TABLE public.topics (
    id bigint NOT NULL,
    module_id bigint NOT NULL,
    topic_name character varying(200) NOT NULL,
    description text,
    order_num integer DEFAULT 1,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.topics OWNER TO userr;

--
-- Name: topics_id_seq; Type: SEQUENCE; Schema: public; Owner: userr
--

CREATE SEQUENCE public.topics_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.topics_id_seq OWNER TO userr;

--
-- Name: topics_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: userr
--

ALTER SEQUENCE public.topics_id_seq OWNED BY public.topics.id;


--
-- Name: departments id; Type: DEFAULT; Schema: public; Owner: userr
--

ALTER TABLE ONLY public.departments ALTER COLUMN id SET DEFAULT nextval('public.departments_id_seq'::regclass);


--
-- Name: modules id; Type: DEFAULT; Schema: public; Owner: userr
--

ALTER TABLE ONLY public.modules ALTER COLUMN id SET DEFAULT nextval('public.modules_id_seq'::regclass);


--
-- Name: semesters id; Type: DEFAULT; Schema: public; Owner: userr
--

ALTER TABLE ONLY public.semesters ALTER COLUMN id SET DEFAULT nextval('public.semesters_id_seq'::regclass);


--
-- Name: subjects id; Type: DEFAULT; Schema: public; Owner: userr
--

ALTER TABLE ONLY public.subjects ALTER COLUMN id SET DEFAULT nextval('public.subjects_id_seq'::regclass);


--
-- Name: topics id; Type: DEFAULT; Schema: public; Owner: userr
--

ALTER TABLE ONLY public.topics ALTER COLUMN id SET DEFAULT nextval('public.topics_id_seq'::regclass);


--
-- Name: departments departments_pkey; Type: CONSTRAINT; Schema: public; Owner: userr
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT departments_pkey PRIMARY KEY (id);


--
-- Name: departments departments_short_code_key; Type: CONSTRAINT; Schema: public; Owner: userr
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT departments_short_code_key UNIQUE (short_code);


--
-- Name: modules modules_pkey; Type: CONSTRAINT; Schema: public; Owner: userr
--

ALTER TABLE ONLY public.modules
    ADD CONSTRAINT modules_pkey PRIMARY KEY (id);


--
-- Name: semesters semesters_pkey; Type: CONSTRAINT; Schema: public; Owner: userr
--

ALTER TABLE ONLY public.semesters
    ADD CONSTRAINT semesters_pkey PRIMARY KEY (id);


--
-- Name: semesters semesters_semester_number_key; Type: CONSTRAINT; Schema: public; Owner: userr
--

ALTER TABLE ONLY public.semesters
    ADD CONSTRAINT semesters_semester_number_key UNIQUE (semester_number);


--
-- Name: subjects subjects_pkey; Type: CONSTRAINT; Schema: public; Owner: userr
--

ALTER TABLE ONLY public.subjects
    ADD CONSTRAINT subjects_pkey PRIMARY KEY (id);


--
-- Name: topics topics_pkey; Type: CONSTRAINT; Schema: public; Owner: userr
--

ALTER TABLE ONLY public.topics
    ADD CONSTRAINT topics_pkey PRIMARY KEY (id);


--
-- Name: subjects unique_subject_entry; Type: CONSTRAINT; Schema: public; Owner: userr
--

ALTER TABLE ONLY public.subjects
    ADD CONSTRAINT unique_subject_entry UNIQUE (department_id, semester_id, subject_code);


--
-- Name: idx_module_lookup; Type: INDEX; Schema: public; Owner: userr
--

CREATE INDEX idx_module_lookup ON public.modules USING btree (subject_id);


--
-- Name: idx_subject_lookup; Type: INDEX; Schema: public; Owner: userr
--

CREATE INDEX idx_subject_lookup ON public.subjects USING btree (department_id, semester_id);


--
-- Name: idx_topic_lookup; Type: INDEX; Schema: public; Owner: userr
--

CREATE INDEX idx_topic_lookup ON public.topics USING btree (module_id);


--
-- Name: modules modules_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: userr
--

ALTER TABLE ONLY public.modules
    ADD CONSTRAINT modules_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.subjects(id) ON DELETE CASCADE;


--
-- Name: subjects subjects_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: userr
--

ALTER TABLE ONLY public.subjects
    ADD CONSTRAINT subjects_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id) ON DELETE CASCADE;


--
-- Name: subjects subjects_semester_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: userr
--

ALTER TABLE ONLY public.subjects
    ADD CONSTRAINT subjects_semester_id_fkey FOREIGN KEY (semester_id) REFERENCES public.semesters(id) ON DELETE CASCADE;


--
-- Name: topics topics_module_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: userr
--

ALTER TABLE ONLY public.topics
    ADD CONSTRAINT topics_module_id_fkey FOREIGN KEY (module_id) REFERENCES public.modules(id) ON DELETE CASCADE;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO userr;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO userr;


--
-- PostgreSQL database dump complete
--

\unrestrict pvhIU1maOzNQEAEZTPULuNi2wG1yzhfdrYcOtzPdJsZTeofHN0d9feJZkN6h84r

