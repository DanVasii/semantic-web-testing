CREATE DATABASE IF NOT EXISTS semantic_fixture
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE semantic_fixture;

CREATE TABLE IF NOT EXISTS customers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email VARCHAR(254) NOT NULL,
  password_hash CHAR(64) NOT NULL,
  newsletter BOOLEAN NOT NULL DEFAULT FALSE,
  customer_plan ENUM('standard', 'premium') NOT NULL DEFAULT 'standard',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY customers_email_unique (email)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS appointments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id BIGINT UNSIGNED NOT NULL,
  service_code VARCHAR(64) NOT NULL,
  appointment_date DATE NULL,
  appointment_time TIME NULL,
  status ENUM('created', 'confirmed', 'cancelled') NOT NULL DEFAULT 'created',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT appointments_customer_fk
    FOREIGN KEY (customer_id) REFERENCES customers(id)
    ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS booking_slots (
  service_code VARCHAR(64) NOT NULL,
  appointment_date DATE NOT NULL,
  appointment_time TIME NOT NULL,
  available BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (service_code, appointment_date, appointment_time)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS appointment_events (
  appointment_id BIGINT UNSIGNED NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  event_payload_json LONGTEXT NOT NULL,
  event_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;

INSERT INTO booking_slots (
  service_code,
  appointment_date,
  appointment_time,
  available
) VALUES
  ('semantic', '2027-08-15', '09:00:00', TRUE),
  ('semantic', '2027-08-15', '10:30:00', TRUE),
  ('semantic', '2027-08-15', '12:00:00', TRUE)
ON DUPLICATE KEY UPDATE available = VALUES(available);
