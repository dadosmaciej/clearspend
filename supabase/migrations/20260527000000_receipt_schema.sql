-- =============================================================================
-- ClearSpend: Receipt Data Schema  (F-01)
-- Execution order: extension → tables → indexes → trigger → RLS → storage
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Extensions
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS vector;

-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------

CREATE TABLE receipts (
  id                uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id           uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shop_name         text,
  purchase_date     date,
  total_amount      numeric(10, 2),
  processing_status text        NOT NULL DEFAULT 'pending'
                                CONSTRAINT receipts_processing_status_check
                                  CHECK (processing_status IN ('pending', 'processing', 'done', 'failed')),
  image_path        text        NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE line_items (
  id          uuid           NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  receipt_id  uuid           NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  name        text           NOT NULL,
  price       numeric(10, 2) NOT NULL,
  category    text,
  position    integer        NOT NULL DEFAULT 0,
  created_at  timestamptz    NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 3. Indexes
-- ---------------------------------------------------------------------------

CREATE INDEX receipts_user_id_idx             ON receipts (user_id);
CREATE INDEX receipts_user_id_purchase_date_idx ON receipts (user_id, purchase_date DESC);
CREATE INDEX line_items_receipt_id_idx        ON line_items (receipt_id);

-- ---------------------------------------------------------------------------
-- 4. updated_at trigger
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER receipts_set_updated_at
  BEFORE UPDATE ON receipts
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. Row-Level Security — receipts
-- ---------------------------------------------------------------------------

ALTER TABLE receipts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "receipts: select own"
  ON receipts FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "receipts: insert own"
  ON receipts FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "receipts: update own"
  ON receipts FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "receipts: delete own"
  ON receipts FOR DELETE
  USING (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 6. Row-Level Security — line_items (join through receipts)
-- ---------------------------------------------------------------------------

ALTER TABLE line_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "line_items: select own"
  ON line_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM receipts
      WHERE receipts.id = line_items.receipt_id
        AND receipts.user_id = auth.uid()
    )
  );

CREATE POLICY "line_items: insert own"
  ON line_items FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM receipts
      WHERE receipts.id = line_items.receipt_id
        AND receipts.user_id = auth.uid()
    )
  );

CREATE POLICY "line_items: update own"
  ON line_items FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM receipts
      WHERE receipts.id = line_items.receipt_id
        AND receipts.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM receipts
      WHERE receipts.id = line_items.receipt_id
        AND receipts.user_id = auth.uid()
    )
  );

CREATE POLICY "line_items: delete own"
  ON line_items FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM receipts
      WHERE receipts.id = line_items.receipt_id
        AND receipts.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 7. Storage bucket
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'receipts',
  'receipts',
  false,
  10485760,
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 8. Storage RLS policies
-- Path convention: {user_id}/{receipt_id}.ext
-- storage.foldername(name)[1] extracts the first path segment (user_id)
-- ---------------------------------------------------------------------------

CREATE POLICY "storage receipts: select own"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'receipts'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "storage receipts: insert own"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'receipts'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "storage receipts: delete own"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'receipts'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
