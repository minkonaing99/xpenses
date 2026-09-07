-- Apply manually before deploying Plans code.
CREATE TABLE planned_purchases (
  id                       CHAR(36)     NOT NULL,
  name                     VARCHAR(255) NOT NULL,
  amount                   BIGINT       NOT NULL,
  account_id               CHAR(36)     NOT NULL,
  category_id              CHAR(36)     NOT NULL,
  planned_date             DATE         NOT NULL,
  wait_days                TINYINT UNSIGNED NOT NULL DEFAULT 7,
  wait_until               DATE         NOT NULL,
  status                   VARCHAR(16)  NOT NULL DEFAULT 'planned',
  confirmed_transaction_id CHAR(36)     NULL,
  created_at               DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at               DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_plan_confirmed_transaction (confirmed_transaction_id),
  KEY idx_plan_status_date (status, planned_date),
  KEY idx_plan_account_status (account_id, status),
  KEY idx_plan_category_status (category_id, status),
  CONSTRAINT fk_plan_account FOREIGN KEY (account_id) REFERENCES accounts (id),
  CONSTRAINT fk_plan_category FOREIGN KEY (category_id) REFERENCES categories (id),
  CONSTRAINT fk_plan_transaction FOREIGN KEY (confirmed_transaction_id) REFERENCES transactions (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Add purchase reflections to existing Plans installations.
ALTER TABLE planned_purchases
  ADD COLUMN reflection VARCHAR(16) NULL,
  ADD COLUMN reflection_note VARCHAR(255) NULL;
