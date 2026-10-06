import type { Knex } from 'knex';

export const name = '20260101000000_create_tasks_table';

/**
 * Written as plain SQL on purpose: it is exactly the schema documented in CLAUDE.md, ENUMs
 * included, which the knex schema builder cannot express 1:1 (it adds nullability and
 * charset details).
 */
export const up = async (knex: Knex): Promise<void> => {
  await knex.raw(`
    CREATE TABLE tasks (
      id VARCHAR(36) PRIMARY KEY,
      type ENUM('email_notification','report_generation','data_sync','certificate_generation') NOT NULL,
      payload JSON NOT NULL,
      status ENUM('pending','processing','completed','failed') NOT NULL DEFAULT 'pending',
      attempts INT NOT NULL DEFAULT 0,
      result TEXT NULL,
      error TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      processed_at TIMESTAMP NULL,
      INDEX idx_status (status),
      INDEX idx_type (type)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);
};

export const down = async (knex: Knex): Promise<void> => {
  await knex.schema.dropTableIfExists('tasks');
};
