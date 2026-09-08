CREATE TABLE savings_pots (
  id            CHAR(36)     NOT NULL,
  name          VARCHAR(80)  NOT NULL,
  target_amount BIGINT       NOT NULL,
  account_id    CHAR(36)     NOT NULL,
  archived_at   DATETIME     NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_pot_account_archive (account_id, archived_at),
  KEY idx_pot_archive_created (archived_at, created_at),
  CONSTRAINT fk_pot_account FOREIGN KEY (account_id) REFERENCES accounts (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE savings_pot_movements (
  id         CHAR(36)     NOT NULL,
  pot_id     CHAR(36)     NOT NULL,
  type       VARCHAR(16)  NOT NULL,
  amount     BIGINT       NOT NULL,
  note       VARCHAR(255) NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_pot_movement_history (pot_id, created_at),
  CONSTRAINT fk_pot_movement_pot FOREIGN KEY (pot_id) REFERENCES savings_pots (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE savings_pot_purchases (
  transaction_id CHAR(36) NOT NULL,
  pot_id         CHAR(36) NOT NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (transaction_id),
  KEY idx_pot_purchase_history (pot_id, created_at),
  CONSTRAINT fk_pot_purchase_transaction FOREIGN KEY (transaction_id) REFERENCES transactions (id),
  CONSTRAINT fk_pot_purchase_pot FOREIGN KEY (pot_id) REFERENCES savings_pots (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
