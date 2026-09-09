-- Consumer storefront metadata and listing controls.
PRAGMA foreign_keys = ON;

ALTER TABLE games
ADD COLUMN listed INTEGER NOT NULL DEFAULT 1 CHECK (listed IN (0, 1));

ALTER TABLE games
ADD COLUMN description TEXT;

CREATE INDEX idx_games_storefront
ON games(listed, owner_id, active_release);
