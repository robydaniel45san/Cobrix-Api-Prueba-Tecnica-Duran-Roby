/**
 * Cobrix schema. Idempotent (`IF NOT EXISTS`): it runs on every start.
 *
 * Idempotency of the sync lives here too: one customer per normalized identification, one
 * invoice per installment (`external_id`), and at most one run in progress.
 */

export const SCHEMA = /* sql */ `
CREATE TABLE IF NOT EXISTS company (
	id               int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
	name             text NOT NULL DEFAULT '',
	rif              text NOT NULL DEFAULT '',
	collections_email text NOT NULL DEFAULT '',
	updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS provider (
	id                     int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
	-- The company whose customers this invoice manager holds.
	company_id             int NOT NULL DEFAULT 1 REFERENCES company (id),
	name                   text NOT NULL DEFAULT 'Administrador de facturas',
	base_url               text NOT NULL DEFAULT '',
	username               text NOT NULL DEFAULT '',
	-- AES-256-GCM, never returned by the API (see secret.ts).
	password_encrypted     text NOT NULL DEFAULT '',
	importable_statuses    text[] NOT NULL DEFAULT ARRAY['ACTIVO', 'CORTADO'],
	window_months          int CHECK (window_months IN (3, 6, 9, 12)),
	max_recent_per_contract int CHECK (max_recent_per_contract BETWEEN 1 AND 60),
	grace_days             int NOT NULL DEFAULT 0 CHECK (grace_days BETWEEN 0 AND 60),
	ledger_months          int NOT NULL DEFAULT 7 CHECK (ledger_months BETWEEN 1 AND 12),
	max_new_invoices       int CHECK (max_new_invoices >= 1),
	max_new_amount         numeric(14, 2) CHECK (max_new_amount > 0),
	excluded_document_types text[] NOT NULL DEFAULT '{}',
	auto_enabled           boolean NOT NULL DEFAULT false,
	auto_time              text CHECK (auto_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
	auto_last_date         date,
	updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS run (
	id          serial PRIMARY KEY,
	-- The invoice manager the run talked to.
	provider_id int NOT NULL DEFAULT 1 REFERENCES provider (id),
	kind        text NOT NULL CHECK (kind IN ('import', 'paid')),
	dry_run     boolean NOT NULL,
	trigger     text NOT NULL DEFAULT 'manual' CHECK (trigger IN ('manual', 'auto')),
	status      text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
	started_at  timestamptz NOT NULL DEFAULT now(),
	finished_at timestamptz,
	counters    jsonb NOT NULL DEFAULT '{}',
	-- Contracts whose lookup failed: the run completed, but not over everything.
	warnings    int NOT NULL DEFAULT 0,
	error       text
);
CREATE UNIQUE INDEX IF NOT EXISTS run_one_in_progress ON run ((true)) WHERE status = 'running';

CREATE TABLE IF NOT EXISTS customer (
	id             text PRIMARY KEY,
	document       text NOT NULL,
	document_type  text,
	person_type    text NOT NULL CHECK (person_type IN ('natural', 'juridica')),
	name           text NOT NULL,
	email          text,
	phone          text,
	source_contract_id int NOT NULL,
	created_run_id int NOT NULL REFERENCES run (id),
	created_at     timestamptz NOT NULL DEFAULT now(),
	updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contract (
	id          int PRIMARY KEY,
	customer_id text NOT NULL REFERENCES customer (id),
	code        text NOT NULL,
	status      text NOT NULL,
	plan        text NOT NULL,
	plan_price  numeric(14, 2) NOT NULL,
	currency    text NOT NULL,
	branch      text NOT NULL,
	address     text,
	updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invoice (
	id            serial PRIMARY KEY,
	number        text NOT NULL UNIQUE,
	external_id   text NOT NULL UNIQUE,
	customer_id   text NOT NULL REFERENCES customer (id),
	contract_id   int NOT NULL REFERENCES contract (id),
	label         text NOT NULL,
	period        text NOT NULL,
	due_date      date NOT NULL,
	cutoff_date   date NOT NULL,
	total         numeric(14, 2) NOT NULL CHECK (total > 0),
	balance       numeric(14, 2) NOT NULL CHECK (balance >= 0),
	currency      text NOT NULL,
	status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid')),
	paid_on       date,
	paid_by_invoice text,
	-- Last balance the ISP reported when it differed from Cobrix (partial payment).
	isp_balance   numeric(14, 2),
	imported_run_id int NOT NULL REFERENCES run (id),
	paid_run_id   int REFERENCES run (id),
	created_at    timestamptz NOT NULL DEFAULT now(),
	CHECK ((status = 'paid') = (paid_on IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS invoice_customer ON invoice (customer_id);
CREATE INDEX IF NOT EXISTS invoice_open ON invoice (contract_id) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS run_item (
	id           serial PRIMARY KEY,
	run_id       int NOT NULL REFERENCES run (id) ON DELETE CASCADE,
	position     int NOT NULL,
	contract_id  int,
	external_id  text,
	customer_id  text,
	customer_name text,
	result       text NOT NULL,
	detail       text NOT NULL DEFAULT '',
	label        text,
	amount       numeric(14, 2)
);
CREATE INDEX IF NOT EXISTS run_item_run ON run_item (run_id, position);

CREATE TABLE IF NOT EXISTS event (
	id          serial PRIMARY KEY,
	customer_id text NOT NULL REFERENCES customer (id),
	invoice_id  int REFERENCES invoice (id),
	kind        text NOT NULL CHECK (kind IN ('customer_created', 'invoice_imported', 'invoice_paid')),
	run_id      int NOT NULL REFERENCES run (id),
	detail      text NOT NULL,
	at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS event_customer ON event (customer_id, at DESC, id DESC);

INSERT INTO company (id) VALUES (1) ON CONFLICT DO NOTHING;
INSERT INTO provider (id) VALUES (1) ON CONFLICT DO NOTHING;
`
