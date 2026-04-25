-- EWACSPRO Bot - Supabase Schema
-- Jalankan di Supabase SQL Editor

CREATE TABLE units (
  unit_id    TEXT PRIMARY KEY,
  ip         TEXT,
  segmen     TEXT,
  asset_mu   TEXT,
  asset_gsab TEXT,
  tipe       TEXT,
  aktif      BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE daily_checks (
  id         BIGSERIAL PRIMARY KEY,
  unit_id    TEXT,
  lokasi     TEXT,
  asset_mu   TEXT,
  asset_gsab TEXT,
  shift      INT,
  tanggal    DATE,
  waktu      TIME,
  status     TEXT DEFAULT 'All OK',
  dicek_oleh TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE maintenance_checks (
  id         BIGSERIAL PRIMARY KEY,
  unit_id    TEXT,
  lokasi     TEXT,
  asset_mu   TEXT,
  asset_gsab TEXT,
  problem    TEXT,
  penyebab   TEXT,
  action     TEXT,
  status     TEXT,
  backlog    TEXT,
  shift      INT,
  tanggal    DATE,
  waktu      TIME,
  dicek_oleh TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_dc_tanggal_shift ON daily_checks(tanggal, shift);
CREATE INDEX idx_dc_unit ON daily_checks(unit_id);
CREATE INDEX idx_mc_unit ON maintenance_checks(unit_id);